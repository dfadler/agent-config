# Choosing and writing graders

Source for every fact below: the
[plugin-evals docs](https://code.claude.com/docs/en/plugin-evals) ("Choose and weight
graders", "Grader frontmatter", "Grader types"). The parser's schema table
(`scripts/ts/parser/schema.ts`) holds the key names and limits the lint reads.

## Free first

`regex`, `tool_used`, `tool_order` and `file_exists` are computed from the transcript and
files: no model call, same answer every time. `llm` and `baseline` call a judge (three
short calls per grader per run) and add variance. There are no custom-code graders.

1. **Name what must be true**, then map it to something observable:

   | Property | Grader |
   |---|---|
   | A step was or was not taken, or taken in order | `tool_used`, `tool_order` |
   | A file was created, or what is in it | `file_exists`; `regex` on `{ source: file, path }` |
   | Exact text in the reply | `regex` on `last_message` |
   | What a mocked tool was called with | `regex` or `tool_used` on `mock_calls` |
   | The plugin's skill fired | `tool_used` with `tool: Skill` |

2. **Try the free grader.** The test for `llm`: can you write a free check that passes
   every correct reply and fails every wrong one you can think of? If not, the property
   is semantic (tone, relevance, whether a refusal is appropriate) and `llm` is justified.
3. **Keep paid graders narrow:** short output only, at most one per case unless the
   dimensions are independent, and paired with free graders.
4. **Say why** with a one-line comment beside any paid grader. Comments are not parsed;
   the [case-reviewer](../../../agents/case-reviewer.md) checks this.
5. **Tag a case `quick`** when all its graders are free, so the wrapper's quick tier can
   run it at no judge cost. EVAL017 keeps the tag honest.

For long output such as a generated file, use a `regex` over the file, not an `llm`.
Give each case one grader on the result and one on the steps (docs, "Choose graders that
give a stable signal").

## Types and options

| Type | Options | Notes |
|---|---|---|
| `regex` | `pattern`, `flags`, `match`, `target` | JavaScript regex. `flags: i` for case-insensitive, never inline `(?i)`. `match: not_contains` for absence, `match: "count:N"` for exactly N |
| `tool_used` | `tool`, `input_match`, `min`, `max` | `min` defaults to 1. "Never called" needs `min: 0` and `max: 0`. `input_match` is a regex over the JSON-encoded input |
| `tool_order` | `before`, `after` | Each a tool name or `{ tool, input_match }`; compares first matching calls |
| `file_exists` | `path`, `exists` | `path` is a glob. Counts only files created during the run, not scaffolded or merely edited ones |
| `llm` | `criteria`, `focus` | Passes on 2 of 3 judge votes. In the `.md` layout the body is the criteria |
| `baseline` | `baseline_file`, `criteria` | Judge compares the run to a reference `.jsonl` transcript in the case directory |

Common keys: `type` (required), `weight` (default 1, any positive number), `arm`.

## What a grader sees (`target` for `regex`, `focus` for `llm`)

- `last_message` (default): the final reply text.
- `trace`: the session as JSON, one message per line. A `regex` sees all of it; an `llm`
  judge sees only the first 12 and last 12 messages. Quotes are JSON-escaped (`\"`).
- `files`: the **paths** Claude created, not their contents.
- `{ source: file, path: <path> }`: the contents of one workspace file after the run.
  Images are shown to an `llm` judge; other binaries (pptx, PDF) are refused.
- `mock_calls`: each call to a mocked MCP tool, with its input and the mock's answer.

## Two-arm scoring

A case runs with and without the plugin; Δ is the difference. In a two-arm run these
graders are excluded from the score and reported as indicators (`scored: false`):
`tool_used: Skill`, `regex`/`llm` on `mock_calls` when the mocked server is one the plugin
declares, and anything marked `arm: with-only`. Set `arm: both` to score one in both arms,
for example "must not invoke the skill" (`min: 0`, `max: 0`). If every grader would be
excluded they score normally, and `--ablation none` excludes nothing. A Δ near zero with
the Skill grader failing means the skill's `description` is not triggering on that phrasing.

## Judge and limits

- Default judge is the background-task model; `--judge-model sonnet` helps hard rubrics.
  If a `tool_used: Skill` grader passes but Δ is negative, suspect the judge and tighten
  the rubric.
- `runs` 1 to 50 (default 3), `max_turns` default 10 up to 200, `timeout_seconds` default
  300 up to 3600. Hitting the turn cap is a run error, so set it generously.
- `@path` in a prompt is not expanded; grant a read tool instead.
- `env` keys must match `EVAL_[A-Z0-9_]*`.
- To check that a build or test passed in the run: have the prompt write the outcome to a
  file, grade the file, and add a `tool_used` grader whose `input_match` names the command.
