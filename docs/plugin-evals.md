# Plugin Evals: authoring guide

How to write, run, and maintain `claude plugin eval` suites for skills in this repo.
Covers grader stability, fixtures, mocks, and CI gating.

## How evals work

An eval is a directory under `evals/` inside a plugin, with a `prompt.md` and one or
more grader files. `claude plugin eval` runs your skill against each case three times,
scores the graders, and publishes a report.

Every case runs twice: once **with** the skill loaded and once **without**. **Δ is
the difference** — what the skill actually contributed. A high WITH score with Δ ≈ 0
means Claude answered just as well without it; suspect a vague skill description.

`tool_used` graders are excluded from the W/OUT arm — they can't pass without the
skill loaded, so including them would inflate Δ artificially.

---

## Getting started

```bash
claude plugin eval init          # reads your skill, proposes cases and graders
claude plugin eval . --ablation none --runs 1   # fast sanity check
claude plugin eval .             # full run: both arms, 3 runs each
```

Review any generated `llm` rubrics before accepting — they're the most likely to
be vague. Focus on Δ first when reading results.

---

## Grader stability rules

### Use explicit PASS/FAIL conditions

A grader that said "must mention `mockServiceWorker.js`" scored 0.00 on a run whose
output contained the exact required content — the judge was inconsistent because
"must mention" leaves too much room for interpretation. Binary, specific conditions
produce stable, unanimous votes.

```
# Bad — vague
Pass if the response mentions VPN connectivity.

# Good — specific
PASS if the response both:
(1) tells the user to check for `public/mockServiceWorker.js`, AND
(2) tells the user to run `npx msw init public` if the file is missing.

FAIL if either condition is omitted.
```

### One `tool_used` + one `llm` result grader per case

A case typically wants two graders:

1. **`graders/skill-fired.md`** — `type: tool_used` — verifies the skill was invoked
   at all (free, no judge cost).
2. **`graders/criteria.md`** — `type: llm` — verifies the quality of the response.

Adding more graders is fine, but `llm` graders are what cost money and introduce
variance. Keep them tight.

### Use `focus: mock_calls` to grade tool inputs, not prose

A standard `llm` grader reads Claude's response text. If you need to assert on what
Claude *passed to a tool* (e.g. the channel it sent a Slack message to), set
`focus: mock_calls` — the judge sees the full record of intercepted tool inputs and
outputs, not just the response text.

Without `focus: mock_calls`, Claude could say "I would call `slack_send_message`"
and the grader might pass on text alone.

### Suspect the judge when Δ is negative

If a skill's WITH score is *lower* than its W/OUT score, the most likely cause is a
flaky `llm` grader — not a skill regression. Check `--verbose` output for split judge
votes (e.g. 2/3 vs 3/3 across arms), and tighten the PASS/FAIL conditions or add
`--judge-model sonnet` for a stronger judge.

### `--judge-model sonnet` for nuanced rubrics

Use `--judge-model claude-sonnet-4-6` when a rubric is hard to phrase in fully binary
terms — code review quality, message tone, prioritization decisions. The default
judge is lighter and will give inconsistent votes on rubrics it can't parse cleanly.

---

## Fixtures — for CLI/Bash commands

Fixtures make CLI-dependent skills testable. Without a fixture, a skill that runs
`netstat` returns different results depending on whether the eval machine has VPN
connected. A fixture intercepts the binary and returns controlled output.

**How they work:** the eval runner prepends `evals/fixtures/bin/` to `PATH` before
each run. When the model executes a Bash command, the shell finds your fixture script
first. Pipelines still work — the fixture's stdout flows into the next command just
as the real binary's would.

**Bash must be granted.** Declare `allowed_tools: [Bash]` in the case's `prompt.md`
frontmatter. Without it the fixture file sits in place but never runs.

**Granting Bash changes behavior.** When the model can actually run commands it may
behave differently than when Bash is blocked. Always re-run all cases after enabling
Bash to catch unexpected regressions.

**Scope:** fixtures in `evals/fixtures/bin/` are shared across all cases in the
plugin. Design fixture output to be broadly correct, or use `case "$*"` branching to
return different output per invocation pattern.

### Creating a fixture

```bash
mkdir -p plugins/my-plugin/evals/fixtures/bin
```

