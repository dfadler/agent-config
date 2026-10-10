#!/usr/bin/env bash
# Advisory companion checks run by setup.sh after the core symlinking is done.
# Checks: git identity, Python deps (pyte for the detached-terminal skill), and
# recommended companion plugins/tools (mattpocock-skills, anthropics/skills,
# vercel-labs react-skills, aws-core, rtk, playwright-cli, ponytail, Aikido Safe Chain
# permission offer).
#
# Policy: every companion documented in docs/companion-plugins.md gets an
# advisory check here unless its section there documents an explicit reason
# for exclusion (currently bulletproof-react-skills and
# aws-agents-for-devsecops).
#
# All checks are informational by default — they never affect the symlinks
# setup.sh created, and `./setup.sh && something-else` shouldn't break over
# any of them. --install-deps and --fix are the two explicit opt-ins that
# apply a known fix instead of just reporting it; neither ever runs as a side
# effect of a bare invocation. An explicitly requested --install-deps that
# can't install pyte, or a --fix that can't apply, is still a failure.
#
# Usage: check-companions.sh [--install-deps] [--fix]

set -euo pipefail

INSTALL_DEPS=0
FIX=0

usage() {
  cat <<'USAGE'
Usage: check-companions.sh [--install-deps] [--fix]

Advisory checks for companion tools and plugins required or recommended by the
skills this repo ships. All checks are informational by default; none affect
the symlinks setup.sh has already created. Run by setup.sh automatically; you
can also run it directly (also reachable as ./doctor.sh from the repo root).

  --install-deps   Also install a missing pyte dependency (python3 -m pip
                   install --user pyte), when the interpreter allows it, and
                   a missing playwright-cli (npm install -g @playwright/cli,
                   Node 22 on PATH required).
  --fix            Also apply other known fixes for a problem this script
                   detects, instead of only reporting it (currently: adding
                   "git", prettier, eslint, vitest to rtk's own exclude_commands config when rtk's
                   PreToolUse hook would otherwise break git commands inside
                   a worktree-isolated session; merging the require-worktree
                   PreToolUse hook back into ~/.claude/settings.json when
                   another tool has displaced it — see docs/companion-plugins.md;
                   removing dangling hook entries in ~/.claude/settings.json
                   and dangling symlinks in ~/.claude/skills and
                   ~/.claude/commands that point into this install; the
                   settings file is backed up to settings.json.bak-<time>
                   first; and removing @-include lines in ~/.claude/CLAUDE.md
                   and CLAUDE.personal.md whose file under this repo's claude/
                   tree is gone, backing up to <file>.bak-<time> first). Never runs as a side effect of a bare invocation.
  -h, --help       Show this message and exit.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-deps) INSTALL_DEPS=1 ;;
    --fix) FIX=1 ;;
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

REPO_ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Helpers for removing hook entries from ~/.claude/settings.json.
# shellcheck source=scripts/settings-lib.sh
source "$REPO_ROOT/scripts/settings-lib.sh"

# --------------------------------------------------------------------------
# Runtime dependencies
#
# The detached-terminal skill's agent_term.py is `#!/usr/bin/env python3`, so
# it runs under whatever python3 is FIRST ON PATH when an agent invokes it.
# Nothing activates this repo's .venv (the one `scripts/ci.sh venv` builds for CI) on
# the skill's behalf, so a green `scripts/ci.sh check` says nothing about whether the
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
    echo "  .venv (scripts/ci.sh venv) does not satisfy it."
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
  command -v claude >/dev/null 2>&1 || {
    echo "error"
    return 0
  }
  local listing
  listing="$(claude plugin list --json 2>/dev/null)" || {
    echo "error"
    return 0
  }
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
    0:enabled) echo "enabled" ;;
    0:disabled) echo "disabled" ;;
    1:*) echo "absent" ;;
    *) echo "error" ;;
  esac
}

