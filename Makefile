# Entry points for this repo's checks. CI calls these exact targets, so a green
# `make check` locally means the same thing a green PR does — the two can't
# drift the way a hand-copied CI command list does.
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
# The Python side (the detached-terminal skill) needs a virtualenv. Every
# target that shells out to ruff/mypy/pytest depends on `venv` and always
# runs through .venv's pinned interpreter (never whatever `python3` happens
# to resolve to on PATH) — a stray, unpinned global ruff install produced a
# confusing false "would reformat" failure on this exact file (unrelated to
# whatever change was actually in flight) because it disagreed with the
# ruff==0.9.6 this repo pins in requirements-dev.txt. `lint-sh`/`structure`/
# `test-sh`/`coverage` need no Python at all, so a shell-only contributor
# never triggers the venv build.

SHELL := /usr/bin/env bash

# Every shell script in the repo, NUL-safe. Kept as a `find` rather than a
# hand-maintained list so a new script is covered the moment it lands.
SH_FIND := find scripts plugins setup.sh -type f -name '*.sh' -print0

# Python sources: the skill's implementation plus its tests.
PY_SOURCES := plugins/dfadler-agent-config/skills/detached-terminal/scripts/agent_term.py \
              scripts/tests/test_agent_term.py

# The non-test entries of PY_SOURCES, reduced to their containing
# directories, is what `coverage-py` points pytest-cov at. This is
# deliberately directory-based rather than file-based: pytest-cov refused to
# attribute any coverage at all when pointed at an exact `*.py` path here
# (coverage.py's own module-resolution warned "was never imported", because
# agent_term.py is loaded by the test suite via `importlib` under a synthetic
# module name, not a regular package import `--cov=<file>` can match) — the
# containing directory works because pytest-cov then discovers every `.py`
# file under it directly from the filesystem rather than via import-name
# matching. One consequence worth knowing: a new file added to PY_SOURCES in
# a DIFFERENT directory that isn't already covered here needs adding to this
# list too, same as it already needs manually adding to PY_SOURCES itself for
# lint-py/typecheck (neither of those uses `find`, unlike SH_FIND above) —
# this is not a new gap `coverage-py` introduces, just one it inherits.
PY_COVERAGE_DIRS := $(sort $(dir $(filter-out scripts/tests/%,$(PY_SOURCES))))

VENV := .venv
VENV_BIN := $(VENV)/bin
# A real file, not a phony re-run-every-time target: make only rebuilds the
# venv when requirements-dev.txt changes (or .venv doesn't exist yet), so
# `make lint-py` stays fast on repeat local runs instead of reinstalling on
# every invocation.
VENV_STAMP := $(VENV)/.installed
PY := $(VENV_BIN)/python

# Coverage settings. The floor is a MEASURED baseline, not an aspiration: 70%
# is the first honest measurement (70.24%) rounded DOWN — kcov line coverage
# jitters by fractions of a point as scripts and tests change shape, so the
# floor sits just under the measurement rather than exactly on it. Measured by
# running this very target on ubuntu-24.04 with kcov 42 and bats at the commit
# shell.yml pins. Lowering this line takes a deliberate commit; raising it as
# coverage improves is welcome.
COVERAGE_DIR := coverage
COVERAGE_MIN := 70

# What lands in the denominator, and what doesn't:
#
#   * --include-path keeps the measurement to THIS repo's scripts. Without it
#     kcov also instruments bats itself (its lib/ and libexec/ bash) and the
#     preprocessed .bats.src copies of the test files, and the percentage then
#     measures bats-core far more than it measures anything here — it would
#     move on a bats upgrade and barely move when a script gains a test.
#   * --exclude-pattern drops scripts/tests: helpers.bash is test scaffolding,
#     and scaffolding that grades itself inflates the number.
#   * kcov's bash coverage is trace-based, so a script only enters the
#     denominator once something EXECUTES it. Two consequences worth knowing
#     before reading the number as gospel: a script no test ever runs (today,
#     the gh-attach-image skill's upload.sh) is invisible rather than a 0, so
#     this gate does not by itself catch an untested new script; and setup.sh
#     is exercised only through a throwaway copy its suite makes under TMPDIR
#     (see scripts/tests/setup.bats), which kcov attributes to that temp path
#     rather than to setup.sh here. Both are gaps in what the floor guards,
#     not claims that the code is untested.
KCOV_INCLUDE := $(CURDIR)/scripts,$(CURDIR)/plugins,$(CURDIR)/setup.sh
KCOV_EXCLUDE := /scripts/tests

