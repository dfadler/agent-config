# Entry points for this repo's checks. CI calls these exact targets, so a green
# `make check` locally means the same thing a green PR does — the two can't
# drift the way a hand-copied CI command list does.
#
# Requires: shellcheck, shfmt, bats, actionlint — all four, since `check`
# depends on every one of them. On macOS:
#   brew install shellcheck shfmt bats-core actionlint

SHELL := /usr/bin/env bash

# Every shell script in the repo, NUL-safe. Kept as a `find` rather than a
# hand-maintained list so a new script is covered the moment it lands.
SH_FIND := find scripts plugins setup.sh -type f -name '*.sh' -print0

.PHONY: help check lint lint-sh lint-actions fmt test structure

help: ## Show available targets
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk -F':.*?## ' '{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# lint-actions is included deliberately: CI runs it in actionlint.yml, so
# leaving it out would let a workflow change pass `make check` and fail in CI —
# exactly the local/CI drift this Makefile exists to prevent.
check: lint structure test lint-actions ## Everything CI runs

lint: lint-sh ## Alias for lint-sh

lint-sh: ## shellcheck + shfmt (check only) + set-flags convention
	@$(SH_FIND) | xargs -0 shellcheck
	@$(SH_FIND) | xargs -0 shfmt -i 2 -ci -d
	@bash scripts/check-shell-set-flags.sh

fmt: ## Rewrite shell scripts to the repo's shfmt style
	@$(SH_FIND) | xargs -0 shfmt -i 2 -ci -w

structure: ## Validate plugin manifests and skill/agent frontmatter
	@bash scripts/check-plugin-structure.sh

test: ## Run the bats suites
	@bats scripts/tests

lint-actions: ## Lint .github/workflows with actionlint
	@actionlint