# Shared advisory check for a companion that is itself a `claude plugin` (its
# state comes from claude_plugin_state above), covering the enabled/disabled/
# absent message shapes that check_mattpocock_skills, check_frontend_design,
# check_aws_core, and check_ponytail used to duplicate one-for-one (#369).
# Purely informational, like each of those was: nothing in this repo depends
# on any of these plugins being installed (see README's "Recommended
# companion" section, and #132's decision to document rather than
# auto-install them) - unlike pyte or git identity, there's no --install-deps
# equivalent for any companion here, and there never should be.
#
# check_react_skills and check_rtk below stay separate functions rather than
# calls into this one: they check PATH-based tools, not `claude plugin list`
# state, so they don't fit this shape.
#
# Params:
#   id_prefix   passed to claude_plugin_state - see that function's own
#               comment for why a prefix match, not the full
#               marketplace-qualified id, is deliberate.
#   long_name   used in the ✓ installed / ℹ not-installed lines.
#   short_name  used in the ⚠ installed-but-disabled line. Equal to long_name
#               for every current companion except anthropics/skills, whose
#               long form adds "(frontend-design)".
#   plugin_id   the `claude plugin enable`/`claude plugin install` argument.
#   install_cmd remaining args (one or more): the install command line(s)
#               printed under "Install it with:" when absent.
check_companion_plugin() {
  local id_prefix="$1" long_name="$2" short_name="$3" plugin_id="$4"
  shift 4
  case "$(claude_plugin_state "$id_prefix")" in
    enabled)
      echo "✓ $long_name is installed"
      ;;
    disabled)
      {
        echo
        echo "⚠ $short_name is installed but disabled."
        echo "  Re-enable it with: claude plugin enable $plugin_id"
        echo
      } >&2
      ;;
    absent)
      {
        echo
        echo "ℹ $long_name is not installed — a recommended companion plugin, not"
        echo "  required by anything here. See README's \"Recommended companion\""
        echo "  section. Install it with:"
        local line
        for line in "$@"; do
          echo "    $line"
        done
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
    check_rtk_git_exclusion
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

# Shared parser for rtk's own config.toml, used by both the read-only check
# and the fix below — one implementation so they can't silently disagree
# with each other (an earlier version used a separate awk/grep heuristic for
# the check and a separate single-line regex for the fix; a reviewer
# correctly pointed out the check side false-"excluded" on a commented-out
# `# exclude_commands = [...]` line, and neither side handled a value that
# wraps onto more than one line).
#
# Scans line-by-line tracking the current top-level [section] (a fully
# commented-out line, including a commented section header, is skipped
# rather than parsed), and once inside [hooks], locates the exclude_commands
# key and accumulates its value across as many lines as it takes to reach
# the closing "]" — so a multi-line array is read correctly, not just a
# single-line one. Still not a real TOML parser (no escaped brackets inside
# a quoted entry, no inline "# comment" after a value on the same line), but
# closes the two concrete false-negatives above; good enough for an advisory
# check, consistent with this repo not carrying a TOML-parsing dependency
# anywhere else.
#
# Reads RTK_CONFIG_PATH and RTK_PARSE_MODE from the environment:
#   RTK_VERIFY_COMMANDS    Comma list of extra commands to exclude, besides
#                          "git" (set below).
#   RTK_PARSE_MODE=check  Prints "no" if "git" is missing from the array
#                          (including when exclude_commands isn't present
#                          under [hooks] at all), "partial" if git is there
#                          but a verification command isn't, else "yes".
#                          Always exits 0; the file is never modified.
#   RTK_PARSE_MODE=fix     Appends the missing entries to the array in place
#                          and prints "fixed", or prints "noop" if none are
#                          missing. Exits 1 (no output) if exclude_commands
#                          isn't present under [hooks] to append to.
# Passed via `-c` (like claude_plugin_state's own python3 call above) rather
# than piped to stdin: a test's fake python3 (shim_python3 in
# scripts/tests/helpers.bash) only recognizes -c/-m and forwards to the real
# interpreter, so a bare heredoc-to-stdin call would be swallowed by that
# shim during check-companions.bats's rtk tests.
RTK_HOOKS_PARSER=$(
  cat <<'PYEOF'
import os, re, sys

path = os.environ["RTK_CONFIG_PATH"]
mode = os.environ["RTK_PARSE_MODE"]

with open(path) as f:
    lines = f.readlines()

in_hooks = False
start = end = None
raw = ""
i = 0
while i < len(lines):
    line = lines[i]
    stripped = line.strip()
    if stripped.startswith("#"):
        i += 1
        continue
    if stripped.startswith("[") and stripped.endswith("]") and "=" not in stripped:
        in_hooks = stripped == "[hooks]"
        i += 1
        continue
    if in_hooks and start is None:
        m = re.match(r'^(\s*exclude_commands\s*=\s*)(.*)$', line.rstrip("\n"))
        if m:
            start = i
            rest = m.group(2)
            if "]" in rest:
                raw, end = rest[: rest.index("]") + 1], i
            else:
                raw = rest
                j = i + 1
                while j < len(lines):
                    if lines[j].strip().startswith("#"):
                        j += 1
                        continue
                    if "]" in lines[j]:
                        raw += lines[j][: lines[j].index("]") + 1]
                        end = j
                        break
                    raw += lines[j]
                    j += 1
            i = (end if end is not None else j) + 1
            continue
    i += 1

if start is None:
    if mode == "check":
        print("no")
        sys.exit(0)
    sys.exit(1)  # fix: nothing to append "git" to

inner = raw.strip()
inner = inner[1:] if inner.startswith("[") else inner
inner = inner[:-1] if inner.endswith("]") else inner
entries = [e.strip().strip("\"'") for e in inner.split(",") if e.strip()]
has_git = "git" in entries
# git is required; the rest are verification commands whose condensed output
# can hide a failure signal (advisory). Appended in this order by fix mode.
wanted = ["git"] + [w for w in os.environ.get("RTK_VERIFY_COMMANDS", "").split(",") if w]
missing = [w for w in wanted if w not in entries]

if mode == "check":
    print("no" if not has_git else "partial" if missing else "yes")
    sys.exit(0)

# mode == fix
if not missing:
    print("noop")
    sys.exit(0)

entries.extend(missing)
new_array = "[" + ", ".join('"{}"'.format(e) for e in entries) + "]"
prefix = re.match(r'^(\s*exclude_commands\s*=\s*)', lines[start]).group(1)
lines[start : end + 1] = [prefix + new_array + "\n"]
with open(path, "w") as f:
    f.writelines(lines)
print("fixed")
PYEOF
)

# Verification commands that gate a push. rtk condenses output and can swallow
# a failure signal (a falsely passing `npx prettier --check` once let a CI
# format failure through), so --fix excludes them from rewriting too. Verified
# (rtk 0.50.0): exclude_commands also covers the `npx`/`pnpm exec` forms.
RTK_VERIFY_COMMANDS="prettier,eslint,vitest"
export RTK_VERIFY_COMMANDS

# rtk_config_git_excluded CFG
#   Prints "yes"/"partial"/"no" — see RTK_HOOKS_PARSER's RTK_PARSE_MODE=check contract
#   above. CFG must already exist; callers check that first.
rtk_config_git_excluded() {
  RTK_CONFIG_PATH="$1" RTK_PARSE_MODE=check python3 -c "$RTK_HOOKS_PARSER"
}

# Applies the fix check_rtk_git_exclusion (below) reports: adds "git" to
# rtk's own [hooks].exclude_commands in its config.toml, via RTK_HOOKS_PARSER
# above. Only reached behind an explicit --fix — this is the one place in
# this script that edits a companion tool's own persistent config rather
# than this repo's, gated the same way install_pyte is gated behind
# --install-deps: never as a side effect of a bare invocation.
fix_rtk_git_exclusion() {
  local cfg="$1"

  if [[ ! -f "$cfg" ]]; then
    echo "rtk hasn't created its config file yet ($cfg doesn't exist)." >&2
    echo "  Run 'rtk config --create' first, then re-run with --fix." >&2
    return 1
  fi

  local result
  if ! result="$(RTK_CONFIG_PATH="$cfg" RTK_PARSE_MODE=fix python3 -c "$RTK_HOOKS_PARSER")"; then
    echo "Could not automatically edit $cfg — no exclude_commands line found" >&2
    echo "  under [hooks]. Add \"git\" to it yourself; see" >&2
    echo "  docs/companion-plugins.md's rtk section." >&2
    return 1
  fi
  [[ "$result" == "noop" ]] && return 0

  echo "✓ Added git, ${RTK_VERIFY_COMMANDS//,/, } to rtk's exclude_commands in $cfg"
  echo "  Verify with:"
  echo "    echo '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git status\"}}' | rtk hook claude"
  echo "  (empty output means git is no longer being rewritten)"
}

# Confirmed conflict (docs/companion-plugins.md's rtk section has the full story):
# once rtk's PreToolUse hook is active, it rewrites every `git ...` Bash command
# into `rtk git ...`. Claude Code's own worktree-isolation safety net can no
# longer recognize the rewritten command as git and refuses to run ANY git
# command inside an EnterWorktree session (the main checkout is unaffected).
# rtk's own [hooks].exclude_commands config is the supported way to stop it
# rewriting a given command. Without --fix this only warns when "git" is
# missing from that list — same posture as the rest of this file: never edit
# a companion tool's own config as a side effect of setup.sh unless asked.
# `rtk config` always prints "Config: <path>" as its first line, so the path
# is read from there rather than guessed per-platform (macOS vs. XDG). A
# path rtk reports but hasn't actually created yet (before `rtk config
# --create` has ever run) still means git is unexcluded — rtk's own default
# config doesn't exclude it — so that case warns too, rather than being
# silently skipped just because nothing exists there yet.
check_rtk_git_exclusion() {
  local cfg
  cfg="$(rtk config 2>/dev/null | sed -n 's/^Config: //p')"
  [[ -n "$cfg" ]] || return 0

  if [[ ! -f "$cfg" ]]; then
    if [[ "$FIX" == "1" ]]; then
      fix_rtk_git_exclusion "$cfg"
      return
    fi
    {
      echo
      echo "⚠ rtk hasn't created its config file yet ($cfg doesn't exist),"
      echo "  so it's still using its built-in defaults — which do NOT exclude"
      echo "  git, so 'git ...' Bash commands get rewritten into 'rtk git ...'"
      echo "  and Claude Code's worktree-isolation check can't recognize them"
      echo "  (blocks ALL git commands inside any EnterWorktree session; the"
      echo "  main checkout is unaffected). Run:"
      echo "    rtk config --create"
      echo "  then add \"git\" to exclude_commands under [hooks], or re-run"
      echo "  this script with --fix once that file exists."
      echo
    } >&2
    return 0
  fi

  local state
  state="$(rtk_config_git_excluded "$cfg")"
  [[ "$state" == "yes" ]] && return 0

  if [[ "$state" == "partial" && "$FIX" != "1" ]]; then
    {
      echo
      echo "⚠ rtk may condense the output of ${RTK_VERIFY_COMMANDS//,/, } and hide a"
      echo "  failure (a false pass once reached CI). Add them to exclude_commands"
      echo "  under [hooks] in $cfg, or re-run this script with --fix."
      echo
    } >&2
    return 0
  fi

  if [[ "$FIX" == "1" ]]; then
    fix_rtk_git_exclusion "$cfg"
    return
  fi

  {
    echo
    echo "⚠ rtk rewrites 'git ...' Bash commands into 'rtk git ...', and Claude"
    echo "  Code's own worktree-isolation check can't recognize the rewritten"
    echo "  command as git — this blocks ALL git commands inside any"
    echo "  EnterWorktree session (works fine in the main checkout). See"
    echo "  docs/companion-plugins.md's rtk section for the full story. Fix: add"
    echo "  \"git\" to exclude_commands under [hooks] in:"
    echo "    $cfg"
    echo "  Then verify with:"
    echo "    echo '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git status\"}}' | rtk hook claude"
    echo "  (empty output means git is no longer being rewritten)"
    echo "  Or re-run this script with --fix to apply it automatically."
    echo
  } >&2
}

# Python script: reads ~/.claude/settings.json and reports whether the
# require-worktree PreToolUse hook is registered. Prints one of:
#   present       — hook found in an Edit|Write group
#   group-missing — no Edit|Write PreToolUse group exists at all
#   hook-missing  — group exists but our hook command is absent
#   file-missing  — settings.json absent or unreadable
# Called from check_require_worktree_hook below.
WORKTREE_HOOK_STATE_SCRIPT=$(
  cat <<'PYEOF'
import json, os, sys

hook_path = os.path.expanduser(
    "~/.claude/skills/worktree-core/scripts/ts/require-worktree-hook.ts"
)
settings_path = os.path.expanduser("~/.claude/settings.json")

if not os.path.isfile(settings_path):
    print("file-missing")
    sys.exit(0)

try:
    with open(settings_path) as f:
        data = json.load(f)
except Exception:
    print("file-missing")
    sys.exit(0)

pre_tool_use = data.get("hooks", {}).get("PreToolUse", [])

group = None
for entry in pre_tool_use:
    if isinstance(entry, dict) and entry.get("matcher") == "Edit|Write":
        group = entry
        break

if group is None:
    print("group-missing")
    sys.exit(0)

for h in group.get("hooks", []):
    cmd = h.get("command", "") if isinstance(h, dict) else str(h)
    if hook_path in cmd:
        print("present")
        sys.exit(0)

print("hook-missing")
PYEOF
)

# Python script: merges the require-worktree hook into ~/.claude/settings.json.
# Finds or creates the Edit|Write PreToolUse group and ADDs the hook entry to
# its hooks array without disturbing any other PreToolUse entries or matchers.
# Prints "fixed" on success, "noop" if already present. Exits 1 on error.
# Called from fix_require_worktree_hook below.
WORKTREE_HOOK_FIX_SCRIPT=$(
  cat <<'PYEOF'
import json, os, sys

hook_path = os.path.expanduser(
    "~/.claude/skills/worktree-core/scripts/ts/require-worktree-hook.ts"
)
settings_path = os.path.expanduser("~/.claude/settings.json")

with open(settings_path) as f:
    data = json.load(f)

hooks = data.setdefault("hooks", {})
pre_tool_use = hooks.setdefault("PreToolUse", [])

# Find or create the Edit|Write group
group = None
for entry in pre_tool_use:
    if isinstance(entry, dict) and entry.get("matcher") == "Edit|Write":
        group = entry
        break

if group is None:
    group = {"matcher": "Edit|Write", "hooks": []}
    pre_tool_use.append(group)

hook_list = group.setdefault("hooks", [])

# Drop the retired .sh shim entry (removed in #441 phase 6) so it cannot dangle
legacy = "/git-worktree-usage/scripts/require-worktree-hook.sh"
hook_list[:] = [h for h in hook_list
                if legacy not in (h.get("command", "") if isinstance(h, dict) else str(h))]

# No-op if already present
for h in hook_list:
    cmd = h.get("command", "") if isinstance(h, dict) else str(h)
    if hook_path in cmd:
        print("noop")
        sys.exit(0)

# Add the hook, preserving all existing entries in this group
hook_list.append({"type": "command", "command": 'node "{}"'.format(hook_path)})

with open(settings_path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")

print("fixed")
PYEOF
)

# Applies the fix check_require_worktree_hook reports: merges the require-worktree
# hook entry back into the Edit|Write PreToolUse group in ~/.claude/settings.json.
# Uses WORKTREE_HOOK_FIX_SCRIPT above. Only reached behind an explicit --fix.
fix_require_worktree_hook() {
  local settings="$HOME/.claude/settings.json"
  if [[ ! -f "$settings" ]]; then
    {
      echo "Cannot apply fix: $settings does not exist."
      echo "  Run 'claude' once to initialize it, then re-run with --fix."
    } >&2
    return 1
  fi

  local result
  if ! result="$(python3 -c "$WORKTREE_HOOK_FIX_SCRIPT" 2>&1)"; then
    echo "Could not edit $settings: $result" >&2
    return 1
  fi
  [[ "$result" == "noop" ]] && return 0

  echo "✓ Added require-worktree hook to $settings"
  echo "  (Edit|Write PreToolUse group updated; existing hooks preserved)"
  check_worktree_enforce
}

# Checks whether require-worktree-hook.ts is registered in ~/.claude/settings.json
# under a PreToolUse entry with matcher "Edit|Write". This hook can be displaced
# when another tool (e.g. rtk init --global) rewrites the PreToolUse array.
# Detects: present / group-missing / hook-missing / file-missing states.
# --fix: merges the hook back without replacing or disturbing other hook entries.
# Skips entirely when the worktree-core plugin is not linked (check_convention_deps
# will flag that separately).
check_require_worktree_hook() {
  local hook_script="$HOME/.claude/skills/worktree-core/scripts/ts/require-worktree-hook.ts"
  # Plugin not linked — check_convention_deps will surface that
  [[ -f "$hook_script" ]] || return 0

  local state
  state="$(python3 -c "$WORKTREE_HOOK_STATE_SCRIPT" 2>/dev/null)" || state="file-missing"

  case "$state" in
    present)
      echo "✓ require-worktree hook is registered in ~/.claude/settings.json"
      check_worktree_enforce
      ;;
    file-missing)
      {
        echo
        echo "⚠ ~/.claude/settings.json is absent or unreadable — cannot verify"
        echo "  the require-worktree PreToolUse hook registration."
        echo
      } >&2
      ;;
    group-missing)
      if [[ "$FIX" == "1" ]]; then
        fix_require_worktree_hook
        return
      fi
      {
        echo
        echo "⚠ The Edit|Write PreToolUse group is missing from ~/.claude/settings.json."
        echo "  Another tool (e.g. 'rtk init --global') may have rewritten the"
        echo "  PreToolUse array and displaced the require-worktree hook entirely."
        echo "  Hook path: $hook_script"
        echo "  Re-run with --fix to merge it back without disturbing other hooks."
        echo
      } >&2
      ;;
    hook-missing)
      if [[ "$FIX" == "1" ]]; then
        fix_require_worktree_hook
        return
      fi
      {
        echo
        echo "⚠ An Edit|Write PreToolUse group exists in ~/.claude/settings.json but"
        echo "  the require-worktree hook is not in it. Another tool may have displaced"
        echo "  it while rewriting that hook group."
        echo "  Hook path: $hook_script"
        echo "  Re-run with --fix to merge it back without disturbing other hooks."
        echo
      } >&2
      ;;
  esac
}

