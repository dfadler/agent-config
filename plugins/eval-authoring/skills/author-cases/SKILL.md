---
name: author-cases
description: Write or fix `claude plugin eval` cases - graders, mocks, fixtures, thresholds, should-trigger and should-not-trigger prompts. Use when adding eval cases or graders to a plugin.
argument-hint: "<plugin-path> [skill-or-agent]"
---

# Author eval cases

## Contract

- **Input:** `$ARGUMENTS`: the plugin to write cases for (a path), optionally the skill or
  agent to cover. With no argument, use the plugin in the working directory.
- **Output:** case files under the plugin's eval directory (`prompt.md` plus
  `graders/*.md`, or `case.yaml`), a `grants.yaml` entry for every granted tool, and the
  lint result. Paid runs are handed off, not started.
- **Does not:** run `claude plugin eval`, pass `--scaffold`, or restate lint rules.

A useful case can fail, tells the plugin from no plugin, gives a stable signal, covers the
trigger boundary and costs what it is worth (definition and checks:
[#449](https://github.com/dfadler/agent-config/issues/449)). The lint
(`${CLAUDE_SKILL_DIR}/../../scripts/ts/lint/cli.ts`, `--list-rules`) is the single source of
the mechanical rules; its messages say what to change. This skill covers what a script
cannot decide.

## Steps

1. **Read the plugin first.** Read the `SKILL.md` or agent file under test, its manifest,
   and any existing cases and `grants.yaml`. Write criteria from what the files say the
   plugin does, not from a summary of it.
2. **Generate or start blank.** `claude plugin eval init` proposes prompts and graders,
   trials them and writes the files, but it is interactive and needs a logged-in shell:
   ask the user to run it, then review what it wrote. `claude plugin eval init --bare
   <name>` writes a blank case without asking questions; use it when you write the case
   yourself or in CI. Do not reimplement `init`.
3. **Cover the boundary.** For each skill, write prompts a user would type, without
   naming the skill: some that should fire it, and some that should not, including
   near-misses that share its vocabulary but want something else. Every should-fire case
   needs a grader on whether the skill fired (see [graders](references/graders.md)).
4. **Pick graders, free first.** Name what must be true, map it to something observable,
   and reach for `llm` or `baseline` only when the property is semantic. The procedure is
   in [graders](references/graders.md). Pair a grader on the result with one on the steps.
5. **Write PASS and FAIL conditions** for any `llm` grader: `PASS if <observable thing>.`
   `FAIL if <observable thing>.` Concrete enough that two judges agree.
6. **Record grants.** If `allowed_tools` names `Bash`, `Write`, `Edit`, `WebFetch` or
   `WebSearch`, add the exact `--allow-tools` entry for that case to
   `<eval dir>/grants.yaml` ([format](../../docs/grants-format.md)). Keep each entry as
   narrow as the case needs; a grant applies to every case in a run, which is why they are
   recorded per case. Faking a CLI or MCP server: [fixtures and
   mocks](references/fixtures-and-mocks.md). Testing a plugin's agents:
   [agents](references/agents.md).
7. **Lint.** `node ${CLAUDE_SKILL_DIR}/../../scripts/ts/lint/cli.ts <plugin-path>` (Node 22
   or later). Fix every error. Fix each warning or write down why it is intended.
8. **Review and hand off.** Ask the case-reviewer agent for the judgment pass, if
   available. Then give the user the run command from the run-evals skill. Do not run paid
   evals yourself: agent sessions usually cannot authenticate, and `--scaffold` is manual
   opt-in only.

## Gotchas

- Declared plugin `dependencies` are not resolved in an eval run (observed in #450, not in
  the docs: the plugin is silently dropped). EVAL018 checks this.
- In a worktree-isolated session in this repo, a hook may block shell commands containing
  the word `eval`. Do not route around it; ask the user to run the command.
- Whether a case is useful is only known after a two-arm run (Δ above zero, graders
  discriminating). The lint cannot show that; say so rather than claiming it.