# Python's own coverage floor, the sibling this file's COVERAGE_MIN comment
# above asks for rather than a second, inconsistent mechanism (dfadler/
# agent-config#208). Same discipline as COVERAGE_MIN: 33 is the first honest
# measurement (33.958...%) rounded DOWN, not an aspirational number. Measured
# by running `make coverage-py` locally (macOS, Python 3.12.2) with
# pytest==9.0.3, pytest-cov==7.1.0 pinned in requirements-dev.txt — the
# measurement is platform-independent (coverage.py, unlike kcov, instruments
# Python everywhere; nothing in agent_term.py or its tests branches on OS),
# so the same run on ubuntu-latest in CI should reproduce it. It is much
# lower than the bash floor because agent_term.py's CLI/daemon dispatch
# (cmd_start, serve, bind_control_socket, the socket request/response loop)
# is exercised only by real usage, not by scripts/tests/test_agent_term.py's
# suite of pure-function/unit tests — a real gap, not a measurement error.
# Lowering this line takes a deliberate commit; raising it as coverage
# improves is welcome.
COVERAGE_PY_DIR := coverage-py
COVERAGE_PY_MIN := 33

# What lands in the denominator, and what doesn't — the Python-side mirror of
# the KCOV_INCLUDE/KCOV_EXCLUDE comment above:
#
#   * --cov is pointed at PY_COVERAGE_DIRS (derived above), never at
#     scripts/tests — grading the test scaffolding against itself would
#     inflate the number the same way including it in kcov's denominator
#     would.
#   * UNLIKE kcov's trace-based bash coverage, coverage.py's directory mode
#     DOES count a file it never executed at all: a new, wholly-untested
#     `.py` file dropped into a directory PY_COVERAGE_DIRS already points at
#     shows up as an explicit 0%-covered entry (verified empirically: a
#     never-imported dummy file in agent_term.py's directory appeared in the
#     report at 0%, not silently omitted from the denominator). That is the
#     exact failure mode #208 exists to close for Python. It is NOT closed
#     for a new Python file in a directory PY_COVERAGE_DIRS doesn't already
#     list — that file has to be added to PY_SOURCES (and therefore to this
#     derived list) first, the same manual-onboarding step lint-py and
#     typecheck already require and `coverage-py` inherits rather than fixes.
#   * diff/patch coverage (a tool like diff-cover restricting the check to a
#     PR's newly-changed lines, independent of the repo's aggregate number)
#     was investigated for this target and deliberately left as follow-up —
#     see the PR that introduced this comment for why.
COVERAGE_PY_JSON := $(COVERAGE_PY_DIR)/py-coverage.json

# Ceiling for claude/CLAUDE.md (see scripts/check-claude-md-lines.sh). The
# global CLAUDE.md loads into every session on this machine regardless of
# project, so unrelated content belongs in a skill/doc instead of growing this
# file — #137 trimmed it from 352 to 302 lines by relocating the TypeScript
# sections into the typescript-conventions skill. 330 was that post-trim
# measurement plus headroom for organic growth, not the exact count. #139
# converged genuinely global git-workflow research (#83-85, tracked since
# #81) back into this file, raising it to 385 lines; 400 was that measurement
# plus the same style of headroom. A worktree-cleanup bullet (kill
# background processes before removing a worktree) landed separately and
# pushed it to 412; 425 is that measurement plus the same headroom again,
# not a new baseline to fill up to. #168's sourced-only exemption rewrite
# pushed it to 430; 440 is that measurement plus the same style of headroom.
# #174's concurrency guideline pushed it to 451, #175's no-autonomous-merge
# guardrail for security-critical/regulated paths pushed it further to 476,
# and #181's web-research injection-hardening section pushed it further to
# 505; 520 was that measurement plus the same style of headroom. #191's
# audit moved duplicated mechanics out to the skills that already owned them
# (visual-verification capture steps to pr-visual-capture, the CI-checks
# escalation order to pr-checks, and PR-review-comment classification to
# pr-comments — CLAUDE.md keeps only the policy/pointer), pulling it back
# down to 460, and the repo-wide git-stash-hazard bullet pushed it back up
# to 477; 490 was that measurement plus the same style of headroom. #203's
# follow-up to #191 moved the remaining worktree/git mechanics (worktree
# creation and locking conventions, the stash-collision hazard, conflict-
# resolution escalation levels, PR-splitting sequencing, branch naming) into
# a new `git-worktree-usage` skill, leaving only the policy/pointer behind
# and pulling this file down to 336 lines; 350 is that measurement plus the
# same style of headroom, not a new baseline to fill up to. Raising it
# further takes a deliberate commit, the same as COVERAGE_MIN above.
CLAUDE_MD_MAX_LINES := 350

.PHONY: help check lint lint-sh lint-py lint-actions fmt fmt-py test test-sh test-py \
        structure typecheck venv coverage coverage-py check-links

help: ## Show available targets
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk -F':.*?## ' '{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# `check` must be the UNION of what every workflow runs, because that is the
# promise the README makes. The split, so a new target lands in both places:
#
#   shell.yml      lint-sh, structure, test-sh, coverage
#   python.yml     lint-py, typecheck, test-py, coverage-py
#   actionlint.yml lint-actions
#
# Each workflow calls its own subset rather than `make check` — shell.yml has
# no Python installed, and pointing it at an aggregate target that had grown a
# pytest dependency is exactly how this broke once already.
check: lint structure typecheck test lint-actions coverage coverage-py ## Everything CI runs

