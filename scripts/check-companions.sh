#!/usr/bin/env bash
# Advisory companion checks run by setup.sh after the core symlinking is done.
# Checks: git identity, Python deps (pyte for the detached-terminal skill), and
# recommended companion plugins/tools (mattpocock-skills, anthropics/skills,
# vercel-labs react-skills, aws-core, rtk, ponytail, Aikido Safe Chain
# permission offer).
#
# Policy: every companion documented in docs/companion-plugins.md gets an
# advisory check here unless its section there documents an explicit reason
# for exclusion (currently bulletproof-react-skills and
# aws-agents-for-devsecops).
#
# All checks are informational — they never affect the symlinks setup.sh
# created, and `./setup.sh && something-else` shouldn't break over any of
# them. An explicitly requested --install-deps that can't install pyte is still
# a failure.
#
# Usage: check-companions.sh [--install-deps]

set -euo pipefail

INSTALL_DEPS=0

usage() {
  cat <<'USAGE'
Usage: check-companions.sh [--install-deps]

Advisory checks for companion tools and plugins required or recommended by the
skills this repo ships. All checks are informational; none affect the symlinks
setup.sh has already created. Run by setup.sh automatically; you can also run
it directly.

  --install-deps   Also install a missing pyte dependency (python3 -m pip
                   install --user pyte), when the interpreter allows it.
  -h, --help       Show this message and exit.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-deps) INSTALL_DEPS=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --------------------------------------------------------------------------
# Runtime dependencies
#
# The detached-terminal skill's agent_term.py is `#!/usr/bin/env python3`, so
# it runs under whatever python3 is FIRST ON PATH when an agent invokes it.
# Nothing activates this repo's .venv (the one `make venv` builds for CI) on
# the skill's behalf, so a green `make check` says nothing about whether the
# skill can actually start. pyte has to be importable by the ambient
# interpreter, and setup time is the only moment that gap can surface before
# an agent hits it mid-task.
#
# One probe answers every question at once, so the interpreter is consulted
# once and the answers can't disagree with each other:
#   exe=      the interpreter that would really run the skill
#   pyte=     is the dependency importable by it
#   managed=  PEP 668 externally-managed (a plain pip install would be refused)
#   venv=     already inside a virtualenv (where `pip --user` is an error)
# --------------------------------------------------------------------------
PYTE_PROBE='import os, sys, sysconfig
try:
    import pyte  # noqa: F401
    found = "yes"
except ImportError:
    found = "no"
marker = os.path.join(sysconfig.get_path("stdlib"), "EXTERNALLY-MANAGED")
print("exe=" + sys.executable)
print("pyte=" + found)
print("managed=" + ("yes" if os.path.exists(marker) else "no"))
print("venv=" + ("yes" if sys.prefix != sys.base_prefix else "no"))
'

# Read one field out of a probe result. Empty for a field the probe never
# printed, which is also what a failed probe yields.
probe_field() {
  printf '%s\n' "$1" | sed -n "s/^$2=//p" | head -n1
}

run_probe() {
  python3 -c "$PYTE_PROBE" 2>/dev/null || true
}

report_missing_pyte() {
  local exe="$1" managed="$2"
  {
    echo
    echo "⚠ pyte is NOT installed for $exe"
    echo "  The detached-terminal skill will fail the first time an agent uses it."
    echo "  That skill runs under whatever python3 is first on PATH, so this repo's"
    echo "  .venv (make venv) does not satisfy it."
    echo
    if [[ "$managed" == "yes" ]]; then
      echo "  That interpreter is PEP 668 externally-managed, so pip will refuse to"
      echo "  install into it. Pick one:"
      echo "    - the OS package, e.g.  sudo apt install python3-pyte"
      echo "    - python3 -m pip install --user --break-system-packages pyte"
      echo "    - put an interpreter you own first on PATH, with pyte installed in it"
    else
      echo "  Install it with:"
      echo "    python3 -m pip install --user pyte"
      echo "  or re-run this script as:"
      echo "    ./setup.sh --install-deps"
    fi
    echo
  } >&2
}

