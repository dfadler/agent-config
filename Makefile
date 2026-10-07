# Thin delegate to scripts/ci.sh, which owns every check (CI calls it directly).
# `make <target>` is the same as `bash scripts/ci.sh <target>`; the Makefile goes
# away in the last phase of #490.

TARGETS := check lint lint-sh lint-shellcheck lint-shfmt lint-set-flags lint-claude-md \
           lint-py lint-ts lint-actions fmt fmt-py test test-sh test-py test-ts \
           structure typecheck typecheck-ts venv node-modules coverage coverage-py \
           coverage-ts check-links check-skills lint-plugin-evals check-vitest-flags \
           check-vitest-v3-names

.PHONY: help $(TARGETS)

help: ## Show available targets
	@bash scripts/ci.sh --help

$(TARGETS):
	@bash scripts/ci.sh $@
