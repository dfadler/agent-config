#!/usr/bin/env bash
# Entry points for this repo's shell, Python and kcov checks. CI calls
# `bash scripts/ci.sh <target>` and humans run the same command, so a green `scripts/ci.sh check` locally
# means the same thing a green PR does. The Node-based checks are package.json
# scripts (`pnpm run <name>`); this script reaches them for the `check`
# aggregate and the Node targets, and installs node_modules on demand.
#
# Requires: shellcheck, shfmt, bats, actionlint — `check` depends on all four.
#   brew install shellcheck shfmt bats-core actionlint
#
# `coverage` additionally needs kcov and jq, and only MEASURES anything on
# Linux — see the comment above that target. `coverage-py` needs jq too (to
# read pytest-cov's JSON report the same way `coverage` reads kcov's), but
# runs on any platform pytest itself does — coverage.py has no macOS SIP
# restriction the way kcov's bash instrumentation does.
#
# The Python side (the detached-terminal skill and the gha-ci-audit plugin)
# needs a virtualenv. Every target that shells out to ruff/mypy/pytest builds
# `venv` first and always runs through .venv's pinned interpreter (never
# whatever `python3` happens to resolve to on PATH) — a stray, unpinned global
# ruff install produced a confusing false "would reformat" failure once
# because it disagreed with the ruff==0.9.6 pinned in requirements-dev.txt.
# The shell targets (lint-shellcheck, lint-shfmt, structure, test-sh,
# coverage) need no Python at all, so a shell-only contributor never triggers
# the venv build.
set -euo pipefail

# Exit-code taxonomy — see the hygiene baseline in claude/CLAUDE.md.
readonly EXIT_OK=0
readonly EXIT_USAGE=2

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Every shell script in the repo, NUL-safe. Kept as a `find` rather than a
# hand-maintained list so a new script is covered the moment it lands.
sh_find() { find scripts plugins setup.sh teardown.sh doctor.sh -type f -name '*.sh' -print0; }

# Python sources: the skills' implementations plus their tests. A new file in
# a directory not already listed here also needs its directory to reach
# PY_COVERAGE_DIRS below (derived, so it follows automatically).
PY_SOURCES=(
  plugins/detached-terminal/scripts/agent_term.py
  scripts/tests/test_agent_term.py
  plugins/gha-ci-audit/scripts/aggregate.py
  plugins/gha-ci-audit/scripts/analyze_jobs.py
  plugins/gha-ci-audit/scripts/analyze_runs.py
  plugins/gha-ci-audit/scripts/check_failures.py
  plugins/gha-ci-audit/scripts/check_status.py
  plugins/gha-ci-audit/scripts/collect_pipeline.py
  plugins/gha-ci-audit/scripts/compute_workflow_timing.py
  plugins/gha-ci-audit/scripts/find_p50_run.py
  plugins/gha-ci-audit/scripts/grade.py
  plugins/gha-ci-audit/scripts/merge_timing.py
  plugins/gha-ci-audit/scripts/timing.py
  plugins/gha-ci-audit/scripts/write_assertions.py
  plugins/gha-ci-audit/scripts/utils.py
  plugins/gha-ci-audit/tests/test_gha_ci_audit.py
)
PY_TESTS=(scripts/tests plugins/gha-ci-audit/tests)

# The non-test entries of PY_SOURCES, reduced to their containing directories,
# is what `coverage-py` points pytest-cov at. Deliberately directory-based
# rather than file-based: pytest-cov refused to attribute any coverage when
# pointed at an exact `*.py` path (agent_term.py is loaded by its tests via
# `importlib` under a synthetic module name, which `--cov=<file>` cannot
# match), while a directory makes it discover every `.py` file from the
# filesystem. A new file in a DIFFERENT directory has to be added to
# PY_SOURCES first, the same manual step lint-py and typecheck already need.
py_coverage_dirs() {
  printf '%s\n' "${PY_SOURCES[@]}" | grep -v -e '^scripts/tests/' -e '^plugins/gha-ci-audit/tests/' |
    xargs -n1 dirname | sort -u | sed 's|$|/|'
}

