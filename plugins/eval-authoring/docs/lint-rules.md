# Adding a lint rule

The lint (`scripts/ts/lint/`) is the single source of the grader-stability rules. A rule
is **one file** plus its fixtures. Nothing else changes: rules register by
auto-discovery, and the fixture harness picks fixtures up by directory name.
Tracking: [#449](https://github.com/dfadler/agent-config/issues/449).

Run it (no model calls, no network):

```bash
node plugins/eval-authoring/scripts/ts/lint/cli.ts [PLUGIN_ROOT]   # --help for flags, output and exit codes
node plugins/eval-authoring/scripts/ts/lint/cli.ts --list-rules
node plugins/eval-authoring/scripts/ts/lint/cli.ts --enable EVAL009 [PLUGIN_ROOT]   # also run an opt-in rule
```

A rule that sets `optIn: true` is skipped unless `--enable ID` names it (comma-separated or
repeated). `--list-rules` still lists it and marks it. The fixture harness runs opt-in rules
with them on, so an opt-in rule still needs its good and bad fixtures.

## Rules

What each rule protects and the usual fix. `--list-rules` prints the one-line titles and is
the authority; the severity is the default.

| ID | Sev | Why it matters | Fix |
|---|---|---|---|
| EVAL002 | error | The CLI ignores or rejects keys it does not know, so a typo silently drops a check. | Use only documented keys, put run fields (`max_turns`, `allowed_tools`...) under `execution:`, and start `case.yaml` with `schema_version` and `name`. |
| EVAL003 | error | A value outside the schema (bad `runs`, `weight`, `arm`, grader `type`, an `env` key not starting `EVAL_`) fails to load or changes scoring. | Set the field to a value the message's range allows. |
| EVAL004 | error | A case cannot grant itself `Bash`, `Write`, `Edit`, `WebFetch` or `WebSearch`; without a recorded grant the tool is denied and the case cannot pass. | Add the exact entry to `grants.yaml`, or drop the tool from `allowed_tools`. |
| EVAL005 | error | A `max: 0` `tool_used` grader on a tool the case never gets can never fail. (The CLI's preflight warns, without aborting, when a `min >= 1` one, explicit or the default, has no grant; probed on 2.1.300, see the audit below.) | Grant the tool, or grade something observable. |
| EVAL006 | warn | A judge given no explicit pass and fail conditions guesses, and split votes make the score noise. | Write `PASS if ...` and `FAIL if ...` with observable conditions. |
| EVAL007 | error | `tool_used: Skill` needs `Skill` in `allowed_tools`, or the check can never see a call; a `max: 0` Skill check on one arm only tests the arm that cannot fire it. | Add `Skill`; give a "must not fire" check `arm: both`. |
| EVAL008 | warn | If every grader is excluded from scoring, both arms score alike and there is no delta. | Add a grader that counts (see EVAL010). |
| EVAL009 | info, opt-in | A result check alone can pass with the wrong steps and a steps check alone with the wrong answer. Off by default (#811): it fired on about half of all cases, mostly reply-only skills with no step to check. Run it with `--enable EVAL009`. | Pair them, or skip it for a reply-only skill. |
| EVAL010 | info | `mock_calls` on a mock the plugin declares is an indicator only (the no-plugin arm has no mock). | Add `arm: both`, or use a grader that counts. |
| EVAL011 | warn | A judge reading the reply cannot see what was passed to a tool. | Use `focus: mock_calls` when the criteria are about tool inputs. |
| EVAL012 | error | Inline regex flags, a pattern matched against a file path instead of its content, or an unescaped quote inside a traced value make a regex match nothing, or everything. | Use the `flags` key, `target: { source: file, path }`, and `\\"` for a quote in a trace. |
| EVAL013 | warn | A mock for a server the plugin does not declare is never used; an invalid `expect`, `type` or a `type: agent` mock with no `.replay` recordings fails at run time. | Rename the mock directory to the server, fix the field, or commit the recordings. |
| EVAL014 | warn (info for git history and a bare `.git` in `add_dirs`) | A `scaffold_script` that is missing fails the run; an answer in the scaffold's git history or an `add_dirs` directory leaks to the model. | Create the script or correct the path; remove the answer from history and `add_dirs`. |
| EVAL015 | warn | Result directories that git does not ignore get committed by accident. | Add the results directory to `.gitignore`. |
| EVAL016 | warn | A case graded only by a judge is the most expensive and noisiest kind. | Add a free grader (`regex`, `tool_used`, `file_exists`). |
| EVAL017 | error | `quick` runs must be free; an `llm` or `baseline` grader is a paid call. | Remove the `quick` tag or the paid grader. |
| EVAL018 | error | A declared dependency with no matching `plugins:` entry silently drops the plugin under test; a `plugins:` entry outside the plugin root stops the case from loading. | Vendor each dependency inside the plugin, list it under `plugins:`, and keep every entry inside the plugin root. |
| EVAL019 | error | `min` defaults to 1, so `tool_used` with `max: 0` alone can never pass. | Add `min: 0`. |
| EVAL020 | info | A suite that checks the skill fires but never that it stays quiet cannot catch an over-broad description. | Add a near-miss prompt that must not fire the skill. |
| EVAL021 | warn | A grant the case never lists in `allowed_tools` widens permissions for nothing. | Remove the grant, or add the tool to `allowed_tools`. |
| EVAL022 | warn | Installed plugins are called as `plugin:name`; an `input_match` without an optional prefix misses them. | Allow an optional `plugin:` prefix in the pattern. |
| EVAL023 | warn (info for the `last_message` problem) | A judge on `last_message` with no `regex` backstop may be steered by the reply (unproven: #743 cites a research doc that is not public), and an `llm` judge on `trace` sees only the first and last 12 messages (documented). | Add a `regex` backstop, or lower `max_turns` to 12 or less. |
| EVAL024 | warn | A `last_message` regex that already matches the case prompt passes (or trips) on a reply that echoes the prompt. | Match wording only the skill or a correct answer would add, or grade behavior with `tool_used`. |
| EVAL025 | warn | A case whose graders are all "must not fire" Skill checks (the no-plugin arm passes them by construction) or regexes whose literal text is in the prompt has only the with-arm fire rate to fail on. | Grade a trace action in a fixture workspace, or tag the case `smoke` to label it a cheap trigger guard, or drop it. |

The Sev column is the rule's default; "opt-in" means the rule runs only with `--enable`. EVAL007, EVAL012, EVAL014 and EVAL023 override it for some problems (a finding's own severity wins); run `--list-rules` or read the finding for the one you got.

## Audit (#811)

Hits from running the lint over every plugin with evals (30 plugins, 269 cases), 2026-10-28. Details and rule origins: [#811](https://github.com/dfadler/agent-config/issues/811). CLI overlap for 001, 003 and 005 was checked with free `--max-cost-usd 0` probes on CLI 2.1.300, 2026-10-29; the rest was not.

- 009: 143 info. Made opt-in (`--enable EVAL009`); the rule and its fixtures stay. It fired on over half of cases, mostly reply-only skills, and its fix now says a reply-only skill keeps the Skill check and leaves the rule off.
- 024: 56 warn. Keep: real prompt-echo findings; the fixes are case edits.
- 023: 12 info. Keep; the `last_message` half is unproven.
- 025: 6 warn. Keep.
- 022: 0. Keep; the false positive was fixed in #812.
- 014: 0. The `fixtures/bin` check was removed (a probe in #450 refuted it); the rest stays.
- 001: deleted. Probed: `case.yaml` with no `graders:` key or `graders: []`, and `prompt.md` with no `graders/` directory or an empty one, all fail to load (`graders: Required` / `Array must contain at least 1 element(s)`, exit 1, no run).
- 005: narrowed to `max: 0`. Probed: the preflight warning "cannot pass with the granted tools" fires for `tool_used` with the default `min`, `min: 1` and `min: 2`, in both layouts, with Bash absent from `allowed_tools`, present in it, or `allowed_tools` omitted; `--allow-tools Bash` silences it. The run still launches, so it is a warning, not a rejection.
- 003, 004, 008, 010, 021: 0. Open merge candidates (003 into 002, 004 with 021, 008 with 010).
- All other rules: 0. Keep.

Zero hits means the suites are clean now, not that a rule never caught anything.

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

Fixtures. Each fixture directory is a miniature plugin root; its cases live in `cases/` (not `evals/`, which `claude plugin eval` would load as real cases; pass `evalDir: "cases"` to `lintPlugin`):

```
tests/lint-fixtures/EVAL900/
  bad-prompt-md/cases/many/prompt.md              # "---\nmax_turns: 50\n---\nDo it.\n" + a grader
  bad-prompt-md/cases/many/graders/done.md        # "---\ntype: regex\npattern: done\n---\n"
  bad-case-yaml/cases/many/case.yaml              # same, in case.yaml layout
  good-prompt-md/cases/few/...                    # max_turns: 5
  good-case-yaml/cases/few/...
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
(`pnpm test` runs it too, and so does `bash scripts/ci.sh check`).

## Sabotage check

For each new rule: temporarily break its logic (flip the condition, return `[]`),
re-run the harness, confirm the bad fixture fails, then revert. A manual step, not a
change to ship.
