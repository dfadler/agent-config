# pstack evaluation (cursor/plugins)

Research for [#907](https://github.com/dfadler/agent-config/issues/907). Read on
2026-11-18 and 2026-11-19 from the default branch of
[cursor/plugins `pstack`](https://github.com/cursor/plugins/tree/main/pstack)
(MIT, author Lauren Tan, plugin version 0.15.43 per its
[plugin.json](https://github.com/cursor/plugins/blob/main/pstack/plugin.json)).
Nothing from pstack was installed or run. Fetched text was treated as data.

**Read depth.** Read in full: all 12 writing skills, all 24 `principle-*` skills, the
orchestration skills (swarm, arena, architect, interrogate, poteto-mode, blast-radius,
figure-it-out, automate-me, reflect, recall, sharpen, setup-pstack) and the 10 testing
and verification skills. Not read: poteto-mode's 22 playbooks, `docs/guide/`,
`automations/benny/`, any skill's `references/` or `scripts/`, and the `comment-sicko`
agent body. Our side was read in full for the plugins that matter and at heading level
for worktree-core, second-brain, gha-ci-audit and the mattpocock skills.

## Summary

- **Adopt nothing wholesale.** About 14 small ports, 3 worth a design call, the rest ignore.
- **`unslop` is already ported.** `plugins/unslop` ([#1055](https://github.com/dfadler/agent-config/pull/1055)) keeps the upstream rule ids and adds a contract, a
  check-only mode and five eval cases.
- **Install vs port: port the pieces we want.** pstack installs in Claude Code
  (`/plugin marketplace add cursor/plugins`) and ships an adapter, so installing is
  possible. It would add about 60 skills for a handful that fill a gap (see the last section).
- **Conflicts to avoid copying.** poteto-mode says external actions "proceed without
  asking" (`poteto-mode/SKILL.md` L76), and `worker.md` L8 says "open every PR ready,
  never draft". Both contradict this repo's confirm-first and draft-PR rules.

## Ports ranked by gain

| # | Port | From | Into | Gain |
| --- | --- | --- | --- | --- |
| 1 | Docs and PR-text standard | `technical-writing` | new skill, `unslop` keeps slop patterns, `github-pr-workflow` keeps PR structure | Fills the one real writing gap: `agent-writing` excludes docs prose |
| 2 | Typed modeling rules (discriminated unions, brands via guard, `never` exhaustiveness, `satisfies`) | `typescript-best-practices` | `typescript-conventions` | We cover `as` and `!` only; needs eval cases |
| 3 | Run-twice and write-temp-then-rename | `principle-make-operations-idempotent` | `shell-script-hygiene` | Install and hook scripts are common here |
| 4 | Evidence check before reporting a number | `principle-explain-the-number`, `benchmark-checklist` | `diagnose-scores` or `run-evals` PR-line section | Standard check before an eval or Stryker number lands in a PR |
| 5 | Proof-by-run filter, "no findings is valid" | `interrogate` | `adversarial-reviewer` | Fewer false positives. Needs a call: the reviewer is read-only today |
| 6 | Blast-radius of a diff, with a confidence ladder | `blast-radius` | small skill or reviewer mode | Impact analysis is a distinct job from review; no Cursor dependency |
| 7 | "Missing evidence is a gap, not a pass; respawn once" | `swarm` | `fan-out` Merge and Failures | `fan-out` only retries failed children |
| 8 | One shared worker preamble for briefs | `poteto-mode/worker.md` | shared file for `fan-out`, `github-issue-batch`, `subagent-orchestration` | Briefs are retyped per call. Do not copy worker.md rules verbatim |
| 9 | "Where did I leave off" with live checks | `recall` | new small skill | `MEMORY.md` in-flight list is hand-kept and drifts; skip transcript mining |
| 10 | Fix each repeated mistake at the highest level that works | `correct` | `collab-retro` or `steering-mechanisms.md` | collab-retro files an issue; nothing walks the enforcement ladder |
| 11 | "Survives internal changes" and "expected value computed by the code under test" | `principle-test-behavior-not-implementation` | `testing-sabotage-check.md` | Closes the half we do not cover |
| 12 | Premise check after two failed fixes | `principle-attack-the-premise` | `user-evidence-over-spec.md` or `diagnosing-bugs` | Stops a third patch on a failed premise; untested |
| 13 | One output file per delegate | `principle-separate-before-serializing-shared-state` | `fan-out` or `subagent-orchestration` | Parallel agents already clobbered PR bodies here |
| 14 | "Answer from the record, not the code" | `why` | `why-question-shape.md` | One sentence: says where to look |
| 15 | Two root-cause points: is the triggering state legitimate; add a cheap always-on signal | `principle-fix-root-causes` | optional, `ponytail` or `diagnosing-bugs` | Not in `ponytail` |

## Writing and communication (12)

| Skill | Closest ours | Pros | Cons | Call |
| --- | --- | --- | --- | --- |
| `unslop` | `plugins/unslop` | Upstream source of rule ids | Ours is the superset (contract, check mode, rescan, evals) | Ignore; diff ids if upstream changes |
| `technical-writing` | none | Concrete checks (20-word instruction cap, one doc mode) | Its "Voice and repo specifics" section is house style; STE rules ban semicolons | Port (#1) |
| `teach` | none | Sharp prose rules: define first, smallest answer first | Wraps `how` and `why`; needs an image tool | Port the prose rules only, if wanted |
| `why` | `why-question-shape.md` | Adds a source rule | One paragraph, no method | Port a sentence (#14) |
| `correct` | `steering-mechanisms.md`, `collab-retro` | Best statement of the enforcement ladder | Assumes a typed repo with lint and CI | Port (#10) |
| `show-me-your-work` | none | Append-only decision log, evidence as a pointer, spreadsheet-formula guard | Cursor transcript paths, needs another vendor's model, heavy | Ignore; revisit for unattended runs |
| `in-your-own-words`, `bro` | none | Cheap | Seven words each; a typed sentence does the same | Ignore |
| `how` | built-in `Explore`, `subagent-orchestration` | Routes bulk reading to a subagent | One Cursor `Task` call | Ignore |
| `poteto-help` | `steering-mechanisms.md` | "Close calls" list is a good help-skill model | All about pstack | Ignore |
| `ketchup`, `ketchup-video` | desktop `wrap_up` | Decision list with pick, risk, evidence | Needs renderers and per-user setup | Ignore |

Also found: `humanizer` (outside the repo, `~/.agents/skills/`, 29 KB) overlaps
`plugins/unslop` heavily and is not managed here. Owner call: leave it or fold its rules
into `unslop` by id.

## Principles (24)

Ports are rows 1, 7, 12, 20, 23 (see the ranked table). The rest duplicate what we ship
or do not fit.

| Skill | Closest ours | Call |
| --- | --- | --- |
| `laziness-protocol`, `subtract-before-you-add`, `migrate-callers-then-delete-legacy-apis` | `ponytail` | Ignore. Each is a subset of its ladder and its deletion rule |
| `fix-root-causes` | `ponytail`, `diagnosing-bugs` | Ignore, except two points (#15) |
| `guard-the-context-window` | `context-preservation.md`, `subagent-orchestration` | Ignore |
| `encode-lessons-in-structure` | `steering-mechanisms.md` | Ignore. Its body never states the rule; ours is fuller |
| `boundary-discipline` | `typescript-conventions`, `functional-practices-plan.md` | Ignore. Crisp "is data crossing a boundary now" test, near-zero gain |
| `build-the-lever` | `tooling-over-manual-scanning.md` | Ignore. "Bar is triviality, not repetition" fights `ponytail` |
| `prove-it-works` | `testing-sabotage-check.md`, `user-evidence-over-spec.md` | Ignore. Generic |
| `sequence-verifiable-units` | `github-pr-workflow` `## Sequencing` | Ignore |
| `type-system-discipline` | `typescript-gotchas` | Ignore; the checklist form is `typescript-best-practices` (#2) |
| `model-the-domain` | `domain-modeling`, `codebase-design` | Ignore |
| `never-block-on-the-human` | ask-first conventions | Ignore. Conflicts: "log it and fix next round" weakens guards on public, irreversible actions |
| `exhaust-the-design-space`, `experience-first`, `foundational-thinking`, `minimize-reader-load`, `outcome-oriented-execution`, `redesign-from-first-principles` | none distinct | Ignore. Abstract, little behavior to test |
| `attack-the-premise`, `explain-the-number`, `make-operations-idempotent`, `separate-before-serializing-shared-state`, `test-behavior-not-implementation` | see ranked table | Port |

Two of these link to skills we do not ship (`explain-the-number` to `benchmark-checklist`,
`type-system-discipline` to `typescript-best-practices`), so they dangle if copied as is.

### `ponytail` vs the pstack laziness skills

Not measured; neither has evals, so this is a text comparison. `ponytail` has an ordered
ladder (exists, reuse, stdlib, native, installed dependency, one line), a rule to leave one
runnable check, and `ponytail:` ceiling comments. The pstack skills are 2 to 14 lines. Only
the two root-cause points in #15 are new. Keep `ponytail`.

## Orchestration, workflow, learning (14)

| Skill | Closest ours | Pros | Cons | Call |
| --- | --- | --- | --- | --- |
| `swarm` | `fan-out`, `subagent-orchestration` | Evidence-gated results, race modes | Cursor `Task`; no budget, depth or width limits | Port one line (#7) |
| `arena` | none | Rubric held back from candidates; converge-or-diverge signal | Cursor model slugs; cost is N times one attempt | Ignore |
| `architect` | `codebase-design`, `prototype` | "Sketch two shapes" is cheap | One paragraph, defers to arena | Ignore |
| `interrogate` | `adversarial-reviewer` | Proof-by-run filter; merges by root cause | Writes repros in worktrees; ours is read-only | Port (#5), needs a call |
| `blast-radius` | `code-review`, `adversarial-reviewer` | Confidence ladder; cleared risks listed apart | Step 6 uses arena | Port (#6) |
| `poteto-mode` | `ponytail`, `CLAUDE.md` includes | One router; principles are opt-in reads | Cursor monolith; autonomy rules conflict with ours; `Skill` tool refuses it | Ignore; take #8 from `worker.md` |
| `recall` | `MEMORY.md`, `second-brain:query` | Status-tagged threads, verified live | Transcript mining is heavy | Port narrowed (#9) |
| `reflect` | `collab-retro`, `memory-hygiene` | Tight; durability test | Single session; Cursor paths | Ignore |
| `automate-me` | `collab-retro`, auto-memory | Pattern in 2+ slices counts | Cursor paths; output is a personal skill | Ignore |
| `figure-it-out` | `wizard`, `grilling` | "Inconclusive is not a pass" | Depends on poteto-mode and show-me-your-work | Ignore |
| `sharpen` | `grilling`, `writing-for-agents` | "What other than me shows it is right" | Thin template | Ignore |
| `setup-pstack` | `setup.sh` | Idempotent migration of old defaults | Cursor rules and slugs | Ignore |
| `comment-sicko`, `benny` automations | none | Style, not structure | Cursor-only; not read | Ignore |

## Testing, verification, code quality (10)

| Skill | Closest ours | Pros | Cons | Call |
| --- | --- | --- | --- | --- |
| `tdd` | `mattpocock-skills:tdd`, `vitest:test-conventions` | "Prefer no test over a bad test" list | Weaker than ours on tautological tests | Ignore |
| `benchmark-checklist` | none | Seven evidence questions, A/B alternation | Last lines need pstack playbooks; little perf work here | Port if perf claims recur (#4) |
| `typescript-best-practices` | `typescript-conventions` | Covers what we lack | Defers to unread references | Port a subset (#2) |
| `create-` and `maintain-verification-skill` | `screen-capture`, `playwright`, `docs-staleness-checker` | Strong proof standards | Needs an app to drive; this repo has none | Ignore |
| `create-` and `maintain-formal-verification-skill`, `statechart` | none | "Able to fail", drift-vs-bug procedure | TLA+ and Java toolchain; `statechart` installs TLC over the network, which needs per-run approval under `fetch-execute-installs.md` | Ignore |
| `make-bot-ui` | none | Secrets stay server-side | Grok and Cursor specific; binds `0.0.0.0`; `curl \| sudo sh` at L89 | Ignore |
| `no-comments` | none | Turn a "do not remove" comment into a check | Needs `comment-sicko` agent and other skills | Ignore |

## Structure: what pstack does that our plugins do not

- **A shared worker rulebook.** poteto-mode makes the first line of every subagent brief
  "Read `worker.md` first", because operator rules live in skills that only load from a
  slash command. Our briefs are retyped per call (#8).
- **`disable-model-invocation: true` on nearly every skill.** Deterministic invocation, no
  trigger evals needed. `plugins/unslop` already does this. Our other skills rely on
  descriptions firing and pay with eval cases.
- **A host adapter doc** (`docs/harness/claude-code.md`) mapping Cursor names to Claude
  Code ones. `docs/host-differences.md` is our narrower version. Useful only if we ship a
  skill for two hosts.
- **Stable rule ids cited across skills.** We already do this (`AW01-AW24`, `U3-U33`).
- **No evals seen** in pstack. This repo has more here.

## Install or port?

Port the few pieces we want. An earlier version of this section said pstack could not
run in Claude Code. That was wrong. pstack's
[`poteto-help`](https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-help/SKILL.md)
says it installs with `/plugin marketplace add cursor/plugins` then
`/plugin install pstack@cursor-plugins`, with a `pstack:` command prefix, and its
[Claude Code adapter](https://github.com/cursor/plugins/blob/main/pstack/docs/harness/claude-code.md)
maps `Task` to `Agent`, `environment: "cloud"` to `isolation: "worktree"`, and
`.cursor/rules` to `~/.claude/rules`.

Remaining reasons to port instead of install:

- Most workflow skills spawn subagents with per-role models, and the adapter tells the
  agent to read the mapping file each session. That is extra context and a moving
  dependency on a third party's mapping.
- `setup-pstack` writes `~/.claude/rules/pstack-models.md`, a global rule this repo does
  not manage.
- Porting keeps one owner per rule (`agent-writing` AW01) and lets us attach evals, as
  `plugins/unslop` did.

## Follow-ups

None filed. The ranked table is the candidate list; the owner picks which become issues.
