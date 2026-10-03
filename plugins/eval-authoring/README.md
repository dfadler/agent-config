# eval-authoring

Helps Claude author, review and diagnose `claude plugin eval` cases for this repo's
plugins. Under construction: design, decisions and the build order live in
[#449](https://github.com/dfadler/agent-config/issues/449).

Planned layout (each component lands with its own issue):

- `skills/` — `author-cases`, `run-evals`, `diagnose-scores`
- `agents/` — `case-reviewer`, `score-diagnoser`
- `hooks/` — lint on `evals/**` edits (report only)
- `scripts/` — lint, run wrapper, diagnosis, shared parser (TypeScript)
- `tests/lint-fixtures/` — good and bad cases for the lint's own tests
- `evals/` — the plugin's own model-behavior cases
- `docs/` — [grants file format](docs/grants-format.md) (per-case `--allow-tools` entries),
  [adding a lint rule](docs/lint-rules.md) (one rule file plus fixtures, auto-discovered)
