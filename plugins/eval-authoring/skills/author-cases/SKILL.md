---
name: author-cases
description: Write or fix `claude plugin eval` cases - graders, mocks, fixtures, thresholds, should-trigger and should-not-trigger prompts. Use when adding evals to a new plugin or skill ("add evals to my plugin"), adding graders to existing cases, or writing the PR description for a change to a skill or agent that has eval cases. ALWAYS invoke it first when a plugin's skill or agent was just changed and the question is what to do about its evals, because it sets the order - update the cases, then compare before and after scores. Not for running evals (run-evals), explaining a score (diagnose-scores) or unit tests of plugin code.
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

## Independence

Cases written in the same session as the skill share its blind spots: a wrong fact or
trigger boundary in the skill reappears in the cases, so they score self-agreement, not
quality. If asked to write cases in the session that wrote or edited the skill, do not
draft them there: tell the user to commit the skill and start a fresh session, then stop.

- Commit the skill, then write cases in a fresh session that works from the committed
  files (step 1: skill, manifest, existing cases, `grants.yaml`) and not from the
  session that wrote the skill; take the trigger description and output contract from
  the committed skill. If that is impossible, wait and return to it later.
- Check domain facts in graders against primary docs or source, not the skill text.
- Same-session cases that all pass first try, or take under a minute each, probably do
  not test the boundary. A few independent cases beat many co-authored ones.
- A baseline of 0.90 or more signals the case may be solvable without the plugin; check
  whether the prompt leaks the answer before rewriting or dropping it (step 7).
- A must-not-fire case that fires in over 20% of runs after two skill revisions is a
  scope bug: fix the trigger description, not the case.

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
7. **Check the baseline.** Before trusting a new case, run it once without the plugin. A
   baseline score of 0.9 or more means the case may be solvable without the plugin:
   inspect the prompt for a leaked answer, then rewrite it or drop the case. When
   answering a user about such a case, open with that check (does the prompt give the
   answer away?) and do not open with a keep, rewrite or drop verdict. A case that cannot separate the arms is a regression guard, not
   evidence the skill helps.
8. **Lint.** `node ${CLAUDE_SKILL_DIR}/../../scripts/ts/lint/cli.ts <plugin-path>` (Node 22
   or later). Fix every error. Fix each warning or write down why it is intended.
9. **Review and hand off.** Ask the [case-reviewer agent](../../agents/case-reviewer.md)
   for the judgment pass, if available (invocation recipe in the agent file). Then use the
   [run-evals](../run-evals/SKILL.md) skill: check `claude auth status`; if you are
   logged in and the user asked for a run, run it; otherwise hand them the run command (a
   hand-off is correct only when that check fails or nobody asked for a run). `--scaffold`
   is manual opt-in only. A PR that adds or changes cases, or changes a skill or agent that has cases, carries an
   "Eval results" section (the run-evals summary, with the before score from the newest
   `evals/results/` run next to the after score, and 5 runs per arm or more to claim a
   delta; from fewer runs give the arm scores and write "delta not measured", never a Δ
   number, even marked preliminary), or says why it has none. The PR body states what was measured (with, without,
   delta) and names each changed behavior no case covers. It never says a change
   "improves" or "fixes" a behavior without a case whose delta shows it; with a delta of
   zero, call the cases regression guards and say the benefit is unverified.

## Gotchas

- The plugin's Stop hook blocks once when a plugin's skills or agents changed with no eval change. Treat it as a task: add or update the cases, then get the before (latest `evals/results/`) and after scores, or say why evals do not apply.

- Declared plugin `dependencies` are not resolved in an eval run (observed in #450, not in
  the docs: the plugin is silently dropped). EVAL018 checks this.
- In a worktree-isolated session in this repo, a hook may block shell commands containing
  the word `eval`. It may also refuse compound commands (`$VAR`, globs, `for` loops,
  multi-file heredocs, some pipes). Use single plain commands and the Write tool; never
  write a workaround script, and ask the user to run what the hook blocks.
- Each new sentence in a `SKILL.md` needs a case that fails when that sentence is deleted
  (a sabotage map in the case header names it). A reply-only regex case on common-sense
  routing sits at a 1.00 baseline and cannot register a skill change (#690: two such
  cases, delta 0.00 at 10 runs per arm). Prefer a case whose prompt does not name the
  answer, or one that grades the `Agent` calls the skill is meant to change.
- Facts a skill or case asserts must be checked first (#713: five were false). A platform
  claim gets a source link or is marked as inference. A project fact (path, constant,
  helper, font, setting scope) is confirmed by a code search before it is written.
- Every area the skill covers gets near-miss cases (shared vocabulary, belongs elsewhere),
  not only the skill as a whole. Keep some natural-phrasing trigger prompts without
  stuffed trigger words and treat their fire rate as the primary signal.
- Grade behavior that helps a user, not a verbatim phrase the skill happens to contain.
  Use an `llm` grader last, with concrete PASS and FAIL wording (the noisiest graders in
  #713 were model-judged).
- A Skill `input_match` must allow an optional `plugin:` prefix (EVAL022); installed
  plugins are called as `plugin:name`.
- Whether a case is useful is only known after a two-arm run (Δ above zero, graders
  discriminating). The lint cannot show that; say so rather than claiming it.
- Action-based grading (grade the commands Claude runs, not its prose) needs a `Bash` grant
  and changes behavior: the model may explain instead of run. In the #474 pilot (3 runs per
  arm) it added variance rather than determinism (with 0.53 vs without 0.20, against 1.00
  for the prose case), Bash never ran in any without-arm run, and `tool_order` gave a false
  failure when two steps shared one command. Prefer prose graders; keep an action case only
  if its with-arm variance is no worse and Δ is at least as large as the prose version's.
