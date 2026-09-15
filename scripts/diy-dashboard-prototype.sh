#!/usr/bin/env bash
# DIY dashboard prototype for issue #173 (Port.io vs. DIY board evaluation).
#
# Pulls real data straight from the GitHub REST API via the already-
# authenticated `gh` CLI for a small list of repos — open PR count, the
# latest CI run's conclusion, and recent issue activity — and renders it as
# a single static HTML page. No credentials beyond `gh auth login` (already
# configured in this environment) are required.
#
# This is deliberately narrow: it only demonstrates the GitHub leg of the
# "DIY board hitting REST APIs directly" option described in issue #173.
# Vercel/Neon/Sentry are NOT wired up here — this environment has no
# credentials for those, so that part of the comparison stayed desk
# research (see the issue #173 comment for what each of those legs would
# require).
#
# Issue #240 extended this with a second, independent data source: a running
# scripts/session-status-hook-receiver/receiver.py instance's `GET /status`.
# When reachable, each repo's card also lists the live Claude Code sessions
# whose cwd resolves (via `git remote get-url origin`) to that repo. The
# receiver is optional and often not running, so this degrades explicitly
# (a banner, not a silent empty section) rather than failing the whole
# render — the same failure-vs-empty-data distinction already used for `gh`
# above.
set -euo pipefail

# Exit-code taxonomy — see the hygiene baseline in claude/CLAUDE.md.
readonly EXIT_OK=0
readonly EXIT_USAGE=2
readonly EXIT_DEPENDENCY=4

usage() {
  cat <<'USAGE'
Usage: diy-dashboard-prototype.sh [-h|--help] [-o FILE] [--status-url URL] [REPO...]

Build a small static HTML dashboard from real GitHub data (open PR count,
latest CI run conclusion, recent issue activity) for one or more
"owner/repo" arguments, using the `gh` CLI (must already be authenticated).

If a scripts/session-status-hook-receiver/receiver.py instance is reachable
at --status-url, each repo's card also lists live Claude Code sessions whose
cwd resolves to that repo (via `git remote get-url origin`); sessions that
don't resolve to any tracked repo are listed in a separate "Other sessions"
card. If the receiver isn't reachable, the dashboard still renders, with an
explicit banner noting live session status was omitted.

  -o, --output FILE    Write the HTML dashboard to FILE (default: ./diy-dashboard.html)
  --status-url URL     session-status receiver's status endpoint
                       (default: http://127.0.0.1:8787/status)
  -h, --help           Show this message and exit.

REPO defaults to: dfadler/agent-config dfadler/issue-bot dfadler/dfadler.com

Example:
  ./diy-dashboard-prototype.sh -o /tmp/dashboard.html dfadler/agent-config dfadler/issue-bot
USAGE
}

output_file="./diy-dashboard.html"
status_url="http://127.0.0.1:8787/status"
status_timeout_seconds=3

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h | --help)
      usage
      exit "$EXIT_OK"
      ;;
    -o | --output)
      [[ $# -ge 2 ]] || {
        echo "Missing value for $1" >&2
        exit "$EXIT_USAGE"
      }
      output_file="$2"
      shift 2
      ;;
    --status-url)
      [[ $# -ge 2 ]] || {
        echo "Missing value for $1" >&2
        exit "$EXIT_USAGE"
      }
      status_url="$2"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit "$EXIT_USAGE"
      ;;
    *)
      break
      ;;
  esac
done

repos=("$@")
if [ "${#repos[@]}" -eq 0 ]; then
  repos=(dfadler/agent-config dfadler/issue-bot dfadler/dfadler.com)
fi

for dep in gh jq; do
  command -v "$dep" >/dev/null 2>&1 || {
    echo "::error::Required dependency not found on PATH: $dep" >&2
    exit "$EXIT_DEPENDENCY"
  }
done

html_escape() {
  # HTML-entity escaping for text pulled from API JSON before interpolating
  # it into the page — including quote characters, since escaped values
  # (e.g. safe_repo) are also inserted into quoted href="..." attributes,
  # not just element text content. Omitting quote-escaping would let a
  # crafted repo/title value break out of an attribute (CWE-79).
  sed -e 's/&/\&amp;/g' \
    -e 's/"/\&quot;/g' \
    -e "s/'/\\&#39;/g" \
    -e 's/</\&lt;/g' \
    -e 's/>/\&gt;/g'
}

# owner/repo for a git remote URL (git@host:owner/repo.git, https://host/owner/repo[.git],
# ssh://git@host/owner/repo.git) or empty if it doesn't look like one of those forms.
parse_owner_repo() {
  local url="${1%.git}"
  case "$url" in
    git@*:*) echo "${url#git@*:}" ;;
    *://*/*/*) echo "${url#*://*/}" ;;
    *) echo "" ;;
  esac
}