install_pyte() {
  local exe="$1" managed="$2" venv="$3"
  # pip against an externally-managed interpreter fails with a wall of text
  # about PEP 668; say the useful thing instead of letting pip say the
  # confusing one.
  if [[ "$managed" == "yes" ]]; then
    report_missing_pyte "$exe" "$managed"
    echo "Not running pip: $exe is externally managed (see the options above)." >&2
    return 1
  fi

  # --user is an error inside a virtualenv ("User site-packages are not
  # visible in this virtualenv"), where the venv itself is already the
  # per-user location.
  local -a cmd=(python3 -m pip install)
  if [[ "$venv" == "no" ]]; then
    cmd+=(--user)
  fi
  cmd+=(pyte)

  echo "Installing pyte: ${cmd[*]}"
  if ! "${cmd[@]}"; then
    echo "pip install failed." >&2
    report_missing_pyte "$exe" "$managed"
    return 1
  fi

  # Trust the import, not pip's exit status: pip can succeed into a site
  # directory this interpreter doesn't actually search.
  if [[ "$(probe_field "$(run_probe)" pyte)" != "yes" ]]; then
    echo "pip reported success, but pyte still isn't importable by $exe." >&2
    report_missing_pyte "$exe" "$managed"
    return 1
  fi
  echo "✓ pyte installed and importable by $exe"
}

check_git_identity() {
  if (cd "$REPO_ROOT" && ./scripts/git-identity.sh) >/dev/null 2>&1; then
    echo "✓ git identity is configured (scripts/git-identity.sh)"
  else
    {
      echo
      echo "⚠ git identity (user.name/user.email) is not fully configured."
      echo "  Tooling that relies on scripts/git-identity.sh (e.g. an automated"
      echo "  commit) will fail loudly until this is set. Configure it with:"
      echo "    git config --global user.name \"Your Name\""
      echo "    git config --global user.email you@example.com"
      echo
    } >&2
  fi
}

check_python_deps() {
  local probe have exe managed venv
  probe="$(run_probe)"
  have="$(probe_field "$probe" pyte)"

  if [[ -z "$have" ]]; then
    {
      echo
      echo "⚠ Could not run python3, so the detached-terminal skill's pyte"
      echo "  dependency could not be checked. That skill needs Python 3.10+ with"
      echo "  pyte importable by the python3 first on PATH."
      echo
    } >&2
    return 0
  fi

  exe="$(probe_field "$probe" exe)"
  managed="$(probe_field "$probe" managed)"
  venv="$(probe_field "$probe" venv)"

  if [[ "$have" == "yes" ]]; then
    echo "✓ pyte is importable by $exe — the detached-terminal skill is ready"
    return 0
  fi

  if [[ "$INSTALL_DEPS" == "1" ]]; then
    install_pyte "$exe" "$managed" "$venv"
    return
  fi

  report_missing_pyte "$exe" "$managed"
}

# Query `claude plugin list --json` for one plugin by id prefix and return a
# single word: enabled | disabled | absent | error.
#
# A grep window over raw JSON isn't safe with multiple plugins installed: an
# "enabled" line from a neighboring entry falls inside a context window and
# gets attributed to the wrong plugin (reported and reproduced in #134).
# python3 is already required elsewhere in this script, so using it here adds
# no new dependency. `if py_out=$(...)` rather than a plain assignment: under
# set -euo pipefail a plain `var="$(cmd)"` whose command exits non-zero aborts
# the script; an if-condition is the one place set -e doesn't trigger on
# failure, so this is the correct idiom, not a stylistic one.
claude_plugin_state() {
  local id_prefix="$1"
  command -v claude >/dev/null 2>&1 || { echo "error"; return 0; }
  local listing
  listing="$(claude plugin list --json 2>/dev/null)" || { echo "error"; return 0; }
  local py_out py_rc
  if py_out="$(printf '%s' "$listing" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(2)
for entry in data:
    if str(entry.get("id", "")).startswith(sys.argv[1]):
        print("enabled" if entry.get("enabled") else "disabled")
        sys.exit(0)
sys.exit(1)
' "$id_prefix" 2>/dev/null)"; then
    py_rc=0
  else
    py_rc=$?
  fi
  case "$py_rc:$py_out" in
    0:enabled)  echo "enabled" ;;
    0:disabled) echo "disabled" ;;
    1:*)        echo "absent" ;;
    *)          echo "error" ;;
  esac
}