```bash
#!/usr/bin/env bash
# Use case "$*" to return different output per invocation pattern
case "$*" in
  *"repo view"*)
    echo "hudl/hudl-frontends"
    ;;
  *"pr view"*)
    echo "chore(web): update deps https://github.com/hudl/hudl-frontends/pull/19651"
    ;;
  *)
    exit 0   # safe default: exit 0 silently for unrecognized commands
    ;;
esac
```

```bash
chmod +x plugins/my-plugin/evals/fixtures/bin/my-command
```

---

## Mocks — for MCP tool calls

Mocks stub MCP server tool calls (Slack, Jira, GitHub, etc.) without a live
connection. Place a `.md` file at `evals/mocks/<server-name>/<tool-name>.md`. The
frontmatter controls matching; the body is the JSON response returned to the model.

```
---
---
{"ok": true, "channels": [{"id": "CMOCK001", "name": "{{input.query}}"}]}
```

`{{input.query}}` and `{{input.channel_id}}` are template variables — the mock echoes
back whatever the model passed in. This is what makes `focus: mock_calls` graders
useful: the grader can assert on the exact inputs the model sent.

**Scope:** `mocks/` and `fixtures/` are siblings to the individual case directories
and apply to every case in the suite. Bash is not required for mocks.

---

## Fixtures vs. Mocks — quick reference

| | Fixtures | Mocks |
| --- | --- | --- |
| Intercepts | CLI / shell commands (`Bash` tool) | MCP server tool calls |
| Mechanism | `evals/fixtures/bin/` prepended to `PATH` | Response stubs in `evals/mocks/<server>/<tool>.md` |
| Requires Bash? | **Yes — must grant Bash** | **No — default sandbox** |
| Scope | Shared across all cases in the plugin | Per-server, per-tool |
| Use for | `netstat`, `gh`, `curl`, `git`, any binary | Slack, Jira, GitHub, any MCP server |

A skill can need both. If a skill calls `gh` via Bash *and* sends a Slack message via
MCP, add a fixture for `gh` and a mock for the Slack call — they operate independently.

---

## Speed flags worth using every time

| Flag | Effect |
| --- | --- |
| `--ablation none` | Skip the W/OUT baseline arm; halves run count (6 → 3). Use while iterating on graders. |
| `-j 8` | Up to 8 agent runs in parallel |
| `--verbose` | Shows per-run judge votes and evidence — essential for diagnosing grader issues |

Combined, `--ablation none -j 8` cuts wall-clock from ~90 s to ~47 s and cost from
~$1 to ~$0.50.

---

## Running evals in a worktree session

In worktree-isolated sessions, the PreToolUse hook refuses any Bash command containing
the word `eval`. Always run `claude plugin eval` through the **terminal tool** — it
executes in the user's interactive shell and is not subject to the worktree hook.

---

## CI gating

Evals are not yet run in CI per-PR. The open questions (pinned models, cost cap,
partial-result handling, threshold) are tracked in
[#411](https://github.com/dfadler/agent-config/issues/411). Until that's resolved,
run evals manually before merging skill changes.

When CI gating is added, the canonical flags will be:

```bash
claude plugin eval . \
  --trust-plugin \
  --json \
  --threshold 0.8 \
  --model <pinned-model> \
  --judge-model claude-sonnet-4-6 \
  --no-publish \
  --max-cost-usd 5
```

Exit codes: `0` = all cases at or above threshold, `1` = one or more cases below
threshold, `2` = eval runner error. Exclude `partial: true` results from the pass
rate calculation. Schedule as a nightly or pre-release job rather than per-PR to
keep CI cost predictable.

---

## File structure reference

```
plugins/my-plugin/
├── SKILL.md
└── evals/
    ├── fixtures/
    │   └── bin/
    │       └── netstat          ← intercepts the real netstat
    ├── mocks/
    │   └── slack/
    │       ├── slack_search_channels.md
    │       └── slack_send_message.md
    ├── my-case/
    │   ├── prompt.md            ← max_turns, allowed_tools frontmatter
    │   └── graders/
    │       ├── skill-fired.md   ← type: tool_used (free)
    │       └── criteria.md      ← type: llm (judge cost)
    └── results/                 ← gitignored; written by claude plugin eval
```