# Linear scan over $repos (a handful of entries at most) rather than an
# associative array — the macOS-shipped /bin/bash (3.2) this repo's tests
# and CLAUDE.md target has no `declare -A`.
is_requested_repo() {
  local candidate="$1" r
  for r in "${repos[@]}"; do
    [ "$r" = "$candidate" ] && return 0
  done
  return 1
}

# One <li> for session index $1 of $sessions_json, escaping cwd/detail text.
# The badge class is the status value itself (unknown/needs-input/done/ended
# — the receiver's fixed vocabulary, see badge-* in the CSS below), escaped
# like every other field pulled from the JSON response before interpolation.
render_session_row() {
  local idx="$1" s_status s_cwd s_detail safe_status safe_cwd safe_detail
  s_status=$(jq -r ".[$idx].status" <<<"$sessions_json")
  s_cwd=$(jq -r ".[$idx].cwd" <<<"$sessions_json")
  s_detail=$(jq -r ".[$idx].message // .[$idx].end_reason // .[$idx].notification_type // \"\"" <<<"$sessions_json")
  safe_status=$(printf '%s' "$s_status" | html_escape)
  safe_cwd=$(printf '%s' "$s_cwd" | html_escape)
  safe_detail=""
  [ -n "$s_detail" ] && safe_detail=" <span class=\"muted\">$(printf '%s' "$s_detail" | html_escape)</span>"
  printf '<li><span class="badge badge-%s">%s</span> <code>%s</code>%s</li>' \
    "$safe_status" "$safe_status" "$safe_cwd" "$safe_detail"
}

# Fetch the session-status receiver's snapshot once, up front (independent of
# the per-repo loop below). Any failure — curl missing, connection refused,
# timeout, non-2xx, invalid JSON — degrades to "unreachable" rather than
# aborting the dashboard; see the header comment for why.
safe_status_url=$(printf '%s' "$status_url" | html_escape)
sessions_json="[]"
sessions_reachable=0
if command -v curl >/dev/null 2>&1; then
  if raw_sessions_json=$(curl -fsS -m "$status_timeout_seconds" "$status_url" 2>/dev/null) &&
    jq -e . >/dev/null 2>&1 <<<"$raw_sessions_json"; then
    sessions_json="$raw_sessions_json"
    sessions_reachable=1
  else
    echo "::warning::session-status receiver not reachable at $status_url — live session status omitted" >&2
  fi
else
  echo "::warning::curl not found on PATH — live session status omitted" >&2
fi

session_count=0
[ "$sessions_reachable" -eq 1 ] && session_count=$(jq 'length' <<<"$sessions_json")

# Parallel array: session_repo[i] is the owner/repo a session's cwd resolves
# to via its git remote, or "" if it has no cwd, no git remote, or git isn't
# on PATH. Resolved once so the O(sessions * repos) matching below is cheap.
session_repo=()
if [ "$session_count" -gt 0 ]; then
  for ((session_idx = 0; session_idx < session_count; session_idx++)); do
    owner_repo=""
    s_cwd=$(jq -r ".[$session_idx].cwd" <<<"$sessions_json")
    if [ -n "$s_cwd" ] && command -v git >/dev/null 2>&1; then
      remote_url=$(git -C "$s_cwd" remote get-url origin 2>/dev/null) || remote_url=""
      [ -n "$remote_url" ] && owner_repo=$(parse_owner_repo "$remote_url")
    fi
    session_repo[session_idx]="$owner_repo"
  done
fi

cards=""
fetch_start_epoch=$(date +%s)