VENV=.venv
VENV_STAMP=$VENV/.installed
PY=$VENV/bin/python
NODE_STAMP=node_modules/.installed

# Coverage settings. The floor is a MEASURED baseline, not an aspiration: 70%
# was the first honest measurement (70.24%); it was lowered to 67 after the
# gh-attach-image upload script (well covered by bats) moved to TypeScript and
# left the denominator, leaving 67.99%; and to 66 after the worktree-core hooks
# and prune/verify scripts (also well covered by bats) moved to TypeScript, leaving 66.38%. All are rounded DOWN — kcov line coverage
# jitters by fractions of a point as scripts and tests change shape, so the
# floor sits just under the measurement rather than exactly on it. Measured
# on ubuntu-24.04 with kcov 42 and bats at the commit shell.yml pins. Lowering
# this takes a deliberate commit; raising it as coverage improves is welcome.
COVERAGE_DIR="${COVERAGE_DIR:-coverage}" # overridable so tests never delete a live kcov output dir
COVERAGE_MIN=66

# What lands in the denominator, and what doesn't:
#
#   * --include-path keeps the measurement to THIS repo's scripts. Without it
#     kcov also instruments bats itself (its lib/ and libexec/ bash) and the
#     preprocessed .bats.src copies of the test files, and the percentage then
#     measures bats-core far more than anything here.
#   * --exclude-pattern drops scripts/tests: helpers.bash is test scaffolding,
#     and scaffolding that grades itself inflates the number. It also drops
#     scripts/ci.sh: it is the CI runner itself (its targets are what CI
#     executes, not what bats tests), and the bats suite only touches its
#     argument handling, so including it would measure ~200 untested
#     orchestration lines and sink the floor from 70% to 63% for no signal.
#   * kcov's bash coverage is trace-based, so a script only enters the
#     denominator once something EXECUTES it. A script no test ever runs
#     (historically, the gh-attach-image skill's upload script) is invisible rather than
#     a 0, so this gate does not by itself catch an untested new script; and
#     setup.sh is exercised only through a throwaway copy its suite makes
#     under TMPDIR (see scripts/tests/setup.bats), which kcov attributes to
#     that temp path rather than to setup.sh here. Both are gaps in what the
#     floor guards, not claims that the code is untested.
KCOV_INCLUDE="$ROOT/scripts,$ROOT/plugins,$ROOT/setup.sh"
KCOV_EXCLUDE=/scripts/tests,/scripts/ci.sh

# Python's own coverage floor, the sibling of COVERAGE_MIN (dfadler/
# agent-config#208). Same discipline: the first honest measurement rounded
# DOWN. 52 is `coverage-py` measured on macOS (Python 3.14.7, pytest==9.0.3,
# pytest-cov==7.1.0 pinned in requirements-dev.txt) after the gha-ci-audit
# scripts and their tests were wired in; the measurement is
# platform-independent (coverage.py, unlike kcov, instruments Python
# everywhere). It is low because agent_term.py's CLI/daemon dispatch
# (cmd_start, serve, bind_control_socket, the socket loop) is exercised only
# by real usage, not by the unit tests — a real gap, not a measurement error.
# Lowering this takes a deliberate commit; raising it is welcome.
COVERAGE_PY_DIR=coverage-py
COVERAGE_PY_MIN=52

# What lands in the denominator — the Python mirror of the kcov comment:
#
#   * --cov is pointed at py_coverage_dirs, never at the test directories —
#     grading the test scaffolding against itself would inflate the number.
#   * UNLIKE kcov, coverage.py's directory mode DOES count a file it never
#     executed: a wholly-untested `.py` file dropped into a listed directory
#     shows up as an explicit 0% entry. It is NOT closed for a new Python file
#     in a directory not yet listed — add it to PY_SOURCES first.
#   * diff/patch coverage (diff-cover) was investigated and deliberately left
#     as follow-up.

