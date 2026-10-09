# Plan: functional practices across agent-config

Status: in progress (updated 2026-10-02). Owner: dfadler.

## Goal

Encode functional-programming practices into everything this repo ships, so its
behavior is:

- **Composable**: small units joined through stated interfaces.
- **Type-safe**: invalid states are rejected at a boundary, not discovered later.
- **Easy to reason about**: decisions are separated from side effects.
- **Easy to extend**: adding a case means adding data, not editing logic.
- **Certain**: claims are backed by checks that fail when the claim is false.

"Everything" means the whole system, not just TypeScript scripts: skills,
hooks, setup and teardown scripts, generated config, evals, and CI.

## Principles and where they apply

| Principle | Applies to | Concrete rule |
| --- | --- | --- |
| Pure functions | Skills, TS scripts | A skill documents `## Contract` (input, output) and does not depend on hidden session state. Script logic takes data and returns data. |
| Composition | Skills, CI checks | Skills call each other only through contracts. A caller's expected output type must match the callee's declared output. |
| Idempotence | `setup.sh`, `teardown.sh`, hooks | Running twice equals running once, asserted by tests. |
| Declarative config | `DEFAULT_ENABLED`, plugin manifests, generated `@include` blocks | Config is data. A pure function derives the install plan from it. |
| Effects at the edges | Scripts, hooks | Decide (pure, testable) is separate from do (writes, `gh`, network). A hook emits a decision; a thin shell applies it. |
| Parse, don't validate | I/O boundaries | Unknown input becomes a typed value once, at the edge. Core code never re-checks it. |
| No hidden mutation | Core TS modules, generated files | Core code uses `readonly` data and no `let` or in-place mutation. Generated files are never hand-edited. |
| Certainty | Skills, scripts, CI | Evals act as property tests for skills. New tests get a sabotage spot-check. CI gates fail closed. |

## Where each piece lives

Per [`claude/conventions/README.md`](../claude/conventions/README.md), an
always-loaded include costs context every turn, so depth goes in a skill and
enforcement goes in tooling.

- **Opt-in convention** (`claude/conventions/functional-design.md`): one short
  paragraph stating the principles. Listed as opt-in in `DEFAULT_ENABLED`.
- **Skill** (`functional-design`, in `dfadler-agent-config`): the patterns,
  the `Result` conventions, and when impurity is acceptable. Declares a
  `## Contract`.
- **Tooling**: lints, tests, and CI checks (phases below). These are the
  source of certainty; the prose is only guidance.

## Decisions

### TypeScript library: hand-rolled, plus boundary parsing

Options considered. Characteristics are from memory and must be checked against
current docs before adopting any of them.

| Option | Gives | Cost |
| --- | --- | --- |
| Hand-rolled `Result`, `pipe` | About 100 lines, no new dependency | We maintain it; thinner than a library |
| neverthrow | Mature `Result` and `ResultAsync` | One dependency; error handling only |
| fp-ts | `Either`, `Option`, type classes | Heavy; development reportedly folded into Effect |
| Effect | Typed errors, DI, concurrency, schema | Large learning surface; imposes its idiom |
| Zod or Valibot | Boundary parsing into typed values | One dependency; not an FP library |

Decision: hand-rolled `Result` and `pipe` in `scripts/ts/lib/`, plus Zod or
Valibot at I/O boundaries. Revisit Effect only if scripts grow into programs.

### Scope: whole system, TypeScript is one layer

