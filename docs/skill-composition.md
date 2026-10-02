# Skill composition: contracts, not hope

Skills here compose the way small Unix tools do: each does one job, and one
skill hands work to another through a stated interface. Nothing in Claude Code
enforces that. A model picks skills at runtime from their `description`, so
composition holds only when each skill documents what it accepts and returns.

## The principle

The [Unix philosophy](https://en.wikipedia.org/wiki/Unix_philosophy) is usually
summarised as three rules from Doug McIlroy: make each program do one thing
well, expect its output to become another program's input, and design to be
combined. Eric Raymond's
[Basics of the Unix Philosophy](http://www.catb.org/esr/writings/taoup/html/ch01s06.html)
(*The Art of Unix Programming*) expands them into a longer rule list. Read
those for the full argument; this page keeps only what changes how we write
skills.

| Unix idea | In a skill |
| --- | --- |
| Do one thing well | One job per skill. If the description needs "and also", split it. |
| Output becomes input | A documented output shape another skill can consume. |
| Text is the interface | Plain data (JSON, a report line) as the hand-off. No hidden state. |
| Small tools, thin glue | An orchestrator such as `pr-babysit` routes and delegates. It doesn't re-implement. |

## Checklist for a new skill

- [ ] **One job.** The description states it in one sentence and says what the
      skill is *not* for.
- [ ] **A `## Contract` section** if any other skill will call it (the check
      below enforces this): an `**Input:**` line, an `**Output:**` line, and
      optionally `**Does not:**`.
- [ ] **Accepts pre-fetched input** where the caller usually already holds the
      data. `pr-checks` and `pr-comments` take the `pr-babysit` snapshot instead
      of re-fetching it.
- [ ] **Works standalone** when it can, so it is testable and usable without its
      caller. Say so in a "Works standalone" section when true.
- [ ] **References siblings by name**, not by hoping the model notices them: a
      relative link (`[pr-checks](../pr-checks/SKILL.md)`) or `plugin:skill`.
      Reference the skill's contract, not its internals.
- [ ] **Cross-plugin references degrade.** If the other plugin may not be
      installed, say what to do without it (see `screen-capture:capture`
      reading `second-brain:config`). Whether to declare a plugin dependency is
      covered in [contributing.md](./contributing.md#adding-something-new).

## What is enforced

`make check-skills` runs `scripts/ts/check-skill-contracts.ts`. It fails when:

1. a skill references a skill that doesn't exist in this repo, or
2. a skill that another skill references has no `## Contract` section with both
   an `**Input:**` and an `**Output:**` line.

It checks that the contract is present, not that it is true. Whether
composition actually happens at runtime is what an eval is for; see
[Plugin evals](./contributing.md#plugin-evals).
