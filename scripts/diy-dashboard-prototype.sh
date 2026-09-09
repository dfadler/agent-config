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
set -euo pipefail

# Exit-code taxonomy — see the hygiene baseline in claude/CLAUDE.md.
readonly EXIT_OK=0
readonly EXIT_USAGE=2
readonly EXIT_DEPENDENCY=4

usage() {
  cat <<'USAGE'
Usage: diy-dashboard-prototype.sh [-h|--help] [-o FILE] [REPO...]

Build a small static HTML dashboard from real GitHub data (open PR count,
latest CI run conclusion, recent issue activity) for one or more
"owner/repo" arguments, using the `gh` CLI (must already be authenticated).

  -o, --output FILE   Write the HTML dashboard to FILE (default: ./diy-dashboard.html)
  -h, --help          Show this message and exit.

REPO defaults to: dfadler/agent-config dfadler/issue-bot dfadler/dfadler.com

Example:
  ./diy-dashboard-prototype.sh -o /tmp/dashboard.html dfadler/agent-config dfadler/issue-bot
USAGE
}

output_file="./diy-dashboard.html"

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
  # Minimal HTML-entity escaping for text pulled from API JSON before
  # interpolating it into the page.
  sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

cards=""
fetch_start_epoch=$(date +%s)

for repo in "${repos[@]}"; do
  echo "Fetching data for $repo ..." >&2

  # 1. Open PR count.
  open_pr_count=$(gh pr list --repo "$repo" --state open --json number --jq 'length' 2>/dev/null || echo "n/a")

  # 2. Latest CI run: name, status, conclusion, and how long ago.
  latest_run_json=$(gh run list --repo "$repo" --limit 1 --json displayTitle,status,conclusion,workflowName,createdAt 2>/dev/null || echo "[]")
  run_count=$(jq 'length' <<<"$latest_run_json")
  if [ "$run_count" -gt 0 ]; then
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
  recent_issues_json=$(gh issue list --repo "$repo" --state all --limit 5 \
    --json number,title,state,updatedAt 2>/dev/null || echo "[]")

  issue_rows=""
  issue_count=$(jq 'length' <<<"$recent_issues_json")
  if [ "$issue_count" -gt 0 ]; then
    while IFS=$'\t' read -r inum ititle istate iupdated; do
      safe_title=$(printf '%s' "$ititle" | html_escape)
      istate_lc=$(printf '%s' "$istate" | tr '[:upper:]' '[:lower:]')
      issue_rows+="<li><span class=\"badge badge-${istate_lc}\">${istate}</span> #${inum} ${safe_title} <span class=\"muted\">(updated ${iupdated})</span></li>"
    done < <(jq -r '.[] | [.number, .title, .state, .updatedAt] | @tsv' <<<"$recent_issues_json")
  else
    issue_rows="<li class=\"muted\">No issues found.</li>"
  fi

  conclusion_class="neutral"
  case "$run_conclusion" in
    success) conclusion_class="ok" ;;
    failure | timed_out | cancelled) conclusion_class="fail" ;;
    in_progress | n/a) conclusion_class="neutral" ;;
  esac

  safe_repo=$(printf '%s' "$repo" | html_escape)
  safe_workflow=$(printf '%s' "$run_workflow" | html_escape)
  run_detail="$run_status"
  [ -n "$run_created" ] && run_detail="$run_status, started $run_created"

  cards+="
  <section class=\"card\">
    <h2><a href=\"https://github.com/${safe_repo}\">${safe_repo}</a></h2>
    <div class=\"stat-row\">
      <div class=\"stat\"><span class=\"stat-value\">${open_pr_count}</span><span class=\"stat-label\">open PRs</span></div>
      <div class=\"stat\"><span class=\"stat-value stat-${conclusion_class}\">${run_conclusion}</span><span class=\"stat-label\">latest CI (${safe_workflow}) &middot; ${run_detail}</span></div>
    </div>
    <h3>Recent issue activity</h3>
    <ul class=\"issue-list\">${issue_rows}</ul>
  </section>"
done

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
</style>
</head>
<body>
<h1>DIY GitHub Dashboard Prototype</h1>
<p class="meta">Generated ${generated_at} · fetched ${#repos[@]} repo(s) in ${fetch_seconds}s via \`gh\` CLI · built for issue #173</p>
${cards}
</body>
</html>
HTML

echo "Wrote dashboard to $output_file (fetched ${#repos[@]} repos in ${fetch_seconds}s)"