# Advisory only — no --fix (per-project config is a deliberate opt-in choice).
# Checks whether worktree.enforce is set (and not "off") in the current
# project's .claude/settings.json. Called from check_require_worktree_hook
# when the hook is present or just fixed, so the user sees at a glance whether
# enforcement is actually active for this project.
check_worktree_enforce() {
  local project_settings="${PWD}/.claude/settings.json"

  local enforce_val=""
  if [[ -f "$project_settings" ]]; then
    if command -v jq >/dev/null 2>&1; then
      enforce_val="$(jq -r '.worktree.enforce // empty' "$project_settings" 2>/dev/null)"
    else
      enforce_val="$(python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f:
        d = json.load(f)
    v = d.get('worktree', {}).get('enforce', '')
    print(v if v else '', end='')
except Exception:
    pass
" "$project_settings" 2>/dev/null)"
    fi
  fi

  if [[ -n "$enforce_val" && "$enforce_val" != "off" ]]; then
    echo "✓ worktree.enforce = \"$enforce_val\" in ${PWD}/.claude/settings.json"
    return 0
  fi

  {
    echo
    echo "ℹ require-worktree hook is wired but inactive for this project."
    echo "  The hook reads 'worktree.enforce' from each project's .claude/settings.json."
    echo "  Add it to any project you want protected:"
    echo "    {\"worktree\": {\"enforce\": \"block\"}}"
    echo "  Or set WORKTREE_ENFORCE=block as a session-level env override."
    echo
  } >&2
}

