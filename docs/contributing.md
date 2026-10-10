# Contributing: adding content, checks, and GitHub operations

## Adding something new

1. Put it in the right place:
   - A **skill** → a new directory under `plugins/<plugin>/skills/`,
     containing a `SKILL.md`. A skill that another skill will call needs a
     `## Contract` section; see [`docs/skill-composition.md`](./skill-composition.md).
   - An **agent** → a new `.md` file under `plugins/<plugin>/agents/`.
   - A **slash command** → a new `.md` file under `claude/commands/`.
   - A **convention** (global guidance for `CLAUDE.md`) → first check
     [`claude/conventions/README.md`](../claude/conventions/README.md). Most
     task-shaped guidance should be a skill, not an `@include`.
   - A **hook** → an entry in the plugin's `hooks/hooks.json`,
     pointing (via `${CLAUDE_PLUGIN_ROOT}`) at a script under wherever fits — a
     related skill's own `scripts/`, if the hook is that skill's companion. Unlike
     everything else in this list, a hook activates for every project this plugin
     is enabled in the moment it's added — there's no opt-in step on the
     project's side — so it needs to be safe to run unconditionally: no-op
     cleanly (exit 0, no output) whenever its precondition doesn't hold (wrong
     project type, feature not configured, required CLI missing), and never let
     the hook's own failure block a session start. The `git-worktree-usage`
     skill's hooks, owned solely by `worktree-core`, are the reference example;
     see `docs/hook-composition.md` for the enable/disable protocol they follow.
   - A whole new **plugin** (a set of skills/agents that belong together) → a new
     directory under `plugins/`, with its own `.claude-plugin/plugin.json`, `agents/`,
     and `skills/`. Keep the directory name and the manifest `name` identical.
     `setup.sh` auto-discovers any directory under `plugins/` that carries a
     `plugin.json`, so no manual changes to `setup.sh` are needed.
     **If the plugin calls another plugin's skill or hooks at runtime**, declare it in
     the manifest's `dependencies` array ([plugin dependencies](https://code.claude.com/docs/en/plugins/dependencies);
     `requires` is not a Claude Code field and is ignored). A declared dependency is
     enforced at load time, and it is not resolved inside a `claude plugin eval` run:
     a plugin with an unmet dependency is silently dropped ([#450](https://github.com/dfadler/agent-config/issues/450)),
     so a plugin that needs evals must also load the dependency from inside its own
     directory through the case's `plugins:` field. If the plugin only pairs with
     another (as `github-pr` does with `worktree-core`), don't declare it:
     document the pairing in the plugin's README and, if hooks are involved, in
     `docs/hook-composition.md`.
2. Name skills and agents plainly — `pr-babysit`, not `github-pr-pr-babysit`
   — in both the directory/filename and the frontmatter `name:`. The plugin namespace
   already prevents collisions with a project's own skills, so a prefix here would just
   repeat it. Commands stay unprefixed for a different reason: `claude/commands/` is
   linked entry-by-entry into `~/.claude/commands/`, outside any plugin, so those names
   really are flat.
3. Run `claude plugin validate plugins/<plugin>` — it checks the manifest
   and parses the frontmatter of every skill and agent inside.
4. Run `bash scripts/ci.sh check` (see [Checks](#checks) below) before pushing.
5. Commit and push. A new skill or agent inside an already-linked plugin needs no
   `setup.sh` re-run; anything under `claude/`, or a whole new plugin, does — see
   [`docs/setup.md`](./setup.md).

### Adding a companion

A recommended companion plugin or tool (referenced, never vendored) touches three
places, and nothing enforces that they stay in sync:

- [ ] README's "Recommended companions" list names it.
- [ ] [`docs/companion-plugins.md`](./companion-plugins.md) has its own section: what
      it is, license, provenance checked against the actual repo/GitHub API rather
      than marketing copy, install commands, and what `setup.sh` does about it.
- [ ] `scripts/check-companions.sh` has an advisory `check_<name>` function (plus a
      bats case in `scripts/tests/check-companions.bats`), **or** the
      companion-plugins.md section documents why it's excluded. Take the install id
      from the upstream's own `.claude-plugin/marketplace.json`, not a guess.
- [ ] Every platform-capability claim (official-vs-third-party marketplace,
      auto-update defaults, install ids) is checked against current official docs
      and cited, per
      [`claude/conventions/cite-platform-claims.md`](../claude/conventions/cite-platform-claims.md)
      — don't copy it from a similar prior entry.
- [ ] If the install is fetch-and-execute (`curl | sh`, `npx <pkg>@latest`), say so
      and point at the `fetch-execute-guide` skill, as the
      `rtk-ai/rtk` entry does; the advisory check must never run it.

### Why skills here don't declare `allowed-tools`

An automated reviewer (SkillSpector, via CodeRabbit on #51) flags every `SKILL.md`
under `plugins/*/skills/` for "unrestricted tool access" and
recommends adding `allowed-tools` frontmatter as a remediation. This was decided
deliberately in #63, not overlooked — recorded here so it isn't re-litigated by the
next bot or reviewer that runs the same check.

`allowed-tools` doesn't do what the finding assumes. In Claude Code, it's a
pre-approval list, not a restriction: tools it names skip the permission prompt for
that turn, but every tool remains callable regardless of what's listed — governed by
the user's own permission settings, the same as if the skill didn't exist. The field
that actually removes tools from the pool is `disallowed-tools`, which the finding
doesn't ask for and which doesn't fit here anyway (see below). Declaring
`allowed-tools` in the spirit the finding wants — as a security boundary — would
misrepresent what the field does to the next reader, which is worse than the current
silence.

Even setting the mechanism aside, an allowlist doesn't fit this plugin's actual
skills:

- **Advisory/methodology skills** (`pr-review-rubric`) don't call tools themselves —
  they're guidance the orchestrating turn follows. An allowlist on a skill like this
  describes nothing real; the tools in play belong to whatever task invoked it.
- **Legitimately broad skills** (`pr-babysit`) read, edit, run `gh`, push, and rerun
  CI as its actual job. A "minimal" list for it would just restate "most tools,"
  adding a maintenance burden with no corresponding safety gain.
- **Narrow skills** (`gh-attach-image`) could carry an accurate
  short list, but accuracy for one skill isn't worth an inconsistent, partially-
  fictional convention across the other skills.

The real boundary is the one this repo's global `CLAUDE.md` and every session already
operate under: Claude Code's permission rules, hooks, and the active permission mode
enforce tool access, regardless of what any skill's frontmatter claims. `CLAUDE.md`
and skill instructions — including a skill's own `allowed-tools` — are behavioral
guidance the model follows, not an enforcement layer; only `settings.json`
permission rules and hooks actually gate a tool call. A skill-level allowlist that
can't restrict anything would be a paper boundary layered on top of the real one —
worth avoiding on those grounds even before the mechanism question above.

## Checks

New scripts are TypeScript (`node script.ts`; see [`testing.md`](testing.md)). Two documented
exceptions stay: the bootstrap bash that runs before Node exists or manages the user's `~/.claude`
(`setup.sh`, `teardown.sh`, `doctor.sh`, `scripts/check-companions.sh` and the libs they source,
`scripts/session-sync.sh`), and `detached-terminal`'s `agent_term.py` (Node has no stdlib PTY).
Those keep the shellcheck/shfmt/bats/kcov and ruff/mypy/pytest gates below
([#441](https://github.com/dfadler/agent-config/issues/441)).

`scripts/ci.sh check` runs everything CI runs, and CI calls these same targets
(`bash scripts/ci.sh <target>`, or `pnpm run <name>` for the Node-based ones) so a
green run locally means the same thing a green PR does. `pnpm run check` is a thin delegate to the same script; `bash scripts/ci.sh --help`
lists every target.

```bash
bash scripts/ci.sh check   # lint + structure + typecheck + test + actionlint + coverage
```

| Target | What it does |
| --- | --- |
| `lint-sh` | `shellcheck`, `shfmt -i 2 -ci -d`, the `set -uo pipefail` convention, and the `claude/CLAUDE.md` line-count ceiling (`scripts/ts/check-claude-md-lines.ts`) |
| `lint-py` | `ruff check` and `ruff format --check` |
| `typecheck` | `mypy --strict` over the Python sources |
| `structure` | Plugin manifests and skill/agent frontmatter agree with their directories |
| `test-sh` | `bats` suites under `scripts/tests/` |
| `test-py` | `pytest` suite under `scripts/tests/` |
| `coverage` | Re-runs the `bats` suites under `kcov` and enforces the coverage floor (Linux only) |
| `coverage-py` | Re-runs `pytest` under `pytest-cov` and enforces its floor |
| `lint-ts` / `typecheck-ts` / `test-ts` / `coverage-ts` (`pnpm run lint` / `typecheck` / `test` / `coverage`) | `eslint`, `tsc --noEmit`, Vitest, and its coverage floor over `scripts/ts/` (see [`testing.md`](testing.md)) |
| `check-skills` (`pnpm run check-skills`) | A skill another skill references must have a `## Contract` (Input/Output), and references must resolve ([`docs/skill-composition.md`](./skill-composition.md)) |
| `fmt` | Rewrites sources to the repo's `shfmt` / `ruff` style |
| `lint-actions` | `actionlint` over `.github/workflows/` |

```bash
brew install shellcheck shfmt bats-core actionlint
nvm use            # TypeScript side: Node from .nvmrc
```

The Python side needs `.venv`, and the Node side needs `node_modules`; `scripts/ci.sh`
builds each on demand (stamp files `.venv/.installed` and `node_modules/.installed`
skip the work until `requirements-dev.txt`, `package.json` or `pnpm-lock.yaml` change),
and `bash scripts/ci.sh venv` / `node-modules` do it explicitly. Shell-only targets
(`lint-shellcheck`, `lint-shfmt`, `structure`, `test-sh`, `coverage`, `lint-actions`)
need neither. Python tools always run through `.venv`, never whatever `python3` is on
`PATH`.

The TypeScript targets need the Node in `.nvmrc` (22.18+ for native type
stripping — the system Homebrew Node may not qualify), so run `nvm use` first.
The package manager is pnpm, pinned by `packageManager` in `package.json`;
dependencies are pinned by `pnpm-lock.yaml`. The Node-based checks (the TypeScript ones, `lint-set-flags`, `lint-claude-md`, `check-links`, `check-vitest-*`) are `package.json` scripts.

`coverage` needs `kcov` and `jq` on top of the tools above. It only measures
anything on Linux: kcov instruments bash by injecting a library into the traced
shell, and macOS SIP strips that from `/bin/bash`, so on a Mac the target says so
and skips rather than reporting a meaningless 0%. The floor it enforces is a
measured baseline (see `COVERAGE_MIN` in `scripts/ci.sh` for the number, how
it was taken, and what is and isn't in the denominator) — a regression gate, not a
target to design tests around.

**Ported check** (adding a Node-based check): add `"lint-foo": "node scripts/ts/check-foo.ts"`
to `package.json`, list `lint-foo` in `pnpm_name` and `check` in `scripts/ci.sh`, and add
`pnpm run lint-foo` to the workflow that runs it (after the `./.github/actions/setup-node-pnpm`
step). A plugin-owned check uses `plugins/<plugin>/scripts/ts/check-foo.ts`. See
[`testing.md`](testing.md) for the script shape.

Two checks exist because a linter can't express them. `scripts/ts/check-shell-set-flags.ts`
enforces the `set -uo pipefail` opener from the global `CLAUDE.md`, which shellcheck
has no rule for. `scripts/ts/check-plugin-structure.ts` is the closest thing to a typechecker a
repo of Markdown and plugin metadata can have: this repo's *product* is declarative metadata, and a
skill whose `name:` drifts from its directory fails silently at load time rather than
loudly in review — which is exactly what the plugin rename could have caused.

The `bats` suites are hermetic: `HOME` is redirected into a sandbox and the network
binaries are shimmed to fail loudly, so a test can never touch your real `~/.claude`
even though `setup.sh`'s whole job is writing symlinks into it. The `pytest` suite
forks real PTYs, with `AGENT_TERM_STATE` redirected per test and every session torn
down in a fixture, so it can't collide with a live session either.

## Plugin evals

Behavioral tests for a skill live in `plugins/<name>/evals/<case>/case.yaml` (or
`prompt.md` + `graders/`) and run with `claude plugin eval plugins/<name> --case <case>`
(Claude Code 2.1.269+). They make real model calls, so they cost money; each case runs
with and without the plugin so `Δ` shows what the skill adds. Results land in
`<plugin>/evals/results/<timestamp>/` (gitignored via `**/evals/results/`). Docs:
[plugin evals](https://code.claude.com/docs/en/plugin-evals); background in
[#387](https://github.com/dfadler/agent-config/issues/387).

This section is the one home for facts shared by every case. A `case.yaml` header holds
only its own run command and why its graders are shaped as they are.

- **Grants.** A case's `allowed_tools` cannot grant `Bash`, `Write`, `Edit`, `WebFetch` or
  `WebSearch`: the run withholds them unless you pass `--allow-tools` (put the target
  first), so a grader that needs one can never pass and a `max: 0` check on it can never
  fail ([#442](https://github.com/dfadler/agent-config/issues/442)). A case that needs a
  grant records its exact command in its header; a case without one needs only `Skill`.
  Add `--ablation with-without` where the header says to. Record the grant in
  `plugins/<name>/evals/grants.yaml` too (format: `plugins/eval-authoring/docs/grants-format.md`);
  `bash scripts/ci.sh lint-plugin-evals` runs the eval-authoring lint over every plugin and CI fails on an
  error finding such as EVAL004, so a case with `Bash` in `allowed_tools` and no recorded grant
  does not merge.
- **Adding a lint rule.** The lint is `plugins/eval-authoring/scripts/ts/lint/`; a rule is
  one file in `rules/` plus good and bad fixtures under `tests/lint-fixtures/`, found by
  auto-discovery with no registry to edit. Steps, the `Rule` interface and the sabotage
  check are in `plugins/eval-authoring/docs/lint-rules.md`; don't copy them here.
  `node plugins/eval-authoring/scripts/ts/lint/cli.ts --list-rules` prints the current set.
- **Repo evals in CI.** `bash scripts/ci.sh lint-plugin-evals` (part of `check`, run by the
  TypeScript workflow) lints every plugin's `evals/` for free. It never runs a paid
  eval; those are run by hand with the `run-evals` wrapper.
- **Grader shape.** Prefer free `regex` graders where a literal string is reliable and
  keep an `llm` grader only for a judgment a regex cannot make; rationale in
  [#411](https://github.com/dfadler/agent-config/issues/411).
- **`skill_fired`.** Positive cases carry a `tool_used` grader on `Skill` with
  `arm: with-only`; negative cases use `min: 0`, `max: 0`, `arm: both`. Copy the block
  from a sibling case and change only the skill name.
- **Sabotage maps.** A header may map each grader to the skill text it checks, so you can
  break that text and confirm the grader fails. Cite a short quoted phrase or the heading
  name, never `SKILL.md` line numbers, which go wrong silently on any edit. Grep the
  phrase in the skill when you write it.
- **Layout.** `fetch-execute-guide` keeps its plugin wrapper (with `SKILL.md` at the
  plugin root) because bare skills have no eval path.
- **gha-ci-audit: two formats on purpose
  ([#412](https://github.com/dfadler/agent-config/issues/412)).**
  `plugins/gha-ci-audit/evals/evals.json` is the separate skill-creator format, which
  `claude plugin eval` does not read. It drives the plugin's own orchestrator, which runs the
  audit against live GitHub data (`gh api`) and grades the published report; a plugin eval
  cannot do that hermetically (no network, and `Bash` is withheld without a recorded grant).
  So the legacy file stays for end-to-end audits, and `evals/<case>/case.yaml` covers only
  what a Skill-only run can check: the trigger boundary (`audit-fires-on-slow-ci`,
  `audit-stays-quiet-on-workflow-authoring`, `audit-stays-quiet-on-failed-run`). Revisit if `claude plugin eval` gains a way
  to mock `gh` without `--scaffold`, or if a recorded-fixture mode is added to the collector
  so a case can feed the scripts canned `runs.json` and `jobs.json`.

## GitHub operations

This repo uses the `gh` CLI for all GitHub operations — issues and PRs, review
comments, CI checks, labels, and repo settings changes like branch protection.
Not the web UI, not raw `curl` against the REST API, not a GitHub MCP
connector. When `gh` has no dedicated subcommand, `gh api` is the escape
hatch — still authenticated and scriptable — rather than dropping to `curl`
with a hand-managed token. Non-obvious ones worth knowing: `gh run view
<run-id> --log-failed` to diagnose a CI failure without opening a browser,
`gh api repos/<owner>/<repo>/pulls/<pr>/comments/<id>/replies` to reply to an
inline review comment, and `gh api -X PUT .../branches/main/protection` for
repo settings that have no `gh` subcommand.
