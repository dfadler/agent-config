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
   Every case file you write, single-file `case.yaml` or `prompt.md`, starts with
   `schema_version: "1.1"` and a `name`; a draft shown to the user needs both lines too.
3. **Cover the boundary.** For each skill, write prompts a user would type, without
   naming the skill: some that should fire it, and some that should not, including
   near-misses that share its vocabulary but want something else. Every should-fire case
   needs a grader on whether the skill fired (see [graders](references/graders.md)).
4. **Pick graders, free first.** Name what must be true, map it to something observable,
   and reach for `llm` or `baseline` only when the property is semantic. The procedure is
   in [graders](references/graders.md). Pair a grader on the result with one on the steps.
   A reply-only skill case has no scored steps grader: `tool_used: Skill` is an unscored
   indicator in a two-arm run, and there is no other step to check. Keep the Skill check,
   grade the reply with free `regex` graders, and accept the EVAL009 info finding. Do not
   set `arm: both` on a should-fire Skill check to clear it: the no-plugin arm can never
   pass it, so it manufactures a delta that says nothing about the skill
   ([docs](https://code.claude.com/docs/en/plugin-evals#compare-against-a-no-plugin-baseline)).
   `arm: both` is for "must not fire" checks (`min: 0`, `max: 0`).
   The prompt must carry its inputs inline: the workspace is empty and a case has no
   `Write` grant by default, so a check that the reply names a file or line number is
   cheap for a no-plugin baseline to pass.
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
8. **Review and hand off.** Ask the [case-reviewer agent](../../agents/case-reviewer.md)
   for the judgment pass, if available (invocation recipe in the agent file). Then give the user the run command from the
   [run-evals](../run-evals/SKILL.md) skill. Do not run paid
   evals yourself: agent sessions usually cannot authenticate, and `--scaffold` is manual
   opt-in only.

## Gotchas

- Declared plugin `dependencies` are not resolved in an eval run (observed in #450, not in
  the docs: the plugin is silently dropped). EVAL018 checks this.
- In a worktree-isolated session in this repo, a hook may block shell commands containing
  the word `eval`. It may also refuse compound commands (`$VAR`, globs, `for` loops,
  multi-file heredocs, some pipes). Use single plain commands and the Write tool; never
  write a workaround script, and ask the user to run what the hook blocks.
- Whether a case is useful is only known after a two-arm run (Δ above zero, graders
  discriminating). The lint cannot show that; say so rather than claiming it.