usage() {
  cat <<'USAGE'
Usage: scripts/ci.sh [-h|--help] <target>

Run one of this repo's checks. CI runs the same targets.

Shell (no Python or Node needed):
  lint-shellcheck   shellcheck over every shell script
  lint-shfmt        shfmt -i 2 -ci -d (check only)
  structure         validate plugin manifests and skill/agent frontmatter
  test-sh           bats suites under scripts/tests
  coverage          bats under kcov, enforce the floor (Linux only; skips elsewhere)
  lint-actions      actionlint over .github/workflows
  fmt               rewrite shell and Python sources to the repo's style
Python (builds .venv from requirements-dev.txt on demand):
  venv              create/refresh .venv
  lint-py           ruff check + ruff format --check
  typecheck         mypy --strict
  test-py           pytest
  coverage-py       pytest-cov, enforce the floor
  fmt-py            rewrite Python to ruff's style
Node (installs node_modules on demand; the work is a package.json script):
  node-modules      pnpm install --frozen-lockfile
  lint-set-flags lint-claude-md lint-ts typecheck-ts check-skills
  lint-plugin-evals check-vitest-flags check-vitest-v3-names test-ts
  coverage-ts check-links
Aggregates:
  lint-sh           shellcheck + shfmt + set-flags + CLAUDE.md size
  lint test         lint-sh + lint-py; test-sh + test-py
  check             everything CI runs

  -h, --help        Show this message and exit.
USAGE
}

# A stamp file, not a re-run-every-time step: only rebuild when an input is
# newer than the stamp (or the stamp doesn't exist yet), so repeat local runs
# stay fast.
stale() { [ ! -f "$1" ] || [ -n "$(find "${@:2}" -newer "$1" -print -quit)" ]; }

venv() {
  stale "$VENV_STAMP" requirements-dev.txt || return 0
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q --upgrade pip
  "$VENV/bin/pip" install -q -r requirements-dev.txt
  touch "$VENV_STAMP"
  echo "✓ $VENV ready"
}

node_modules() {
  stale "$NODE_STAMP" package.json pnpm-lock.yaml || return 0
  pnpm install --frozen-lockfile --silent
  touch "$NODE_STAMP"
  echo "✓ node_modules ready"
}

# Run a package.json script after making sure its dependencies are installed.
pnpm_script() {
  node_modules
  pnpm run --silent "$1"
}

lint_shellcheck() { sh_find | xargs -0 shellcheck; }
lint_shfmt() { sh_find | xargs -0 shfmt -i 2 -ci -d; }

lint_sh() {
  lint_shellcheck
  lint_shfmt
  pnpm_script lint-set-flags
  pnpm_script lint-claude-md
}

lint_py() {
  venv
  "$PY" -m ruff check "${PY_SOURCES[@]}"
  "$PY" -m ruff format --check "${PY_SOURCES[@]}"
}

typecheck() {
  venv
  "$PY" -m mypy --strict --ignore-missing-imports "${PY_SOURCES[@]}"
}

fmt_py() {
  venv
  "$PY" -m ruff check --fix "${PY_SOURCES[@]}"
  "$PY" -m ruff format "${PY_SOURCES[@]}"
}

fmt() {
  fmt_py
  sh_find | xargs -0 shfmt -i 2 -ci -w
}

test_py() {
  venv
  "$PY" -m pytest "${PY_TESTS[@]}" -q
}

# Re-runs the bats suite under kcov and enforces COVERAGE_MIN above.
#
# LINUX ONLY, deliberately and loudly: kcov instruments bash by injecting a
# helper library into the traced shell, and macOS System Integrity Protection
# strips DYLD_INSERT_LIBRARIES from /bin/bash. Every script this suite runs is
# therefore invisible to kcov on a Mac and the measurement comes back 0.00% —
# a number that would fail the gate for a reason having nothing to do with the
# tests. Rather than let that make `check` unrunnable on the machine most of
# this repo is written on, the target says so and skips. It never skips under
# CI: the CI environment variable is set on every GitHub runner, so a
# Linux-only gate can't be silently lost by a future runner change.
coverage() {
  if [ "$(uname -s)" != Linux ] && [ -z "${CI:-}" ]; then
    echo "coverage: skipped — kcov cannot instrument bash on $(uname -s) (macOS SIP strips DYLD_INSERT_LIBRARIES from /bin/bash);"
    echo "          the gate runs on Linux in CI."
    return 0
  fi
  rm -rf "$COVERAGE_DIR"
  kcov --include-path="$KCOV_INCLUDE" --exclude-pattern="$KCOV_EXCLUDE" \
    "$COVERAGE_DIR" bats scripts/tests
  bash scripts/check-shell-coverage.sh \
    "$(find "$COVERAGE_DIR" -maxdepth 2 -name coverage.json -print -quit)" "$COVERAGE_MIN"
}