for repo in "${repos[@]}"; do
  echo "Fetching data for $repo ..." >&2
  safe_repo=$(printf '%s' "$repo" | html_escape)

  # 1. Open PR count. A `gh` failure (expired token, API error, bad repo) is
  # surfaced as "n/a", never as a count — 0 always means a real, successful
  # zero-result fetch.
  if open_pr_count=$(gh pr list --repo "$repo" --state open --json number --jq 'length' 2>/dev/null); then
    :
  else
    echo "::warning::gh pr list failed for $repo — showing as unavailable" >&2
    open_pr_count="n/a"
  fi

  # 2. Latest CI run: name, status, conclusion, and how long ago. A `gh`
  # failure must not collapse into "no workflow runs found" — that reads as
  # a confirmed, successful zero-result fetch when it may just mean the
  # fetch itself failed.
  if latest_run_json=$(gh run list --repo "$repo" --limit 1 --json displayTitle,status,conclusion,workflowName,createdAt 2>/dev/null); then
    run_fetch_failed=0
  else
    echo "::warning::gh run list failed for $repo — showing as error, not empty" >&2
    run_fetch_failed=1
    latest_run_json="[]"
  fi
  run_count=$(jq 'length' <<<"$latest_run_json")
  if [ "$run_fetch_failed" -eq 1 ]; then
    run_workflow="(error fetching runs)"
    run_status="error"
    run_conclusion="error"
    run_created=""
  elif [ "$run_count" -gt 0 ]; then
    run_workflow=$(jq -r '.[0].workflowName' <<<"$latest_run_json")
    run_status=$(jq -r '.[0].status' <<<"$latest_run_json")
    run_conclusion=$(jq -r '.[0].conclusion // "in_progress"' <<<"$latest_run_json")
    run_created=$(jq -r '.[0].createdAt' <<<"$latest_run_json")
  else
    run_workflow="(no workflow runs found)"
    run_status="n/a"
    run_conclusion="n/a"
    run_created=""
  fi

  # 3. Recent issue activity (open or closed, most recently updated first).
  # Same failure-vs-empty distinction as above.
  if recent_issues_json=$(gh issue list --repo "$repo" --state all --limit 5 \
    --json number,title,state,updatedAt 2>/dev/null); then
    issues_fetch_failed=0
  else
    echo "::warning::gh issue list failed for $repo — showing as error, not empty" >&2
    issues_fetch_failed=1
    recent_issues_json="[]"
  fi

  issue_rows=""
  issue_count=$(jq 'length' <<<"$recent_issues_json")
  if [ "$issues_fetch_failed" -eq 1 ]; then
    issue_rows="<li class=\"muted\">&#9888; Could not fetch issues (gh error) &mdash; not necessarily zero.</li>"
  elif [ "$issue_count" -gt 0 ]; then
    while IFS=$'\t' read -r inum ititle istate iupdated; do
      safe_title=$(printf '%s' "$ititle" | html_escape)
      istate_lc=$(printf '%s' "$istate" | tr '[:upper:]' '[:lower:]')
      issue_rows+="<li><span class=\"badge badge-${istate_lc}\">${istate}</span> <a href=\"https://github.com/${safe_repo}/issues/${inum}\">#${inum} ${safe_title}</a> <span class=\"muted\">(updated ${iupdated})</span></li>"
    done < <(jq -r '.[] | [.number, .title, .state, .updatedAt] | @tsv' <<<"$recent_issues_json")
  else
    issue_rows="<li class=\"muted\">No issues found.</li>"
  fi

  conclusion_class="neutral"
  case "$run_conclusion" in
    success) conclusion_class="ok" ;;
    failure | timed_out | cancelled | error) conclusion_class="fail" ;;
    in_progress | n/a) conclusion_class="neutral" ;;
  esac

  safe_workflow=$(printf '%s' "$run_workflow" | html_escape)
  run_detail="$run_status"
  [ -n "$run_created" ] && run_detail="$run_status, started $run_created"

  # 4. Live Claude Code sessions correlated to this repo (issue #240), from
  # the session-status receiver snapshot fetched once above. Omitted
  # entirely when the receiver wasn't reachable — the page-level banner
  # already explains that, so this section isn't shown as if it confirmed
  # zero sessions.
  live_sessions_section=""
  if [ "$sessions_reachable" -eq 1 ]; then
    session_rows=""
    for ((session_idx = 0; session_idx < session_count; session_idx++)); do
      [ "${session_repo[session_idx]:-}" = "$repo" ] || continue
      session_rows+=$(render_session_row "$session_idx")
    done
    [ -z "$session_rows" ] && session_rows="<li class=\"muted\">No live sessions for this repo.</li>"
    live_sessions_section="
    <h3>Live sessions</h3>
    <ul class=\"session-list\">${session_rows}</ul>"
  fi

  cards+="
  <section class=\"card\">
    <h2><a href=\"https://github.com/${safe_repo}\">${safe_repo}</a></h2>
    <div class=\"stat-row\">
      <div class=\"stat\"><span class=\"stat-value\">${open_pr_count}</span><span class=\"stat-label\">open PRs</span></div>
      <div class=\"stat\"><span class=\"stat-value stat-${conclusion_class}\">${run_conclusion}</span><span class=\"stat-label\">latest CI (${safe_workflow}) &middot; ${run_detail}</span></div>
    </div>
    <h3>Recent issue activity</h3>
    <ul class=\"issue-list\">${issue_rows}</ul>${live_sessions_section}
  </section>"
