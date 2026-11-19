# pstack evaluation (cursor/plugins)

Research for [#907](https://github.com/dfadler/agent-config/issues/907). Read on
2026-11-18 from the default branch of
[cursor/plugins `pstack`](https://github.com/cursor/plugins/tree/main/pstack)
(MIT, author Lauren Tan, plugin version 0.15.43 per its
[plugin.json](https://github.com/cursor/plugins/blob/main/pstack/plugin.json)). I read
the skills named below in full or in their first 35-60 lines. I did not read every skill
(the repo has about 60) and ran nothing from it.

## Summary

- **`unslop` is already ported.** `plugins/unslop` came from
  [#1055](https://github.com/dfadler/agent-config/pull/1055) and cites the upstream
  file. It keeps the upstream rule ids and adds a contract, a check-only mode and five
  eval cases. Nothing more to adopt from the skill.
- **No conflict found** between `unslop` and `agent-writing`: `agent-writing` covers
  SKILL.md, agent and CLAUDE.md files and says it is not for docs prose, so the two
  have different scopes.
- **One idea worth a follow-up:** `technical-writing`, a docs and PR-text standard that
  defers slop patterns to `unslop`. This repo has no writing standard for docs prose
  or PR text.
- **Install vs port: port the few pieces we want.** pstack installs in Claude Code
  (`/plugin marketplace add cursor/plugins`) and ships an adapter that maps Cursor names
  to Claude Code ones, so installing is possible. Installing adds about 60 skills for
  the handful that fill a gap here (see Install or port).

## unslop: upstream vs ours

Source:
[pstack/skills/unslop/SKILL.md](https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md)
vs `plugins/unslop/skills/unslop/SKILL.md`.

| Point | Upstream | This repo |
| --- | --- | --- |
| Rule ids | 3-33, stable, "removed rule leaves a gap" | Same ids, prefixed `U` |
| Form | One-line imperatives | Pattern name, then a fix sentence with an example |
| Modes | Rewrite only | Rewrite, plus `check` (list `U7: "pivotal"`) |
| Output contract | None | Pasted text returns text only; file returns edit plus rule ids |
| Rescan | None | One re-scan after the rewrite |
| Evals | None seen | `plugins/unslop/evals/` (5 cases) |

The rule set is the same. The word lists in U7 and U26 are longer here (for example
`tapestry`, `bedrock`, "gold-plating").

Upstream's gaps in the id sequence (1, 2, 4, 6, 21) are removed rules. Ours keeps the
same gaps, so a later sync can diff by id.

**Recommendation: ignore for now.** To keep the port current, diff the two rule lists by
id when upstream changes. That is a manual check, not a task.

## Other pstack skills

| pstack skill | What it does | Here | Recommendation |
| --- | --- | --- | --- |
| `technical-writing` | Diataxis mode per doc, Google style, STE sentence rules, Global English; defers slop to `unslop`; covers PR bodies and commit messages | Nothing for docs prose. `agent-writing` excludes it | **Port** (follow-up issue) |
| `principle-laziness-protocol`, `principle-subtract-before-you-add` | Short bias-toward-deletion rules | `ponytail` plugin (ladder, "deletion over addition") | Ignore, duplicate |
| `principle-guard-the-context-window` | Route bulk to subagents | `context-preservation.md` convention, `subagent-orchestration` | Ignore, duplicate |
| `principle-encode-lessons-in-structure` | A repeated instruction becomes a lint, flag or script | `docs/steering-mechanisms.md`, `check-plugin-structure` | Ignore, already the practice here |
| `principle-test-behavior-not-implementation` | Test passes only if it fails when behavior breaks, and survives internal change | `testing-sabotage-check.md` covers the first half only | **Port** the second half (one sentence) if wanted |
| `principle-minimize-reader-load` | Count layers and hidden state between question and answer | Nothing equivalent | Low value, ignore |
| `tdd` | Failing test first when the test path is cheap; skip when it is not | `mattpocock-skills:tdd` | Ignore |
| `reflect` | Mine a transcript for learnings, route each to a skill edit, wait for approval | `collab-retro`, `memory-hygiene` | Ignore, similar |
| `swarm` | Fan out N cloud workers, results `PASS`/`ISSUES`/`BLOCKED`, drop results missing SHAs and method | `fan-out`, `subagent-orchestration` | Ignore; the "drop a result that lacks its evidence" rule is the one idea, and a one-line check |
| `no-comments` | Spawns a comment-removal subagent | None | Ignore, Cursor-specific |
| `setup-pstack` | Detects model slugs, writes an always-applied rule | Not applicable (Cursor rules) | Ignore |

I did not read the other `principle-*` skills, `arena`, `interrogate`, `recall`,
`sharpen`, `statechart`, `teach` or the verification skills. Their one-line
descriptions in the upstream directory listing do not suggest an overlap that
matters, but that is a guess.

## Structure: what pstack does that our plugins do not

- **Stable rule ids cited by other skills.** `technical-writing` says "apply the
  unslop skill"; `unslop` says ids are stable. This repo already does the same
  (`AW01-AW24`, `U3-U33`, and `agent-writing` AW14 on referencing by name).
- **`disable-model-invocation: true` on nearly every skill.** `plugins/unslop`
  already sets it. Our other skills rely on descriptions firing, which is why we have
  eval cases for triggers. No change suggested.
- **No evals seen.** I found no eval cases in pstack. This repo has more here.

## Install or port?

Port the few pieces we want. An earlier version of this section said pstack could not
run in Claude Code. That was wrong. pstack's
[`poteto-help`](https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-help/SKILL.md)
says it installs with `/plugin marketplace add cursor/plugins` then
`/plugin install pstack@cursor-plugins`, with a `pstack:` command prefix, and its
[Claude Code adapter](https://github.com/cursor/plugins/blob/main/pstack/docs/harness/claude-code.md)
maps `Task` to `Agent`, `environment: "cloud"` to `isolation: "worktree"`, and
`.cursor/rules` to `~/.claude/rules`. I read both; I did not install or run pstack.

Remaining reasons to port instead of install:

- Most workflow skills spawn subagents with per-role models, and the adapter tells the
  agent to read the mapping file each session. That is extra context and a moving
  dependency on a third party's mapping.
- `setup-pstack` writes `~/.claude/rules/pstack-models.md`, a global rule this repo does
  not manage.
- Porting keeps one owner per rule (`agent-writing` AW01) and lets us attach evals, as
  `plugins/unslop` did.

## Follow-ups worth filing

1. Port `technical-writing` as a docs and PR-text skill, with `unslop` owning slop
   patterns. Needs an owner decision on whether it overlaps `github-pr` PR-body rules.
2. Optional: add the "breaks when behavior breaks, survives when internals change"
   second half to `testing-sabotage-check.md`.

Not filed. The owner decides whether either is worth a ticket.