# Same contract as `coverage`, but with no platform skip: coverage.py has no
# macOS equivalent of kcov's SIP restriction.
coverage_py() {
  venv
  rm -rf "$COVERAGE_PY_DIR"
  mkdir -p "$COVERAGE_PY_DIR"
  local cov=()
  local d
  while IFS= read -r d; do cov+=("--cov=$d"); done < <(py_coverage_dirs)
  "$PY" -m pytest "${PY_TESTS[@]}" -q "${cov[@]}" \
    --cov-report=term-missing \
    --cov-report=json:"$COVERAGE_PY_DIR/py-coverage.json"
  bash scripts/check-python-coverage.sh "$COVERAGE_PY_DIR/py-coverage.json" "$COVERAGE_PY_MIN"
}

# `check` must be the UNION of what every workflow runs. The split, so a new
# target lands in both places:
#
#   shell.yml      lint-shellcheck, lint-shfmt, lint-set-flags, lint-claude-md,
#                  structure, test-sh, coverage
#   python.yml     lint-py, typecheck, test-py, coverage-py
#   typescript.yml lint-ts, typecheck-ts, check-skills, lint-plugin-evals,
#                  check-vitest-flags, check-vitest-v3-names, test-ts, coverage-ts
#   actionlint.yml lint-actions
#
# Each workflow calls its own subset rather than `check` — shell.yml has no
# Python installed, and pointing it at an aggregate that had grown a pytest
# dependency is exactly how this broke once already.
check() {
  local t
  for t in lint-sh lint-py structure typecheck test-sh test-py lint-actions coverage coverage-py \
    lint-ts typecheck-ts check-skills lint-plugin-evals check-vitest-flags check-vitest-v3-names \
    test-ts coverage-ts; do
    echo "==> $t"
    run_target "$t"
  done
}

# Targets that are a package.json script of the same name, or the renamed
# short ones (lint-ts -> lint, typecheck-ts -> typecheck, ...).
pnpm_name() {
  case "$1" in
    lint-ts) echo lint ;;
    typecheck-ts) echo typecheck ;;
    test-ts) echo test ;;
    coverage-ts) echo coverage ;;
    lint-set-flags | lint-claude-md | check-skills | lint-plugin-evals | check-vitest-flags | check-vitest-v3-names | check-links) echo "$1" ;;
    *) return 1 ;;
  esac
}

run_target() {
  local script
  if script="$(pnpm_name "$1")"; then
    pnpm_script "$script"
    return
  fi
  case "$1" in
    venv) venv ;;
    node-modules) node_modules ;;
    lint-shellcheck) lint_shellcheck ;;
    lint-shfmt) lint_shfmt ;;
    lint-sh) lint_sh ;;
    lint-py) lint_py ;;
    lint) lint_sh && lint_py ;;
    typecheck) typecheck ;;
    fmt) fmt ;;
    fmt-py) fmt_py ;;
    structure) bash scripts/check-plugin-structure.sh ;;
    test-sh) bats scripts/tests ;;
    test-py) test_py ;;
    test) bats scripts/tests && test_py ;;
    coverage) coverage ;;
    coverage-py) coverage_py ;;
    lint-actions) actionlint ;;
    check) check ;;
    *)
      echo "ci.sh: unknown target '$1'" >&2
      usage >&2
      exit "$EXIT_USAGE"
      ;;
  esac
}

case "${1:-}" in
  -h | --help)
    usage
    exit "$EXIT_OK"
    ;;
  "")
    usage >&2
    exit "$EXIT_USAGE"
    ;;
esac

run_target "$1"