# Advisory only — no --fix. Lists conventions in claude/conventions/ that are
# opt-in (not in DEFAULT_ENABLED) and not yet @-included in either CLAUDE.md
# file. Gives the user a quick inventory of what's available to enable.
check_available_conventions() {
  local conventions_dir="$REPO_ROOT/claude/conventions"
  local default_enabled_file="$conventions_dir/DEFAULT_ENABLED"

  [[ -d "$conventions_dir" ]] || return 0
  [[ -f "$default_enabled_file" ]] || return 0

  # Collect default-enabled convention filenames
  local -a default_enabled=()
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="${line## }"
    line="${line%% }"
    [[ -n "$line" ]] && default_enabled+=("$line")
  done <"$default_enabled_file"

  # Collect currently @-included conventions from both CLAUDE.md files
  local -a included=()
  local f
  for f in "$HOME/.claude/CLAUDE.md" "$HOME/.claude/CLAUDE.personal.md"; do
    [[ -f "$f" ]] || continue
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" =~ ^@${conventions_dir}/([^/]+\.md)$ ]]; then
        included+=("${BASH_REMATCH[1]}")
      fi
    done <"$f"
  done

  # Find opt-in conventions (all .md files not in DEFAULT_ENABLED, not README.md)
  # that are not already included
  local -a available=()
  local fname is_default is_included
  for fname in "$conventions_dir"/*.md; do
    [[ -f "$fname" ]] || continue
    fname="$(basename "$fname")"
    [[ "$fname" == "README.md" ]] && continue

    is_default=0
    [[ ${#default_enabled[@]} -gt 0 ]] && for d in "${default_enabled[@]}"; do
      [[ "$d" == "$fname" ]] && is_default=1 && break
    done
    [[ "$is_default" == 1 ]] && continue

    is_included=0
    [[ ${#included[@]} -gt 0 ]] && for i in "${included[@]}"; do
      [[ "$i" == "$fname" ]] && is_included=1 && break
    done
    [[ "$is_included" == 1 ]] && continue

    available+=("$fname")
  done

  [[ ${#available[@]} -eq 0 ]] && return 0

  {
    echo
    echo "ℹ ${#available[@]} opt-in convention(s) available but not enabled:"
    for fname in "${available[@]}"; do
      echo "    $fname"
    done
    echo "  Add any to your ~/.claude/CLAUDE.personal.md with:"
    echo "    @$conventions_dir/<name>"
    echo
  } >&2
}

# Check that every convention the user has opted into (via DEFAULT_ENABLED or
# CLAUDE.personal.md) has its required plugin(s) linked under ~/.claude/skills/.
# The dep map lives in claude/conventions/CONVENTION_DEPS: one line per
# convention, value is a pipe-separated list of alternatives (any one satisfies
# the dep). Warnings match the ⚠ advisory style used throughout this script.
check_convention_deps() {
  local deps_file="$REPO_ROOT/claude/conventions/CONVENTION_DEPS"
  [[ -f "$deps_file" ]] || return 0

  # Collect every convention filename currently @-included in either CLAUDE.md
  # file. Lines look like: @/path/to/agent-config/claude/conventions/foo.md
  local included_conventions=()
  local f line
  for f in "$HOME/.claude/CLAUDE.md" "$HOME/.claude/CLAUDE.personal.md"; do
    [[ -f "$f" ]] || continue
    while IFS= read -r line || [[ -n "$line" ]]; do
      # Match @<REPO_ROOT>/claude/conventions/<name>.md only — not a same-named
      # convention from a different repository.
      if [[ "$line" =~ ^@${REPO_ROOT}/claude/conventions/([^/]+\.md)$ ]]; then
        included_conventions+=("${BASH_REMATCH[1]}")
      fi
    done <"$f"
  done

  [[ ${#included_conventions[@]} -eq 0 ]] && return 0

  # For each convention that has a dep entry, check whether at least one
  # of the required plugins is linked under ~/.claude/skills/.
  local convention dep_spec plugin satisfied
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="${line## }"
    line="${line%% }"
    [[ -n "$line" ]] || continue

    convention="${line%%:*}"
    dep_spec="${line#*:}"
    [[ -n "$convention" && -n "$dep_spec" ]] || continue

    # Is this convention currently included?
    local is_included=0
    for f in "${included_conventions[@]}"; do
      [[ "$f" == "$convention" ]] && is_included=1 && break
    done
    [[ "$is_included" == 1 ]] || continue

    # Is at least one of the required plugins linked?
    satisfied=0
    IFS='|' read -r -a plugins <<<"$dep_spec"
    for plugin in "${plugins[@]}"; do
      # -L: is a symlink; -e: target exists (rules out dangling links)
      [[ -L "$HOME/.claude/skills/$plugin" && -e "$HOME/.claude/skills/$plugin" ]] && satisfied=1 && break
    done

    if [[ "$satisfied" == 0 ]]; then
      {
        echo
        echo "⚠ Convention $convention is active but its required plugin is not linked."
        echo "  This convention directs Claude to load a skill from: ${dep_spec//|/ or }"
        echo "  but none of those plugins are linked under ~/.claude/skills/."
        echo "  Re-run setup.sh without --include/--skip restrictions, or add one of"
        echo "  these plugins explicitly:"
        IFS='|' read -r -a plugins <<<"$dep_spec"
        for plugin in "${plugins[@]}"; do
          echo "    ./setup.sh --include=$plugin"
        done
        echo
      } >&2
    fi
  done <"$deps_file"
}

# Playwright CLI (@playwright/cli): an optional companion to the playwright
# plugin, which scripts the `playwright` npm package per project and does not
# call the CLI itself. The CLI matters only for its official skill (see
# docs/companion-plugins.md), so a missing CLI is informational, like rtk.
# `playwright` the npm package is deliberately not checked: it is a
# per-project dependency and this script runs in the repo, not the project.
# --install-deps installs the CLI (npm install -g) the same opt-in way it
# installs pyte; it never installs the skill, which the user chooses to place
# globally or per project.
install_playwright_cli() {
  local node_major
  command -v npm >/dev/null 2>&1 || {
    echo "Not installing @playwright/cli: npm is not on PATH." >&2
    return 1
  }
  node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [[ "$node_major" -lt 22 ]]; then
    echo "Not installing @playwright/cli: node on PATH is v$node_major, this repo uses Node 22 (.nvmrc)." >&2
    echo "  Put Node 22 first on PATH (e.g. nvm use 22) and re-run." >&2
    return 1
  fi
  echo "Installing @playwright/cli: npm install -g @playwright/cli@latest"
  npm install -g @playwright/cli@latest || {
    echo "npm install failed." >&2
    return 1
  }
  command -v playwright-cli >/dev/null 2>&1 || {
    echo "npm reported success, but playwright-cli is not on PATH." >&2
    return 1
  }
  echo "✓ @playwright/cli installed"
}

check_playwright_cli() {
  if ! command -v playwright-cli >/dev/null 2>&1; then
    if [[ "$INSTALL_DEPS" == "1" ]]; then
      install_playwright_cli || return 1
    else
      {
        echo
        echo "ℹ playwright-cli (@playwright/cli) is not installed — an optional companion"
        echo "  to the playwright plugin, not required by anything here. Install it with:"
        echo "    npm install -g @playwright/cli@latest"
        echo "  or re-run this script as: ./setup.sh --install-deps"
        echo
      } >&2
      return 0
    fi
  fi
  echo "✓ playwright-cli is installed ($(playwright-cli --version 2>/dev/null || echo "version unknown"))"
  if [[ ! -e "$HOME/.claude/skills/playwright-cli/SKILL.md" ]]; then
    {
      echo
      echo "ℹ The official playwright-cli skill is not installed globally. Install it with:"
      echo "    playwright-cli install --skills -g"
      echo "  (without -g it is installed into the current project's .claude/skills)."
      echo "  Re-run after each @playwright/cli update to refresh it."
      echo
    } >&2
  fi
}

# --------------------------------------------------------------------------
# Dangling entries
#
# Finds leftovers from things this install used to own: hook commands in
# ~/.claude/settings.json whose script file is gone, and symlinks in
# ~/.claude/skills and ~/.claude/commands whose target is gone. Ownership is
# deliberately narrow, so foreign entries are never touched: a hook counts
# only if a path in its command sits under ~/.claude/skills, ~/.claude/commands,
# or this repo (or its main checkout), and a symlink only if its target sits
# under this repo, its main checkout, or ~/.claude/plugins. A hook command with
# no such path (e.g. `rtk hook claude`) is skipped.
# Prints one tab-separated line per finding: "hook EVENT COMMAND" or
# "link PATH TARGET".
# --------------------------------------------------------------------------
DANGLING_SCRIPT=$(
  cat <<'PYEOF'
import json, os, shlex

home, repo = os.environ["HOME"], os.environ["REPO"]
roots = [repo]
if os.environ.get("MAIN_ROOT"):
    roots.append(os.environ["MAIN_ROOT"])
hook_roots = roots + [home + "/.claude/skills", home + "/.claude/commands"]
link_roots = roots + [home + "/.claude/plugins"]

def under(path, rs):
    path = os.path.normpath(path)
    return any(path == r or path.startswith(r.rstrip("/") + "/") for r in rs)

try:
    with open(home + "/.claude/settings.json") as f:
        hooks = json.load(f).get("hooks", {})
except Exception:
    hooks = {}
for event, entries in hooks.items():
    for entry in entries if isinstance(entries, list) else []:
        for h in entry.get("hooks", []) if isinstance(entry, dict) else []:
            cmd = h.get("command", "") if isinstance(h, dict) else ""
            try:
                tokens = shlex.split(cmd)
            except ValueError:
                continue
            for t in tokens:
                t = os.path.expandvars(os.path.expanduser(t))
                if t.startswith("/") and under(t, hook_roots) and not os.path.exists(t):
                    print("hook\t%s\t%s" % (event, cmd))
                    break

for d in ("skills", "commands"):
    base = os.path.join(home, ".claude", d)
    if not os.path.isdir(base):
        continue
    for name in sorted(os.listdir(base)):
        p = os.path.join(base, name)
        if os.path.islink(p) and not os.path.exists(p):
            raw = os.readlink(p)
            t = raw if os.path.isabs(raw) else os.path.join(base, raw)
            if under(t, link_roots):
                print("link\t%s\t%s" % (p, raw))
PYEOF
)

check_dangling() {
  if ! command -v python3 >/dev/null 2>&1; then
    echo "⚠ python3 not found — skipping the dangling-entry check" >&2
    return 0
  fi
  local main_root="" common settings="$HOME/.claude/settings.json"
  if common="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; then
    main_root="$(dirname "$common")"
  fi

  local findings
  findings="$(REPO="$REPO_ROOT" MAIN_ROOT="$main_root" python3 -c "$DANGLING_SCRIPT")" || {
    echo "⚠ the dangling-entry check failed to run" >&2
    return 0
  }
  if [[ -z "$findings" ]]; then
    echo "✓ no dangling hook entries or symlinks in ~/.claude"
    return 0
  fi

  local kind a b backed_up=0 ts
  while IFS=$'\t' read -r kind a b; do
    if [[ "$FIX" != "1" ]]; then
      if [[ "$kind" == "hook" ]]; then
        echo "⚠ dangling $a hook in $settings (script no longer exists): $b" >&2
      else
        echo "⚠ dangling symlink (target no longer exists): $a -> $b" >&2
      fi
      continue
    fi
    if [[ "$kind" == "hook" ]]; then
      if [[ "$backed_up" == 0 ]]; then
        ts="$(date +%Y%m%d%H%M%S)"
        if cp "$settings" "$settings.bak-$ts"; then
          echo "Backed up $settings to $settings.bak-$ts"
          backed_up=1
        else
          echo "⚠ could not back up $settings; not removing dangling hooks" >&2
          backed_up=-1
        fi
      fi
      [[ "$backed_up" == 1 ]] || continue
      echo "Removing dangling $a hook: $b"
      ensure_hook_deregistered "$a" "$b" "$settings"
    else
      rm "$a"
      echo "Removed dangling symlink: $a -> $b"
    fi
  done <<<"$findings"
  if [[ "$FIX" != "1" ]]; then
    echo "  Run './doctor.sh --fix' to remove them." >&2
  fi
}

# --------------------------------------------------------------------------
# Dangling @-includes
#
# Scans ~/.claude/CLAUDE.md and ~/.claude/CLAUDE.personal.md (only these two;
# nested includes are not followed) for `@path` lines whose file is gone.
# Ownership is narrow: a missing absolute path under this repo's claude/ tree
# (or its main checkout's) is ours -- reported, and removed by --fix after a
# timestamped backup. Any other missing include (relative like `@RTK.md`, or
# outside the repo) is only warned about, never removed.
# --------------------------------------------------------------------------
check_dangling_includes() {
  local roots=("$REPO_ROOT/claude/") common
  if common="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; then
    roots+=("$(dirname "$common")/claude/")
  fi
  local found=0 name file lineno raw path base r owned note ts drop
  for name in CLAUDE.md CLAUDE.personal.md; do
    file="$HOME/.claude/$name"
    [[ -f "$file" ]] || continue
    local -a mine=()
    lineno=0
    while IFS= read -r raw || [[ -n "$raw" ]]; do
      lineno=$((lineno + 1))
      [[ "$raw" =~ ^@([^[:space:]]+)$ ]] || continue
      path="${BASH_REMATCH[1]}"
      case "$path" in
        \~/*) path="$HOME/${path:2}" ;;
      esac
      [[ "$path" == /* ]] || path="$HOME/.claude/$path"
      [[ -e "$path" ]] && continue
      found=1
      owned=0
      for r in "${roots[@]}"; do
        [[ "$path" == "$r"* ]] && owned=1
      done
      if [[ "$owned" == 0 ]]; then
        echo "⚠ $file:$lineno includes a missing file (left alone; not ours): ${raw#@}" >&2
        continue
      fi
      base="$(basename "$path" .md)"
      note=""
      [[ -d "$REPO_ROOT/plugins/$base" ]] && note=" -- now loads as the $base skill, nothing lost"
      if [[ "$FIX" != "1" ]]; then
        echo "⚠ $file:$lineno includes a file that no longer exists: ${raw#@}$note" >&2
      else
        mine+=("$lineno")
        echo "Removing dangling include from $file:$lineno: ${raw#@}$note"
      fi
    done <"$file"
    if [[ "$FIX" == "1" && ${#mine[@]} -gt 0 ]]; then
      ts="$(date +%Y%m%d%H%M%S)"
      if cp "$file" "$file.bak-$ts"; then
        echo "Backed up $file to $file.bak-$ts"
        drop=" ${mine[*]} "
        awk -v drop="$drop" 'index(drop, " " NR " ") == 0' "$file" >"$file.tmp-$ts" &&
          cat "$file.tmp-$ts" >"$file"
        rm -f "$file.tmp-$ts"
      else
        echo "⚠ could not back up $file; not removing dangling includes" >&2
      fi
    fi
  done
  if [[ "$found" == 0 ]]; then
    echo "✓ no dangling @-includes in ~/.claude/CLAUDE.md or CLAUDE.personal.md"
  elif [[ "$FIX" != "1" ]]; then
    echo "  Run './doctor.sh --fix' to remove the ones from this repo." >&2
  fi
}

check_convention_deps
check_available_conventions
check_dangling
check_dangling_includes
check_git_identity
check_python_deps

# mattpocock-skills: the id can be "mattpocock-skills@mattpocock" (self-hosted
# fallback) or "@claude-plugins-official" - either satisfies the check, so the
# marketplace suffix is deliberately not matched.
check_companion_plugin "mattpocock-skills@" "mattpocock-skills" \
  "mattpocock-skills" "mattpocock-skills" \
  "claude plugin install mattpocock-skills"

# anthropics/skills (frontend-design): not in the official marketplace
# (checked directly against anthropics/claude-plugins-official's own manifest
# - absent), so unlike mattpocock-skills, getting it requires adding its
# marketplace first; the install id is always
# "example-skills@anthropic-agent-skills", never a "@claude-plugins-official"
# variant.
check_companion_plugin "example-skills@" "anthropics/skills (frontend-design)" \
  "anthropics/skills" "example-skills" \
  "claude plugin marketplace add anthropics/skills" \
  "claude plugin install example-skills"

check_react_skills

# aws-core: Amazon Web Services' own plugin (part of aws/agent-toolkit-for-aws,
# GA) and - like mattpocock-skills - ships directly in Claude Code's official
# marketplace, confirmed against anthropics/claude-plugins-official's own
# manifest, so its install id is always "aws-core@claude-plugins-official"
# with no marketplace-add step first. aws-agents-for-devsecops (the
# security-auditing companion documented alongside aws-core in the README)
# deliberately has no check here: it needs a plugin-specific
# /aws-agents-for-devsecops:setup step before use, so installed/not-installed
# alone would misstate whether it's actually ready.
check_companion_plugin "aws-core@" "aws-core" "aws-core" "aws-core" \
  "claude plugin install aws-core@claude-plugins-official"

check_rtk
check_playwright_cli
check_require_worktree_hook

# ponytail: DietrichGebert/ponytail isn't in the official marketplace; its own
# .claude-plugin/marketplace.json names both the marketplace and the plugin
# "ponytail", so the install id is "ponytail@ponytail".
check_companion_plugin "ponytail@" "ponytail" "ponytail" "ponytail" \
  "claude plugin marketplace add DietrichGebert/ponytail" \
  "claude plugin install ponytail"

# Also last: offers (opt-in, y/n) to pre-approve Aikido Safe Chain's pinned
# installer command in Claude Code's permission settings. See
# scripts/offer-safe-chain-permission.sh for why — it decides on its own
# whether it's safe to prompt (skips cleanly under CI or a non-interactive
# run). Unlike the checks above, it can genuinely fail (missing jq, a corrupt
# settings.json) rather than always reporting 0, so `|| true` keeps it
# advisory here.
"$REPO_ROOT/scripts/offer-safe-chain-permission.sh" || true
