# Adding a lint rule

The lint (`scripts/ts/lint/`) is the single source of the grader-stability rules. A rule
is **one file** plus its fixtures. Nothing else changes: rules register by
auto-discovery, and the fixture harness picks fixtures up by directory name.
Tracking: [#449](https://github.com/dfadler/agent-config/issues/449).

Run it (no model calls, no network):

```bash
node plugins/eval-authoring/scripts/ts/lint/cli.ts [PLUGIN_ROOT]   # --help for flags, output and exit codes
node plugins/eval-authoring/scripts/ts/lint/cli.ts --list-rules
```

## The three steps

1. **Rule file**: `scripts/ts/lint/rules/evalNNN-short-slug.ts`, exporting `rule`.
   The file name prefix must equal the ID (`eval004-...` is `EVAL004`); startup fails
   with a clear message if not, if two files share an ID, or if a file in `rules/` is
   not a rule. Put helpers outside `rules/` (next to `helpers.ts`).
2. **Fixtures**: `tests/lint-fixtures/EVALNNN/good-<slug>/` and `bad-<slug>/`.
3. **Sabotage check**: break the rule once, confirm its fixture test fails, revert.

Do not edit `types.ts`, `runner.ts`, `discover.ts`, `fixtures.test.ts` or the parser. A
missing parser field goes to the coordinator.

## The `Rule` interface

```ts
interface Rule {
  id: string;        // "EVAL004"
  severity: "error" | "warn" | "info";   // default; a Problem may override
  title: string;     // one line, shown by --list-rules
  source: string;    // docs basis, or "from #411" (use fromDocs() from ../sources.ts)
  checkCase?: (evalCase: EvalCase, ctx: LintContext) => readonly Problem[];
  checkSuite?: (ctx: LintContext) => readonly Problem[];   // repo or suite level
}
interface Problem { message; fix; loc: SourceLoc; severity?; source? }
interface LintContext { pluginRoot; schema; suite; grants; manifest }
```

- Return `[]` when the case is fine. The runner adds the rule ID, severity and source,
  and prints `file:line:col: severity RULE: message`, then `Fix:` and `Source:`.
  **Messages teach**: `message` names the offending value, `fix` says what to change.
- Read key names and limits from `ctx.schema` (the parser's schema table), never your
  own constants. Take `loc` from the parser (`Field.loc`, `grader.origin.loc`,
  `CaseKey.loc`) so the message points at the line.
- `ctx.grants` is already checked against the case names. `ctx.suite.mocks` is the
  suite catalog; call `readMocks(pluginRoot, evalDir, caseDir)` for a case's own.
- Do not re-report parser problems: the runner already prints every `ParseIssue` as
  rule `PARSE` (error).
- Rules are pure functions of their input. A rule that throws fails the run with
  `rule EVALnnn threw: ...` (exit 20), so do not throw for bad input.

## Worked example

A rule that warns when a case asks for more than 20 turns (illustrative, not a real
rule):

```ts
// scripts/ts/lint/rules/eval900-many-turns.ts
import { fromDocs } from "../sources.ts";
import type { Rule } from "../types.ts";

export const rule: Rule = {
  id: "EVAL900",
  severity: "warn",
  title: "Case allows more than 20 turns",
  source: fromDocs("max_turns bounds the cost of a run"),
  checkCase: (c) =>
    c.maxTurns.value <= 20
      ? []
      : [
          {
            message: `Case '${c.name.value}' allows ${String(c.maxTurns.value)} turns.`,
            fix: "Lower max_turns to 20 or less, or explain the need in expected_outcome.",
            loc: c.maxTurns.loc,
          },
        ],
};
```

Fixtures. Each fixture directory is a miniature plugin root; its cases live in `evals/`:

```
tests/lint-fixtures/EVAL900/
  bad-prompt-md/evals/many/prompt.md              # "---\nmax_turns: 50\n---\nDo it.\n" + a grader
  bad-prompt-md/evals/many/graders/done.md        # "---\ntype: regex\npattern: done\n---\n"
  bad-case-yaml/evals/many/case.yaml              # same, in case.yaml layout
  good-prompt-md/evals/few/...                    # max_turns: 5
  good-case-yaml/evals/few/...
  bad-case-yaml/fixture.json                      # optional: { "fires": ["many"] }
```

- `bad-*`: the rule must fire at least once. With `fixture.json`, it must fire on
  exactly the listed case directory names, so one fixture can hold several bad cases.
- `good-*`: the rule must not fire. Only your own rule is asserted, so another rule
  firing on your fixture is fine.
- Cover both layouts (`prompt.md` with `graders/*.md`, and `case.yaml`) wherever the
  rule applies to both. A grants file goes at `evals/grants.yaml`; a manifest at
  `.claude-plugin/plugin.json`.
- Fixtures must parse: any `PARSE` finding fails the fixture.
- The harness also fails if a rule has no `good-*` or no `bad-*` fixture, or if a
  fixture directory is not a rule ID.

Run the harness: `node node_modules/vitest/vitest.mjs run plugins/eval-authoring`
(`make test-ts` runs it too, and so does `make check`).

## Sabotage check

For each new rule: temporarily break its logic (flip the condition, return `[]`),
re-run the harness, confirm the bad fixture fails, then revert. A manual step, not a
change to ship.