done

# Sessions whose cwd didn't resolve to any of the requested repos (no git
# remote, git missing, or a repo simply not in this render's list) — surfaced
# separately rather than silently dropped, so a stray session is still
# visible somewhere on the page.
other_sessions_section=""
if [ "$sessions_reachable" -eq 1 ]; then
  other_session_rows=""
  for ((session_idx = 0; session_idx < session_count; session_idx++)); do
    owner_repo="${session_repo[session_idx]:-}"
    if [ -z "$owner_repo" ] || ! is_requested_repo "$owner_repo"; then
      other_session_rows+=$(render_session_row "$session_idx")
    fi
  done
  if [ -n "$other_session_rows" ]; then
    other_sessions_section="
  <section class=\"card\">
    <h2>Other sessions</h2>
    <ul class=\"session-list\">${other_session_rows}</ul>
  </section>"
  fi
fi

session_status_banner=""
if [ "$sessions_reachable" -eq 0 ]; then
  session_status_banner="<p class=\"session-banner\">&#9888; Session-status receiver not reachable at ${safe_status_url} &mdash; live session status omitted from this render.</p>"
fi

fetch_end_epoch=$(date +%s)
fetch_seconds=$((fetch_end_epoch - fetch_start_epoch))
generated_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat >"$output_file" <<HTML
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>DIY GitHub Dashboard Prototype</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 2rem; background: #f7f7f8; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { background: #16171a; color: #e8e8ea; } }
  h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
  .meta { color: #666; font-size: 0.85rem; margin-bottom: 1.5rem; }
  .card { background: white; border-radius: 10px; padding: 1.25rem 1.5rem; margin-bottom: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,0.08); max-width: 720px; }
  @media (prefers-color-scheme: dark) { .card { background: #212226; box-shadow: none; border: 1px solid #333; } }
  .card h2 { margin: 0 0 0.75rem 0; font-size: 1.1rem; }
  .card h2 a { color: inherit; text-decoration: none; }
  .card h2 a:hover { text-decoration: underline; }
  .stat-row { display: flex; gap: 2rem; margin-bottom: 1rem; }
  .stat { display: flex; flex-direction: column; }
  .stat-value { font-size: 1.5rem; font-weight: 600; }
  .stat-ok { color: #1a7f37; }
  .stat-fail { color: #cf222e; }
  .stat-neutral { color: #9a6700; }
  .stat-label { font-size: 0.75rem; color: #666; text-transform: uppercase; letter-spacing: 0.02em; }
  h3 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.02em; color: #666; margin: 1rem 0 0.5rem; }
  .issue-list { list-style: none; margin: 0; padding: 0; font-size: 0.9rem; }
  .issue-list li { padding: 0.25rem 0; border-bottom: 1px solid #eee; }
  @media (prefers-color-scheme: dark) { .issue-list li { border-bottom-color: #333; } }
  .issue-list li:last-child { border-bottom: none; }
  .muted { color: #888; font-size: 0.8rem; }
  .badge { display: inline-block; font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 4px; margin-right: 0.35rem; text-transform: uppercase; }
  .badge-open { background: #dafbe1; color: #1a7f37; }
  .badge-closed { background: #f3e8fd; color: #8250df; }
  .badge-needs-input { background: #fff1e5; color: #9a6700; }
  .badge-done { background: #dafbe1; color: #1a7f37; }
  .badge-ended, .badge-unknown { background: #eaeaea; color: #57606a; }
  .session-list { list-style: none; margin: 0; padding: 0; font-size: 0.85rem; }
  .session-list li { padding: 0.25rem 0; border-bottom: 1px solid #eee; }
  @media (prefers-color-scheme: dark) { .session-list li { border-bottom-color: #333; } }
  .session-list li:last-child { border-bottom: none; }
  .session-list code { font-size: 0.8rem; }
  .session-banner { background: #fff8e1; border: 1px solid #f0d878; padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.85rem; max-width: 720px; margin-bottom: 1.5rem; }
  @media (prefers-color-scheme: dark) { .session-banner { background: #2a2410; border-color: #5c4d15; } }
</style>
</head>
<body>
<h1>DIY GitHub Dashboard Prototype</h1>
<p class="meta">Generated ${generated_at} · fetched ${#repos[@]} repo(s) in ${fetch_seconds}s via \`gh\` CLI · built for issue #173</p>
${session_status_banner}
${cards}
${other_sessions_section}
</body>
</html>
HTML

echo "Wrote dashboard to $output_file (fetched ${#repos[@]} repos in ${fetch_seconds}s)"
