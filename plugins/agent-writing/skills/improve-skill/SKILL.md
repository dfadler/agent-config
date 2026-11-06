---
name: improve-skill
description: |
  Audit and improve an existing skill, agent or plugin that lives at a path: find every file it
  owns, check them against the agent-writing rules and this repo's skill conventions, report
  findings with line numbers, then rewrite only what the user picks. Use for "audit", "improve",
  "clean up" or "tighten" a skill or plugin. Not for writing a new skill, reviewing a PR, or
  editing a README or docs page.
metadata:
  version: "1.0.0"
---

# Improve a skill

## Contract

- **Input:** a path to a skill directory, a plugin root or an agent file, or a name that
  resolves to one. Ask only when the request names nothing that resolves.
- **Output:** a findings table (id, `file:line`, evidence, fix), a list of problems no rule
  covers, then one question asking which findings to fix. After the answer, the edited files
  and a verify report: findings fixed, findings left, findings that could not be checked.
- **Does not:** edit before the user chooses, write a new skill, restate the
  [agent-writing](../agent-writing/SKILL.md) rules, or judge whether an instruction is correct.

## Procedure

1. **Scope.** Resolve the target to a skill directory. List every file it owns, one line
   each with its line count:
   - `SKILL.md` and everything under its `references/` and `scripts/`;
   - eval cases that name it: `grep -rl "<skill-name>" <plugin>/evals`;
   - agents that load it: `grep -rl "<skill-name>" <plugin>/agents` and any other `agents/`
     directory in the repo, kept only where the name sits in a `skills:` list;
   - indexes that list it: `grep -rl "<skill-name>" README.md docs` plus any router skill.
   Done when each of those searches is run and its hits (or "none") are in the list.
2. **Audit.** Load [agent-writing](../agent-writing/SKILL.md) and run its checks on every
   listed file, rule ids as that skill defines them. Then run the checks in the Skill conventions section.
   With more than 5 files, dispatch one read-only sub-agent given the absolute repo root,
   the file list and the scratchpad path; it returns at most 40 lines of
   `file:line | id | one-line fix`, and you read each hit before you accept it.
3. **Report.** Write, in this order: the findings table, sorted by rule id with convention
   findings last; the problems no rule or convention covers (`file:line | uncovered | fix`, or
   "uncovered: none found"); anything you could not verify. Show no rewritten text.
4. **Ask.** End the turn on one question: fix all findings, or which subset. Use
   `AskUserQuestion` when it is available, otherwise make the question the last paragraph.
   Edit nothing before the answer.
5. **Rewrite.** Apply only the chosen findings, in this order: moves (update every path that
   pointed at the old location), then removing duplicates, then wording.
6. **Verify.** Re-run every check from the Audit step on the changed files; each fixed finding must
   come back clean. Grep the repo for the old path or name of anything you moved. Confirm
   the frontmatter still parses. Run `claude plugin validate <plugin-root>` and the repo's own
   structure checks where they exist (`scripts/ts/check-plugin-structure.ts`,
   `scripts/ts/check-skill-contracts.ts`). Report what was fixed, what was left and why, and
   what could not be checked.

## Skill conventions

These add to the agent-writing rules; they are about a skill's place in this repo.

- **SC1 contract-section.** `SKILL.md` has a `## Contract` heading with an `**Input:**` and an
  `**Output:**` line (`docs/skill-composition.md`). Check: `grep -nE "^## Contract|\*\*(Input|Output):\*\*" SKILL.md`.
  Fix: add the section; do not invent behavior the skill lacks.
- **SC2 not-for-clause.** The `description` names when to use the skill and when not to
  ("Not for ..."). Check: read the frontmatter; a description with a trigger and no "Not
  for" clause is a finding. Fix: add the clause, naming the nearest skill that owns the
  excluded case.
- **SC3 evals-exist.** At least one eval case names the skill. Check:
  `grep -rl "<skill-name>" <plugin>/evals` returns a file. Fix: report it; when the
  eval-authoring plugin is installed, name its `author-cases` skill as the way to add cases,
  and do not write them in the session that rewrote the skill.
