# vitest plugin for Claude Code

Skills and an agent for Vitest-based projects. Flag names are checked against the
[Vitest CLI docs](https://vitest.dev/guide/cli.html) (Vitest 5).

| Piece | Use |
|-------|-----|
| `vitest:test-conventions` | Writing or editing a `*.test.ts` file or `vitest.config.ts` |
| `vitest:flaky-tests` | A test passes locally but fails in CI, or intermittently; procedure for reproducing it |
| `flaky-test-investigator` agent | Runs the flaky-tests procedure in isolation and reports a cause and fix; never edits files. Preloads `flaky-tests` via `skills:`. Not covered by an eval |

`flaky-tests` is the single owner of the reproduction ladder and the pnpm/npm flag
forwarding rule; the agent and this repo's docs point to it rather than restating it.

For Vite plugin tests specifically (calling `transform`/`generateBundle` hooks
directly), use `vite:test`; this plugin covers general Vitest practice.

Plugins cannot ship path-scoped rules, so a project that wants the skills suggested
automatically for test files can copy this repo's `.claude/rules/vitest.md` into its
own `.claude/rules/`. The rule is manager-neutral and only points at the two skills,
so it is safe to copy verbatim.