# Purely informational: nothing in this repo depends on mattpocock-skills
# being installed (see README's "Recommended companion" section, and #132's
# decision to document rather than auto-install it) - unlike pyte or git
# identity, there's no --install-deps for this, and there never should be.
# The id can be "mattpocock-skills@mattpocock" (self-hosted fallback) or
# "@claude-plugins-official" - either satisfies the check, so the marketplace
# suffix is deliberately not matched.
check_mattpocock_skills() {
  case "$(claude_plugin_state "mattpocock-skills@")" in
    enabled)
      echo "✓ mattpocock-skills is installed"
      ;;
    disabled)
      {
        echo
        echo "⚠ mattpocock-skills is installed but disabled."
        echo "  Re-enable it with: claude plugin enable mattpocock-skills"
        echo
      } >&2
      ;;
    absent)
      {
        echo
        echo "ℹ mattpocock-skills is not installed — a recommended companion plugin,"
        echo "  not required by anything here. See README's \"Recommended companion\""
        echo "  section. Install it with:"
        echo "    claude plugin install mattpocock-skills"
        echo
      } >&2
      ;;
  esac
}

# Same posture as check_mattpocock_skills above: purely informational, nothing
# here depends on it, no --install-deps. anthropics/skills isn't in the
# official marketplace the way mattpocock-skills is (checked directly against
# anthropics/claude-plugins-official's own manifest - absent), so unlike that
# one, getting it requires adding its marketplace first; the install id is
# therefore always "example-skills@anthropic-agent-skills", never a
# "@claude-plugins-official" variant.
check_frontend_design() {
  case "$(claude_plugin_state "example-skills@")" in
    enabled)
      echo "✓ anthropics/skills (frontend-design) is installed"
      ;;
    disabled)
      {
        echo
        echo "⚠ anthropics/skills is installed but disabled."
        echo "  Re-enable it with: claude plugin enable example-skills"
        echo
      } >&2
      ;;
    absent)
      {
        echo
        echo "ℹ anthropics/skills (frontend-design) is not installed — a recommended"
        echo "  companion plugin, not required by anything here. See README's"
        echo "  \"Recommended companion\" section. Install it with:"
        echo "    claude plugin marketplace add anthropics/skills"
        echo "    claude plugin install example-skills"
        echo
      } >&2
      ;;
  esac
}

# Same posture as check_mattpocock_skills above: purely informational, nothing
# here depends on it, no --install-deps. Unlike mattpocock-skills/frontend-design,
# vercel-labs/agent-skills isn't a `claude plugin` at all - it distributes
# through a separate `skills` CLI (see README's "Recommended companion"
# section), so this check only fires when that CLI is already resolvable on
# PATH. It deliberately never runs `npx skills@latest` itself: that would mean
# fetching and executing a third-party package over the network on every
# setup.sh run, a materially bigger side effect than the other two checks,
# which only ever shell out to the `claude` CLI the user already has. Skills
# are matched by their SKILL.md `name:` field (vercel-react-best-practices /
# vercel-composition-patterns), not their directory name — confirmed against a
# real probe install in a scratch directory, not assumed from the README.
check_react_skills() {
  command -v skills >/dev/null 2>&1 || return 0

  local listing
  listing="$(skills ls -g --json 2>/dev/null)" || return 0

  local state rc
  if state="$(printf '%s' "$listing" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(2)
names = {str(e.get("name", "")) for e in data}
wanted = {"vercel-react-best-practices", "vercel-composition-patterns"}
missing = wanted - names
if not missing:
    print("installed")
elif missing == wanted:
    print("absent")
else:
    print("partial:" + ",".join(sorted(missing)))
sys.exit(0)
' 2>/dev/null)"; then
    rc=0
  else
    rc=$?
  fi

  case "$rc:$state" in
    0:installed)
      echo "✓ vercel-labs react-skills (react-best-practices, composition-patterns) installed"
      ;;
    0:absent)
      {
        echo
        echo "ℹ vercel-labs react-best-practices/composition-patterns are not installed —"
        echo "  a recommended companion, not required by anything here. See README's"
        echo "  \"Recommended companion\" section. Install them with:"
        echo "    skills add vercel-labs/agent-skills --agent claude-code -g \\"
        echo "      --skill vercel-react-best-practices vercel-composition-patterns"
        echo
      } >&2
      ;;
    0:partial:*)
      {
        echo
        echo "⚠ Only one of vercel-react-best-practices/vercel-composition-patterns is"
        echo "  installed (missing: ${state#partial:}). Install the other with the same"
        echo "  command as above, naming just the missing skill."
        echo
      } >&2
      ;;
    *)
      return 0
      ;;
  esac
}

