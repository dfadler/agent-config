# Recommended companion plugins and tools

Standalone installs that pair well with this repo but aren't vendored into
it — each one keeps its own upstream as the source of truth rather than
freezing a copy here that goes stale silently. `setup.sh` never installs any
of these on its own; most get an advisory-only check that reports whether
they're present and prints the install command if not.

## mattpocock/skills

[mattpocock/skills](https://github.com/mattpocock/skills) is a separately maintained
Claude Code plugin (TDD, diagnosing bugs, domain modeling, code review, and more) that
this repo has used as a prior-art reference for idiomatic skill authoring — see issues #15
and #132 for how and why. Nothing from it is vendored into this plugin; it's recommended
as a standalone companion install, kept current by its own maintainer:

```bash
claude plugin install mattpocock-skills
```

It's in Claude Code's official marketplace — confirmed directly against
`anthropics/claude-plugins-official`'s own manifest, not assumed — so there's nothing to
add first, and updates arrive automatically. `setup.sh` doesn't install this: that's
deliberate (#132, option A over B), so this repo's own setup only ever reaches into
content it actually owns.

## dfadler/bulletproof-react-skills

[dfadler/bulletproof-react-skills](https://github.com/dfadler/bulletproof-react-skills)
is a standalone Claude Code plugin — 7 React project-convention skills distilled from
[alan2207/bulletproof-react](https://github.com/alan2207/bulletproof-react)'s
`docs/*.md` (MIT licensed): project structure, state and data fetching, testing,
performance, security, components and styling, and project standards. It used to live
here as `plugins/bulletproof-react-skills/`, but React-specific content riding along in
a plugin every project on this machine loads didn't fit this repo's cross-project scope
(the same reasoning behind reverting the vercel-labs vendoring attempt below, #211), so
it was extracted to its own repo (#226) once its generator/polish blockers (#217, #218)
were done. Same content, same generator, same provenance — now distributed standalone
rather than bundled here:

```bash
claude plugin marketplace add dfadler/bulletproof-react-skills
claude plugin install bulletproof-react-skills
```

Like `anthropics/skills` below, this is **not** in the official marketplace, so it needs
the `marketplace add` step first. `setup.sh` doesn't install this — same reasoning as
`mattpocock-skills` (#132, option A over B) — and has no advisory check for it either:
unlike the other companions in this section, this repo has no ongoing tooling
relationship to it beyond having originated it.

## vercel-labs/agent-skills

[vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) is Vercel
Engineering's own React/Next.js skill collection, MIT licensed. Two of its skills came
up while evaluating third-party React tooling for a refactor: `react-best-practices`
(40+ performance rules) and `composition-patterns` (avoiding boolean-prop
proliferation via compound components and state lifting). Recommended as a standalone
install, same posture as `mattpocock-skills` above — nothing here depends on it, and
nothing from it is vendored into this repo:

```bash
skills add vercel-labs/agent-skills --agent claude-code -g \
  --skill vercel-react-best-practices vercel-composition-patterns
```

This isn't a `claude plugin` at all — Vercel distributes via a separate `skills` CLI
(the `skills` npm package, from the [Agent Skills](https://agentskills.io/) spec /
[skills.sh](https://skills.sh/vercel-labs/agent-skills)), confirmed directly against
`vercel-labs/agent-skills`: it ships no `.claude-plugin/marketplace.json`. Skill names
for `--skill` are each `SKILL.md`'s own `name:` field
(`vercel-react-best-practices`), not its directory name — confirmed against a real
probe install, not assumed from the README. `setup.sh` runs an advisory-only check
(`check_react_skills`) that only fires if the `skills` CLI is already on `PATH` — it
never runs `npx skills@latest` itself, since that would fetch and execute a
third-party package over the network on every `setup.sh` run. The same reasoning
applies to an agent running the `skills add`/`npx skills@latest` command above on the
user's behalf: it's a fetch-and-execute install, not an ordinary dependency change, so
it needs explicit, per-run permission — see the
`dfadler-agent-config:fetch-execute-guide` skill.

An earlier version of this section vendored these two skills into their own plugin
here instead of referencing them — reverted (#211's review) once it turned out `skills
add` *does* support installing individual skills (`--skill <names>`), which was the
premise vendoring was based on. Reference-only is more consistent with this repo's own
#132 precedent: let upstream stay the source of truth with its own update story, rather
than freezing a copy that goes stale silently.

## anthropics/skills (frontend-design)

[anthropics/skills](https://github.com/anthropics/skills) is Anthropic's own example
skills repo. Its `example-skills` plugin includes `frontend-design`, aimed at UI/CSS
output quality — a useful companion to `composition-patterns` above, which covers
component *architecture* rather than visual polish. Recommended as a standalone
install, same posture as `mattpocock-skills` above — nothing here depends on it:

```bash
claude plugin marketplace add anthropics/skills
claude plugin install example-skills
```

Unlike `mattpocock-skills`, this one is **not** in the official marketplace (checked
directly against `anthropics/claude-plugins-official`'s manifest — absent), so it needs
the `marketplace add` step first; updates after that arrive automatically the same way.
`setup.sh` runs an advisory-only check (`check_frontend_design`) and prints the install
command above if it's missing — it doesn't install it.

## Linux administration skill: first-party, not vendored

Issue #214 asked whether this repo should add a skill/agent for Linux system
administration (package management, systemd, users/permissions, SSH/firewall
hardening, log/service triage). A deep-research pass (5 search angles, 21
sources, 82 claims, 25 adversarially verified) found two candidate
third-party bundles:

- [HermeticOrmus/linux-sysadmin-skills](https://github.com/HermeticOrmus/linux-sysadmin-skills) —
  five Debian/Ubuntu-targeted skills (`sysadmin-security`,
  `sysadmin-performance`, `sysadmin-diagnose`, `sysadmin-monitor`,
  `sysadmin-maintain`).
- [billyfranklim1/claude-skills](https://github.com/billyfranklim1/claude-skills) —
  `linux-service-triage` and `sysadmin-toolbox`.

Neither cleared the bar this repo has applied to every other companion
recommendation above (mattpocock/skills, vercel-labs/agent-skills,
anthropics/skills): a maintained, reasonably adopted source with checkable
provenance.

- **HermeticOrmus/linux-sysadmin-skills**: 3 stars, created and last pushed
  the same calendar day, no activity since. The author's ~100-repo history
  is a templated "-skills" bundle churned out across dozens of unrelated
  domains (`auto-docs-skills`, `dx-audit-skills`, `git-workflow-skills`,
  `commit-standard-skills`, `google-docs-drive-toolkit`, …), almost all
  with 0-2 stars — evidence of a generator pattern, not a maintained,
  dogfooded tool.
- **billyfranklim1/claude-skills**: 0 stars, 0 forks.
- Both READMEs claim their skills are "read-first" and "confirm before
  anything destructive runs." Reading the actual `SKILL.md` content
  directly (not just the README) shows this is unenforced prose — a
  checklist plus a one-line "explain the risks first" instruction, no
  `allowed-tools` restriction or scripted confirmation gate. This repo's
  own skills take the same posture (see
  [`docs/contributing.md`](./contributing.md#why-skills-here-dont-declare-allowed-tools))
  but don't market themselves as "safe-by-default" — these READMEs make a
  safety claim their content doesn't back up.
- No first-party (Anthropic or major-vendor) Linux-administration skill
  exists, and no mainstream skill directory treats it as a category.

**Decision: no-go on vendoring either bundle.** Recommending either would
mean pointing users at unvetted, low-adoption, single-author content on the
strength of marketing language in its own README — a materially lower bar
than every other companion in this section. Recorded here so this isn't
re-investigated from scratch by the next issue or session — see #214 for
the full research trail.

Issue #238 followed up by writing this repo's own Linux administration
skill from scratch instead, to the bar the third-party bundles above
failed: `dfadler-agent-config:linux-administration`
(`plugins/dfadler-agent-config/skills/linux-administration/`). It sorts
package management, systemd service management, filesystem operations,
user/permission management, disk partitioning, and firewall/network
configuration into three mechanical tiers (safe / needs-confirmation /
never-autonomous) rather than a prose safety reminder, scopes itself
explicitly to systemd-based distros (Debian/Ubuntu, Fedora/RHEL, Arch), and
requires citing the relevant man page or official docs for any
version-sensitive command-behavior claim. See that skill's `SKILL.md` for
the full model.

## aws/agent-toolkit-for-aws (aws-core)

[Agent Toolkit for AWS](https://github.com/aws/agent-toolkit-for-aws) is AWS's own,
GA-status, Amazon Web Services-authored successor to the older `awslabs/mcp` server
collection and the now-deprecated `aws-dev-toolkit` sample plugin — both surfaced by
an earlier investigation into AWS administration support (#213) and found, on
re-verification, to already be mid-migration to this toolkit. Its `aws-core` plugin
bundles CDK/CloudFormation authoring, core AWS services, and cost/billing tooling
(Cost Explorer, Savings Plans, Compute Optimizer) together with the toolkit's AWS MCP
Server configuration — covering the IaC and cost/FinOps areas #213 asked about in one
install. Recommended as a standalone companion, same posture as `mattpocock-skills`
above — nothing here depends on it, and nothing from it is vendored:

```bash
claude plugin install aws-core@claude-plugins-official
```

It's in Claude Code's official marketplace — confirmed directly against
`anthropics/claude-plugins-official`'s own manifest, the same as `mattpocock-skills`
— so there's nothing to add first, and updates arrive automatically. Live AWS API
calls (deployments, cost queries) need local AWS credentials configured the normal
way (`aws configure`); documentation search and skill guidance work without them.
Credential and permission handling for those live calls is the toolkit's own concern,
not something this repo wraps — the tradeoff of reference-don't-vendor, same as the
other companions in this section. `setup.sh` doesn't install this — same reasoning as
`mattpocock-skills` (#132, option A over B) — but does run an advisory check
(`check_aws_core`).

For the third area #213 asked about, security auditing, the same toolkit ships
`aws-agents-for-devsecops` (vulnerability scanning and an AWS Security Agent for
release-readiness review), also listed directly in the official marketplace:

```bash
claude plugin install aws-agents-for-devsecops@claude-plugins-official
```

Not given its own `setup.sh` check: unlike `aws-core`, it needs a plugin-specific
`/aws-agents-for-devsecops:setup` step before use, so a plain installed/not-installed
check would understate what "ready to use" means for it.

## DietrichGebert/ponytail (lazy-mode decision ladder)

[ponytail](https://github.com/DietrichGebert/ponytail) is a standalone, MIT-licensed
plugin that injects a "write the least code that works" decision ladder (necessity →
existing codebase → stdlib → native platform → existing deps → one-liner → new code)
as a standing instruction, plus `/ponytail-review`, `/ponytail-audit`, and
`/ponytail-debt` commands for advisory over-engineering review. Overlaps in spirit
with this repo's own terse-code conventions but adds the ladder as an explicit,
invokable checklist rather than prose. Recommended as a standalone install, same
posture as `mattpocock-skills` above — nothing here depends on it:

```bash
claude plugin marketplace add DietrichGebert/ponytail
claude plugin install ponytail
```

Not in the official marketplace, so it needs the `marketplace add` step first.
Third-party marketplaces default to auto-update *disabled* (confirmed against
[code.claude.com/docs/en/discover-plugins](https://code.claude.com/docs/en/discover-plugins)
— only official Anthropic and claude.ai-added marketplaces default to enabled), so
pick up updates with `claude plugin marketplace update ponytail`, or enable
auto-update for it via `/plugin` → Marketplaces. `setup.sh` doesn't install this —
same reasoning as `mattpocock-skills` (#132, option A over B).

## rtk-ai/rtk (token compression)

[RTK](https://www.rtk-ai.app/) ([rtk-ai/rtk](https://github.com/rtk-ai/rtk)) is a
standalone Rust CLI, Apache-2.0 licensed, that sits between Claude Code and the shell:
a `PreToolUse` hook rewrites a Bash tool call before it runs (`git status` becomes
`rtk git status`, and likewise for 100+ other git/test/lint/build/infra commands) so
noisy, repetitive output gets filtered, grouped, truncated, and deduplicated before it
ever reaches the model's context — real error messages and failures are preserved.
Per RTK's own docs, the hook only covers Bash tool calls; built-in tools like `Read`,
`Grep`, and `Glob` bypass it entirely. Provenance checked directly against
`rtk-ai/rtk`'s GitHub API (not taken from its marketing page): Apache-2.0 confirmed,
80K+ stars, 5,100+ forks, 30 contributors, and an active multi-times-daily release
cadence as of 2026-09 — worth noting the repo itself is young (created 2026-01), so
that's a lot of adoption in under eight months; nothing here changes because of that,
it's just context for whoever reads this next.

Recommended as a standalone companion, same reference-don't-vendor posture as every
other entry in this section — nothing here depends on it:

```bash
brew install rtk-ai/tap/rtk
```

Prefer the Homebrew tap or a pre-built binary from
[GitHub Releases](https://github.com/rtk-ai/rtk/releases) over RTK's own
`curl | sh` one-liner — piping a remote script into a shell is a fetch-and-execute
install and needs the explicit, per-run permission the
`dfadler-agent-config:fetch-execute-guide` skill describes, the same as any other
`curl | sh`/`npx <pkg>@latest` command. That gate applies whether a human runs it
themselves or asks an agent to.

Installing the binary does not activate anything — that needs a separate
`rtk init --global`, which (per RTK's own docs) modifies shell rc files *and* adds a
`PreToolUse` hook entry to Claude Code's own settings, then requires restarting
Claude Code to take effect. Modifying `.claude/settings.json` hooks is itself a
security-critical action under this repo's own standing rule (see global `CLAUDE.md`'s
GitHub-workflow section on security-critical paths) — so an agent should never run
`rtk init --global` (or the installer above) on the user's behalf without asking
first, the same as it would never silently edit a hooks file for any other reason.
`rtk init --show` previews what the hook would change without applying it, and
`rtk init -g --uninstall` reverts the hook, `RTK.md`, and the settings entries it
added.

`setup.sh` runs an advisory-only check (`check_rtk`) that reports whether the `rtk`
binary is on `PATH` and prints the install command above if it's missing — same
posture as `check_react_skills`: it never runs the installer or `rtk init --global`
itself, since both are exactly the kind of side effect that needs asking first rather
than happening automatically on every `setup.sh` run.
