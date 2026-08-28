# Entry points for this repo's checks. CI calls these exact targets, so a green
# `make check` locally means the same thing a green PR does — the two can't
# drift the way a hand-copied CI command list does.
#
# Requires: shellcheck, shfmt, bats, actionlint — `check` depends on all four.
#   brew install shellcheck shfmt bats-core actionlint
#
# `coverage` additionally needs kcov and jq, and only MEASURES anything on
# Linux — see the comment above that target.
#
# The Python side (the detached-terminal skill) needs a virtualenv:
#   make venv        # creates .venv from requirements-dev.txt
# `check` uses it if it exists and falls back to whatever python3 is on PATH,
# so a shell-only contributor doesn't have to build one to run the shell checks.

SHELL := /usr/bin/env bash

# Every shell script in the repo, NUL-safe. Kept as a `find` rather than a
# hand-maintained list so a new script is covered the moment it lands.
SH_FIND := find scripts plugins setup.sh -type f -name '*.sh' -print0

# Python sources: the skill's implementation plus its tests.
PY_SOURCES := plugins/dfadler-agent-config/skills/detached-terminal/scripts/agent_term.py \
              scripts/tests/test_agent_term.py

VENV := .venv
VENV_BIN := $(VENV)/bin
PY := $(shell test -x $(VENV_BIN)/python && echo $(VENV_BIN)/python || echo python3)

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

.PHONY: help check lint lint-sh lint-py lint-actions fmt fmt-py test test-sh test-py \
        structure typecheck venv coverage

help: ## Show available targets
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk -F':.*?## ' '{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# `check` must be the UNION of what every workflow runs, because that is the
# promise the README makes. The split, so a new target lands in both places:
#
#   shell.yml      lint-sh, structure, test-sh, coverage
#   python.yml     lint-py, typecheck, test-py
#   actionlint.yml lint-actions
#
# Each workflow calls its own subset rather than `make check` — shell.yml has
# no Python installed, and pointing it at an aggregate target that had grown a
# pytest dependency is exactly how this broke once already.
check: lint structure typecheck test lint-actions coverage ## Everything CI runs

venv: ## Create .venv from requirements-dev.txt
	@python3 -m venv $(VENV)
	@$(VENV_BIN)/pip install -q --upgrade pip
	@$(VENV_BIN)/pip install -q -r requirements-dev.txt
	@echo "✓ $(VENV) ready"

lint: lint-sh lint-py ## Lint shell and Python

lint-sh: ## shellcheck + shfmt (check only) + set-flags convention
	@$(SH_FIND) | xargs -0 shellcheck
	@$(SH_FIND) | xargs -0 shfmt -i 2 -ci -d
	@bash scripts/check-shell-set-flags.sh

lint-py: ## ruff check + ruff format --check
	@$(PY) -m ruff check $(PY_SOURCES)
	@$(PY) -m ruff format --check $(PY_SOURCES)

typecheck: ## mypy --strict over the Python sources
	@$(PY) -m mypy --strict --ignore-missing-imports $(PY_SOURCES)

fmt: fmt-py ## Rewrite sources to the repo's style
	@$(SH_FIND) | xargs -0 shfmt -i 2 -ci -w

fmt-py: ## Rewrite Python to ruff's style
	@$(PY) -m ruff check --fix $(PY_SOURCES)
	@$(PY) -m ruff format $(PY_SOURCES)

structure: ## Validate plugin manifests and skill/agent frontmatter
	@bash scripts/check-plugin-structure.sh

test: test-sh test-py ## Run every suite

test-sh: ## Run the bats suites
	@bats scripts/tests

test-py: ## Run the pytest suite
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

lint-actions: ## Lint .github/workflows with actionlint
	@actionlint