# Same posture as check_mattpocock_skills above: purely informational, nothing
# here depends on it, no --install-deps. aws-core is Amazon Web Services' own
# plugin (part of aws/agent-toolkit-for-aws, GA) and - like mattpocock-skills -
# ships directly in Claude Code's official marketplace, confirmed against
# anthropics/claude-plugins-official's own manifest, so its install id is
# always "aws-core@claude-plugins-official" with no marketplace-add step
# first. Matched by id prefix only (not the marketplace suffix), same
# reasoning as check_mattpocock_skills. aws-agents-for-devsecops (the
# security-auditing companion documented alongside aws-core in the README)
# deliberately has no check here: it needs a plugin-specific
# /aws-agents-for-devsecops:setup step before use, so installed/not-installed
# alone would misstate whether it's actually ready.
check_aws_core() {
  case "$(claude_plugin_state "aws-core@")" in
    enabled)
      echo "✓ aws-core is installed"
      ;;
    disabled)
      {
        echo
        echo "⚠ aws-core is installed but disabled."
        echo "  Re-enable it with: claude plugin enable aws-core"
        echo
      } >&2
      ;;
    absent)
      {
        echo
        echo "ℹ aws-core is not installed — a recommended companion plugin, not"
        echo "  required by anything here. See README's \"Recommended companion\""
        echo "  section. Install it with:"
        echo "    claude plugin install aws-core@claude-plugins-official"
        echo
      } >&2
      ;;
  esac
}

# Same posture as check_mattpocock_skills above: purely informational, nothing
# here depends on it, no --install-deps. Unlike the plugin-based checks above,
# rtk-ai/rtk (see README's "Recommended companion" section) is a bare CLI, not
# a `claude plugin` or a `skills` CLI entry, so this only checks whether the
# `rtk` binary itself is on PATH - it has no way to introspect whether
# `rtk init --global`'s hook is actually active, and doesn't try to. It
# deliberately never runs the installer or `rtk init --global` itself: the
# installer is a fetch-and-execute install (curl | sh, or the Homebrew tap),
# and `rtk init --global` writes a PreToolUse hook into Claude Code's own
# settings plus shell rc files - both need to be asked for explicitly, not run
# as a side effect of every setup.sh invocation (same reasoning as
# check_react_skills declining to run `npx skills@latest` on its own).
check_rtk() {
  if command -v rtk >/dev/null 2>&1; then
    echo "✓ rtk is installed (run 'rtk init --show' to check whether its token-compression hook is active)"
    return 0
  fi

  {
    echo
    echo "ℹ rtk (token compression for Bash tool output) is not installed — a"
    echo "  recommended companion, not required by anything here. See README's"
    echo "  \"Recommended companion\" section. Install it with:"
    echo "    brew install rtk-ai/tap/rtk"
    echo "  then review and run 'rtk init --global' yourself to activate the hook -"
    echo "  it edits Claude Code's own hook settings and your shell rc files, so"
    echo "  this script won't run it for you."
    echo
  } >&2
}

# Same posture as check_mattpocock_skills above: purely informational, nothing
# here depends on it, no --install-deps. DietrichGebert/ponytail isn't in the
# official marketplace; its own .claude-plugin/marketplace.json names both the
# marketplace and the plugin "ponytail", so the install id is
# "ponytail@ponytail". Matched by id prefix only, same as the checks above.
check_ponytail() {
  case "$(claude_plugin_state "ponytail@")" in
    enabled)
      echo "✓ ponytail is installed"
      ;;
    disabled)
      {
        echo
        echo "⚠ ponytail is installed but disabled."
        echo "  Re-enable it with: claude plugin enable ponytail"
        echo
      } >&2
      ;;
    absent)
      {
        echo
        echo "ℹ ponytail is not installed — a recommended companion plugin, not"
        echo "  required by anything here. See README's \"Recommended companion\""
        echo "  section. Install it with:"
        echo "    claude plugin marketplace add DietrichGebert/ponytail"
        echo "    claude plugin install ponytail"
        echo
      } >&2
      ;;
  esac
}

check_git_identity
check_python_deps
check_mattpocock_skills
check_frontend_design
check_react_skills
check_aws_core
check_rtk
check_ponytail

# Also last: offers (opt-in, y/n) to pre-approve Aikido Safe Chain's pinned
# installer command in Claude Code's permission settings. See
# scripts/offer-safe-chain-permission.sh for why — it decides on its own
# whether it's safe to prompt (skips cleanly under CI or a non-interactive
# run). Unlike the checks above, it can genuinely fail (missing jq, a corrupt
# settings.json) rather than always reporting 0, so `|| true` keeps it
# advisory here.
"$REPO_ROOT/scripts/offer-safe-chain-permission.sh" || true