TypeScript is the scripting language ([#419](https://github.com/dfadler/agent-config/issues/419)),
so the library and lint work lands there. Skills, hooks, and shell scripts
follow the same principles through their own mechanisms (contracts, decision
and effect split, idempotence tests), not through TypeScript.

## Phases

Each phase is one PR. Phases 1, 2, and 4 are independent; 3 stacks on 2 (it
refactors the script 2 tests); 5 needs 1 and 4; 6 comes last.

1. **Skill contract type-compatibility.** Extend the contract lint (see
   Dependencies) so a caller's expected output is checked against the callee's
   declared `**Output:**`, not just that the section exists. Needs a small
   machine-readable type notation in `## Contract`.
2. **Idempotence tests for `setup.sh` and `teardown.sh`. Done (#494).** bats tests, hermetic
   per the shell-hygiene convention: run twice in a throwaway `HOME`, assert the
   second run changes nothing.
3. **Pure plan, thin shell for setup (bash). Done (#497).** Extract the install-plan
   derivation (from `DEFAULT_ENABLED`, flags, and current state) into a pure
   bash function that prints plan lines as data, with tests; a thin applier
   executes them. Bash, not TypeScript, because `setup.sh` bootstraps a fresh
   machine before Node exists. Stacks on phase 2. If the phase 8 migration
   reaches `setup.sh`, this layer is replaced, so keep the line format simple.
4. **TypeScript `lib/`. Done (#493).** `Result`, `pipe`, `collect`, with `fast-check`
   property tests. Add `eslint-plugin-functional` (immutability, no `let`) and
   `switch-exhaustiveness-check` for core directories. Verify rule names
   against plugin docs first.
5. **Reference refactor.** Convert `scripts/ts/skill-contracts.ts` to the
   `Result` and rule-list style: `findViolations` becomes a list of
   `Rule = (ctx) => Violation[]` concatenated, so adding a rule is adding an
   element.
6. **Skill and convention.** Write `functional-design` and the opt-in
   convention, after the patterns exist and have been used once.
7. **Generated-output check. Deferred.** The repo has no committed generated
   files for a drift check to guard (the managed block in `~/.claude/CLAUDE.md`
   is host-local, and `pnpm-lock.yaml` drift already fails under
   `--frozen-lockfile`). Tracked in
   [#492](https://github.com/dfadler/agent-config/issues/492).
8. **Repo-wide TypeScript migration (fast follow).** Move the repo's scripts to
   TypeScript on the phase 4 library, building on #419 (Python scripts) and
   extending to shell where it makes sense. Done so far: Batch 0 (the
   `setup-node-pnpm` action and CLI helpers, #495) and the Batch 1 lint ports
   (`check-claude-md-lines`, `check-markdown-links`, `check-shell-set-flags`,
   #498 and #496). Next: `check-plugin-structure`, then `gha-ci-audit`, then the
   small plugin scripts. Still undecided: whether the bootstrap scripts
   (`setup.sh`, `teardown.sh`, `doctor.sh`), the hooks, and `agent_term.py`
   move at all, and whether plugins require Node.

## Verification

- Every phase adds tests, and each new test gets a sabotage spot-check
  ([`testing-sabotage-check.md`](../claude/conventions/testing-sabotage-check.md)).
- Skill behavior changes get an eval case, not only a lint.
- Dependency additions (`fast-check`, `eslint-plugin-functional`, a parser
  library) get an audit per
  [`dependency-audits`](../plugins/dependency-audits/SKILL.md).

## Dependencies and open questions

- **Skill-composition-contracts work is unmerged.** The `## Contract` lint,
  `scripts/ts/skill-contracts.ts`, and `pnpm run check-skills` live uncommitted on
  branch `worktree-skill-composition-contracts`. Phases 1 and 5 build on them,
  so they wait for that work to merge. Phases 2, 3, and 4 do not.
- **Type notation for contracts.** Plain prose types cannot be compared. Options:
  a small inline notation (`**Output:** `{ failed: Run[] }``) or a fenced
  schema block. Decide in phase 1.
- **Boundary parser.** Zod or Valibot. Decide in phase 4 after checking bundle
  and dependency cost.
- **Idempotence of hooks.** Some hooks have unavoidable effects (notifications).
  Define which are exempt before phase 2 extends to them.

## Non-goals

- Rewriting a script that cannot assume Node (bootstrap, pre-Node hooks)
  without first deciding how Node gets there.
- An always-on convention longer than a paragraph.
- Adopting Effect or fp-ts now.
