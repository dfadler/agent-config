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
                   install --user pyte), when the interpreter allows it.
  --fix            Also apply other known fixes for a problem this script
                   detects, instead of only reporting it (currently: adding
                   "git" to rtk's own exclude_commands config when rtk's
                   PreToolUse hook would otherwise break git commands inside
                   a worktree-isolated session — see docs/companion-plugins.md).
                   Never runs as a side effect of a bare invocation.
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

# Applies the fix check_rtk_git_exclusion (below) reports: adds "git" to
# rtk's own [hooks].exclude_commands in its config.toml. Only reached behind
# an explicit --fix — this is the one place in this script that edits a
# companion tool's own persistent config rather than this repo's, gated the
# same way install_pyte is gated behind --install-deps: never as a side
# effect of a bare invocation.
#
# Locates and rewrites only the exclude_commands array inside the [hooks]
# section (same section-tracking logic check_rtk_git_exclusion uses) rather
# than a blind string replace across the whole file, and appends "git" to
# whatever entries are already there instead of assuming the array is empty
# — so an existing exclusion (e.g. a test command) survives the edit.
fix_rtk_git_exclusion() {
  local cfg="$1"
  # Passed via `-c` (like claude_plugin_state's own python3 call above) rather
  # than piped to stdin: a test's fake python3 (shim_python3 in
  # scripts/tests/helpers.bash) only recognizes -c/-m and forwards to the
  # real interpreter, so a bare heredoc-to-stdin call would be swallowed by
  # that shim during check-companions.bats's rtk tests.
  local py_src
  py_src=$(
    cat <<'PYEOF'
import os, re

path = os.environ["RTK_CONFIG_PATH"]
with open(path) as f:
    lines = f.readlines()

in_hooks = False
fixed = False
for i, line in enumerate(lines):
    stripped = line.strip()
    if stripped.startswith("[") and stripped != "[hooks]":
        in_hooks = False
    if stripped == "[hooks]":
        in_hooks = True
        continue
    if in_hooks:
        m = re.match(r'^(\s*exclude_commands\s*=\s*)\[(.*)\]\s*$', line.rstrip("\n"))
        if m:
            prefix, inner = m.group(1), m.group(2)
            entries = [e.strip() for e in inner.split(",") if e.strip()]
            if any(e.strip("\"'") == "git" for e in entries):
                fixed = True  # already present — nothing to do
                break
            entries.append('"git"')
            lines[i] = prefix + "[" + ", ".join(entries) + "]\n"
            fixed = True
            break

if not fixed:
    raise SystemExit(1)

with open(path, "w") as f:
    f.writelines(lines)
PYEOF
  )
  if ! RTK_CONFIG_PATH="$cfg" python3 -c "$py_src"; then
    echo "Could not automatically edit $cfg — no exclude_commands line found" >&2
    echo "  under [hooks]. Add \"git\" to it yourself; see" >&2
    echo "  docs/companion-plugins.md's rtk section." >&2
    return 1
  fi

  echo "✓ Added \"git\" to rtk's exclude_commands in $cfg"
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
# is read from there rather than guessed per-platform (macOS vs. XDG). The
# exclude_commands check itself is a plain substring grep, not a TOML parser
# — good enough for an advisory check, and consistent with this repo not
# carrying a TOML-parsing dependency anywhere else.
check_rtk_git_exclusion() {
  local cfg
  cfg="$(rtk config 2>/dev/null | sed -n 's/^Config: //p')"
  [[ -n "$cfg" && -f "$cfg" ]] || return 0

  if awk '/^\[hooks\]/{f=1;next} /^\[/{f=0} f' "$cfg" | grep -q 'exclude_commands.*"git"'; then
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

check_convention_deps
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
