---
name: agent-writing
description: |
  Write or audit text that agents read: SKILL.md files, agent definitions, CLAUDE.md,
  AGENTS.md and convention files. Defines numbered rules AW01-AW20, each with a runnable
  check and a fix. Use when creating, editing, shortening or reviewing such a file, or
  when asked to audit a skill, agent or instruction file. Not for READMEs, docs prose,
  commit messages or PR text.
metadata:
  version: "1.0.0"
---

# Writing for agents

## Contract

- **Input:** a skill, agent definition or instruction file to write, edit or audit.
- **Output:** when auditing, a table of findings (rule id, `file:line`, the evidence,
  the fix) and a separate list of problems no rule covers; when writing, text that
  passes every check below.
- **Does not:** rewrite anything it was not asked to, judge whether an instruction is
  correct, or apply to prose a human reads (READMEs, docs, PR bodies).

Everything an agent reads costs context. Write the least text that makes the agent
follow the same process every run, and make every instruction something a reviewer
can check.

Rule ids are stable: other files cite them (`AW08`). A deleted rule leaves a gap and
its number is never reused.

## How to use

1. Audit: run each rule's **Check** on each file in scope. Read every grep hit before
   you accept it.
2. List findings, then ask which to fix. Change only what the user chose.
3. After editing, re-run every check on the changed files and grep for the old name
   or path of anything you moved.
4. A miss that no rule caught: tighten the nearest rule if its check should have
   caught it, otherwise add a rule at the next free number.

## Structure

- **AW01 one-owner.** Each fact, policy or command (labels, branch names, commit
  format, lint command) lives in one file; the others link to it. Check: grep a
  distinctive phrase; a second hit outside the owner is a duplicate. Fix: keep the
  owner's copy, replace the rest with a link.
- **AW02 agents-dispatch-only.** An agent file holds the input contract, scope and
  permission limits, and return format. The procedure lives in a skill the agent loads
  through `skills:` frontmatter. Check: does the agent body contain numbered steps?
  Fix: move them into the skill.
- **AW03 model-alias.** Declare a model by alias (`sonnet`, `opus`, `haiku`), never a
  versioned ID. Check: `grep -rnE "^model:.*[0-9]"`. Fix: use the alias.
- **AW04 register-and-delete.** A new skill is listed wherever skills are discovered
  (README table, router skill, agent roster); what it replaces is deleted, with the
  text it made stale. Check: grep the old name across the repo. Fix: remove each hit.
- **AW05 flat-steps.** Steps are ordered, named by action ("ensure X"), and safe to
  repeat. Where to look is a bullet list. Check: a paragraph that names three or more
  locations. Fix: make it a list.
- **AW06 one-sentence-rule.** A rule is one imperative sentence plus a check command;
  add detail only for a case the sentence would miss. Check: `wc -l` on each
  convention or rule file; over about 40 lines needs a reason. Fix: cut to the
  sentence and the check.
- **AW07 detect-by-property.** Describe the property that causes the problem, not a
  list of offenders, and mark any examples as non-exhaustive. Check: for each "look for
  X, Y, Z", name a fourth offender; does the wording still catch it? Fix: state the
  property.

## Content

- **AW08 instructions-not-history.** No incident logs, build numbers, dates, or words
  that age ("currently", "yet", "recently", "no longer"). A link to the issue that owns
  the rationale is fine; the story is not. Check: `grep -nEi "currently|\byet\b|recently|no longer|decision:|we chose"`.
  Fix: delete, or move the history to the PR or issue.
- **AW09 placeholders-in-examples.** Examples use placeholders (`<ComponentName>`,
  `@<scope>/<package>`), not real project, company or person names. Check: grep
  examples for proper nouns. Fix: substitute a placeholder.
- **AW10 cite-third-party.** A claim that a tool or service does something links to the
  vendor page that says it, worded as the vendor words it. No "I believe" or "not
  verified". Check: each "Tool X does Y" has a link. Fix: add the link, or delete the claim.

## Consistency

- **AW11 capability-matches-limits.** An agent described as read-only or report-only
  lists no `Write`, `Edit` or other mutating tool in `tools:`. Check: grep `tools:` in
  every agent whose description says "read-only" or "report-only". Fix: remove the tool
  or change the description.
- **AW12 statements-agree.** Two files must not state the same thing differently. Check:
  grep a distinctive term and compare every hit. Fix: keep one, link from the other.
- **AW13 one-example.** Show one example, in valid form with no escaped markup, and do
  not restate a format in several files. Check: grep the format's fence or keyword
  across the plugin. Fix: keep the single example.
- **AW14 reference-by-name.** Point to a file or section by its name, never "Step 4" or
  "above". Check: `grep -nE "Step [0-9]|see above|below"`. Fix: name the target.
- **AW15 description-earns-its-load.** A `description` is permanent context. It holds a
  trigger and a contract (when to use, what comes back), no procedure and no rationale,
  and stays under about 500 characters. A skill that only runs by hand sets
  `disable-model-invocation: true` and needs no trigger text. Check: count the
  description's characters. Fix: cut it to trigger plus contract.

## Context

- **AW16 bound-always-loaded.** `SKILL.md` stays under about 250 lines. Material that
  only one branch needs moves to a sibling file, with the condition for opening it
  written beside the pointer. Check: `wc -l SKILL.md`. Fix: split by branch.
- **AW17 delegate-bulky.** A step that reads more than about three files, searches the
  repo broadly, or prints more than about 50 lines goes to a read-only sub-agent, given
  the absolute repo root, the file list and the scratchpad path. Check: look for such
  steps. Fix: name the sub-agent and what it receives.
- **AW18 compact-return.** Every dispatch names what comes back (summary, findings,
  files changed) and a size cap. Check: each dispatch has a return line with a cap.
  Fix: add one.
- **AW19 checkable-completion.** Each step ends on a condition an observer can check
  ("every modified file is listed with its line"), not "until you understand". Check:
  grep for "until", "as needed", "if appropriate". Fix: state the finish line.

## Plain speech

- **AW20 plain-words.** Write whole sentences in the active voice, one idea each, naming
  the actor. Use the concrete word where a metaphor or inflated verb stands in
  ("use" for "leverage", "utilize"; "is" for "serves as"). Describe what a thing does
  or returns, not how it feels ("fast" is a number or a mechanism). Do not squeeze
  sentences into fragments, arrows or symbols the reader must decode. Check: grep
  `leverage|utilize|facilitate|robust|seamless|serves as`, then read the file for
  passives and fragments. Fix: rewrite the sentence so it states an action, fact or
  number.