venv: $(VENV_STAMP) ## Create/refresh .venv from requirements-dev.txt

$(VENV_STAMP): requirements-dev.txt
	@python3 -m venv $(VENV)
	@$(VENV_BIN)/pip install -q --upgrade pip
	@$(VENV_BIN)/pip install -q -r requirements-dev.txt
	@touch $(VENV_STAMP)
	@echo "✓ $(VENV) ready"

lint: lint-sh lint-py ## Lint shell and Python

lint-sh: ## shellcheck + shfmt (check only) + set-flags convention + CLAUDE.md size
	@$(SH_FIND) | xargs -0 shellcheck
	@$(SH_FIND) | xargs -0 shfmt -i 2 -ci -d
	@bash scripts/check-shell-set-flags.sh
	@bash scripts/check-claude-md-lines.sh claude/CLAUDE.md $(CLAUDE_MD_MAX_LINES)

lint-py: venv ## ruff check + ruff format --check
	@$(PY) -m ruff check $(PY_SOURCES)
	@$(PY) -m ruff format --check $(PY_SOURCES)

typecheck: venv ## mypy --strict over the Python sources
	@$(PY) -m mypy --strict --ignore-missing-imports $(PY_SOURCES)

fmt: fmt-py ## Rewrite sources to the repo's style
	@$(SH_FIND) | xargs -0 shfmt -i 2 -ci -w

fmt-py: venv ## Rewrite Python to ruff's style
	@$(PY) -m ruff check --fix $(PY_SOURCES)
	@$(PY) -m ruff format $(PY_SOURCES)

structure: ## Validate plugin manifests and skill/agent frontmatter
	@bash scripts/check-plugin-structure.sh

test: test-sh test-py ## Run every suite

test-sh: ## Run the bats suites
	@bats scripts/tests

test-py: venv ## Run the pytest suite
	@$(PY) -m pytest scripts/tests -q

# Re-runs the bats suite under kcov and enforces COVERAGE_MIN above. CI calls
# this exact target, so the local and CI numbers come from the same command.
#
# LINUX ONLY, deliberately and loudly: kcov instruments bash by injecting a
# helper library into the traced shell, and macOS System Integrity Protection
# strips DYLD_INSERT_LIBRARIES from /bin/bash. Every script this suite runs is
# therefore invisible to kcov on a Mac and the measurement comes back 0.00% —
# a number that would fail the gate for a reason having nothing to do with the
# tests. Rather than let that make `make check` unrunnable on the machine most
# of this repo is written on, the target says so and skips. It never skips
# under CI: the CI environment variable is set on every GitHub runner, so a
# Linux-only gate can't be silently lost by a future runner change.
coverage: ## Measure bats coverage with kcov and enforce the floor (Linux only)
	@set -euo pipefail; \
	if [ "$$(uname -s)" != Linux ] && [ -z "$${CI:-}" ]; then \
	  echo "coverage: skipped — kcov cannot instrument bash on $$(uname -s) (macOS SIP strips DYLD_INSERT_LIBRARIES from /bin/bash);"; \
	  echo "          the gate runs on Linux in CI."; \
	  exit 0; \
	fi; \
	rm -rf $(COVERAGE_DIR); \
	kcov --include-path=$(KCOV_INCLUDE) --exclude-pattern=$(KCOV_EXCLUDE) \
	  $(COVERAGE_DIR) bats scripts/tests; \
	bash scripts/check-shell-coverage.sh \
	  "$$(find $(COVERAGE_DIR) -maxdepth 2 -name coverage.json -print -quit)" $(COVERAGE_MIN)

# Re-runs the pytest suite under pytest-cov and enforces COVERAGE_PY_MIN
# above. CI calls this exact target, so the local and CI numbers come from
# the same command — same contract as `coverage`, but with no platform skip:
# coverage.py has no macOS equivalent of kcov's SIP restriction, so this
# measures identically everywhere pytest itself runs.
coverage-py: venv ## Measure pytest coverage and enforce the floor
	@rm -rf $(COVERAGE_PY_DIR)
	@mkdir -p $(COVERAGE_PY_DIR)
	@$(PY) -m pytest scripts/tests -q \
	  $(addprefix --cov=,$(PY_COVERAGE_DIRS)) \
	  --cov-report=term-missing \
	  --cov-report=json:$(COVERAGE_PY_JSON)
	@bash scripts/check-python-coverage.sh $(COVERAGE_PY_JSON) $(COVERAGE_PY_MIN)

lint-actions: ## Lint .github/workflows with actionlint
	@actionlint

# Standalone on purpose, not part of `check` yet: verified low-noise against
# this repo's real tree when added (#96), but it hasn't been proven against
# CI's own checkout, and a broken-link false positive there would go straight
# to a red default branch. Fold it into `check`/`lint` once that's confirmed.
check-links: ## Verify relative markdown links resolve to real files
	@bash scripts/check-markdown-links.sh --path .
