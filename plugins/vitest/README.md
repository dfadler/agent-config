# vitest plugin for Claude Code

Skills and an agent for Vitest-based projects. Flag names are checked against the
[Vitest CLI docs](https://vitest.dev/guide/cli.html) (Vitest 5).

| Piece | Use |
|-------|-----|
| `vitest:test-conventions` | Writing or editing a `*.test.ts` file or `vitest.config.ts` |
| `vitest:flaky-tests` | A test passes locally but fails in CI, or intermittently; procedure for reproducing it |
| `flaky-test-investigator` agent | Runs the flaky-tests procedure in isolation and reports a cause and fix; never edits files |

For Vite plugin tests specifically (calling `transform`/`generateBundle` hooks
directly), use `vite:test`; this plugin covers general Vitest practice.

Plugins cannot ship path-scoped rules, so a project that wants the conventions
loaded automatically for test files should copy the rule from this repo's
`.claude/rules/vitest.md` into its own `.claude/rules/`.
