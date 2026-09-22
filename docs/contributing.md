# Contributing: adding content, checks, and GitHub operations

## Adding something new

1. Put it in the right place:
   - A **skill** → a new directory under `plugins/dfadler-agent-config/skills/`,
     containing a `SKILL.md`.
   - An **agent** → a new `.md` file under `plugins/dfadler-agent-config/agents/`.
   - A **slash command** → a new `.md` file under `claude/commands/`.
   - A **hook** → an entry in `plugins/dfadler-agent-config/hooks/hooks.json`,
     pointing (via `${CLAUDE_PLUGIN_ROOT}`) at a script under wherever fits — a
     related skill's own `scripts/`, if the hook is that skill's companion. Unlike
     everything else in this list, a hook activates for every project this plugin
     is enabled in the moment it's added — there's no opt-in step on the
     project's side — so it needs to be safe to run unconditionally: no-op
     cleanly (exit 0, no output) whenever its precondition doesn't hold (wrong
     project type, feature not configured, required CLI missing), and never let
     the hook's own failure block a session start. The `git-worktree-usage`
     skill's two `SessionStart` hooks are the reference example.
   - A whole new **plugin** (a set of skills/agents that belong together) → a new
     directory under `plugins/`, with its own `.claude-plugin/plugin.json`, `agents/`,
     and `skills/`. Give it a `PLUGIN_SRC`/`PLUGIN_LINK` pair and a `link` line in
     `setup.sh`, which only knows about `dfadler-agent-config`. Keep the directory name
     and the manifest `name` identical.
2. Name skills and agents plainly — `pr-babysit`, not `dfadler-agent-config-pr-babysit`
   — in both the directory/filename and the frontmatter `name:`. The plugin namespace
   already prevents collisions with a project's own skills, so a prefix here would just
   repeat it. Commands stay unprefixed for a different reason: `claude/commands/` is
   linked entry-by-entry into `~/.claude/commands/`, outside any plugin, so those names
   really are flat.
3. Run `claude plugin validate plugins/dfadler-agent-config` — it checks the manifest
   and parses the frontmatter of every skill and agent inside.
4. Run `make check` (see [Checks](#checks) below) before pushing.
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
      and point at the `dfadler-agent-config:fetch-execute-guide` skill, as the
      `rtk-ai/rtk` entry does; the advisory check must never run it.

### Why skills here don't declare `allowed-tools`

An automated reviewer (SkillSpector, via CodeRabbit on #51) flags every `SKILL.md`
under `plugins/dfadler-agent-config/skills/` for "unrestricted tool access" and
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
- **Narrow skills** (`gh-attach-image`, `pr-visual-capture`) could carry an accurate
  short list, but accuracy for two skills isn't worth an inconsistent, partially-
  fictional convention across the other three.

The real boundary is the one this repo's global `CLAUDE.md` and every session already
operate under: Claude Code's permission rules, hooks, and the active permission mode
enforce tool access, regardless of what any skill's frontmatter claims. `CLAUDE.md`
and skill instructions — including a skill's own `allowed-tools` — are behavioral
guidance the model follows, not an enforcement layer; only `settings.json`
permission rules and hooks actually gate a tool call. A skill-level allowlist that
can't restrict anything would be a paper boundary layered on top of the real one —
worth avoiding on those grounds even before the mechanism question above.

## Checks

`make check` runs everything CI runs, and CI calls these same targets — so a green
run locally means the same thing a green PR does.

```bash
make check          # lint + structure + typecheck + test + actionlint + coverage
```

| Target | What it does |
| --- | --- |
| `make lint-sh` | `shellcheck`, `shfmt -i 2 -ci -d`, and the `set -uo pipefail` convention |
| `make lint-py` | `ruff check` and `ruff format --check` |
| `make typecheck` | `mypy --strict` over the Python sources |
| `make structure` | Plugin manifests and skill/agent frontmatter agree with their directories |
| `make test-sh` | `bats` suites under `scripts/tests/` |
| `make test-py` | `pytest` suite under `scripts/tests/` |
| `make coverage` | Re-runs the `bats` suites under `kcov` and enforces the coverage floor (Linux only) |
| `make fmt` | Rewrites sources to the repo's `shfmt` / `ruff` style |
| `make lint-actions` | `actionlint` over `.github/workflows/` |

```bash
brew install shellcheck shfmt bats-core actionlint
make venv          # Python side: .venv from requirements-dev.txt
```

`make check` uses `.venv` when it exists and otherwise falls back to whatever
`python3` is on `PATH`, so a shell-only change doesn't require building one.

`make coverage` needs `kcov` and `jq` on top of the tools above. It only measures
anything on Linux: kcov instruments bash by injecting a library into the traced
shell, and macOS SIP strips that from `/bin/bash`, so on a Mac the target says so
and skips rather than reporting a meaningless 0%. The floor it enforces is a
measured baseline (see the `coverage` target in the `Makefile` for the number, how
it was taken, and what is and isn't in the denominator) — a regression gate, not a
target to design tests around.

Two checks exist because a linter can't express them. `check-shell-set-flags.sh`
enforces the `set -uo pipefail` opener from the global `CLAUDE.md`, which shellcheck
has no rule for. `check-plugin-structure.sh` is the closest thing to a typechecker a
shell-and-Markdown repo can have: this repo's *product* is declarative metadata, and a
skill whose `name:` drifts from its directory fails silently at load time rather than
loudly in review — which is exactly what the plugin rename could have caused.

The `bats` suites are hermetic: `HOME` is redirected into a sandbox and the network
binaries are shimmed to fail loudly, so a test can never touch your real `~/.claude`
even though `setup.sh`'s whole job is writing symlinks into it. The `pytest` suite
forks real PTYs, with `AGENT_TERM_STATE` redirected per test and every session torn
down in a fixture, so it can't collide with a live session either.

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
