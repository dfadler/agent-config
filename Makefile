# Entry points for this repo's checks. CI calls these exact targets, so a green
# `make check` locally means the same thing a green PR does — the two can't
# drift the way a hand-copied CI command list does.
#
# Requires: shellcheck, shfmt, bats, actionlint — `check` depends on all four.
#   brew install shellcheck shfmt bats-core actionlint
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

.PHONY: help check lint lint-sh lint-py lint-actions fmt fmt-py test test-sh test-py \
        structure typecheck venv

help: ## Show available targets
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk -F':.*?## ' '{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# lint-actions is included deliberately: CI runs it in actionlint.yml, so
# leaving it out would let a workflow change pass `make check` and fail in CI —
# exactly the local/CI drift this Makefile exists to prevent.
check: lint structure typecheck test lint-actions ## Everything CI runs

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

lint-actions: ## Lint .github/workflows with actionlint
	@actionlint
