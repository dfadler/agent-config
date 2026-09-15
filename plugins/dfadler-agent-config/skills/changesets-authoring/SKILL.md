---
name: changesets-authoring
description: |
  How to write a Changesets (`.changeset/*.md`) entry when working in a repo
  managed by the changesets/changesets tool. Covers detecting whether a repo
  actually uses Changesets (`.changeset/config.json` + `@changesets/cli` in
  `package.json`), when a change needs one, the real `.changeset/*.md` file
  format (YAML frontmatter naming affected packages + bump type, followed by
  a changelog-facing summary), how to pick patch/minor/major, why
  hand-writing the file beats trying to drive the interactive `changeset add`
  CLI as an agent, and where the changeset commit belongs relative to the
  code change. Use whenever a fix, feature, or dependency bump lands in a
  repo with a `.changeset/` directory — before opening the PR, not after —
  or when asked to "add a changeset", "bump the package version", or "will
  this show up in the changelog".
license: MIT
metadata:
  version: "1.0.0"
---

# Writing a Changesets entry

[Changesets](https://github.com/changesets/changesets) is a CLI + file
format for capturing "intent to release" at the moment a change is made,
instead of trying to reconstruct it later at release time. A repo that has
adopted it expects **every PR that changes published package behavior** to
carry a `.changeset/*.md` file alongside the code change — without one, that
repo's version-bump and changelog generation silently has nothing to
consume, and the fix or feature never gets released with a changelog entry.

This skill is the mechanics; it does not tell you a given repo uses
Changesets — check first (Step 1).

## Step 1 — detect whether this convention even applies

Don't assume. Most repos don't use Changesets (this repo, `agent-config`,
doesn't; neither does `dfadler.com`, which deliberately adopted
`semver-adopt-neither` — plain git history and no versioned-package
changelog at all — as its own considered choice, not an oversight). Check
both signals before treating any of this skill as applicable:

1. **`.changeset/config.json` exists** at the repo root (or workspace root in
   a monorepo). Its presence is the strongest signal — Changesets writes it
   once via `changeset init` and every subsequent changeset lives in the
   same `.changeset/` directory.
2. **`@changesets/cli` appears in `package.json`'s `devDependencies`** (root
   `package.json` in a monorepo).

If both are true, this convention applies — add a changeset alongside any
qualifying code change. If neither is true, skip this entirely; don't
introduce Changesets into a repo that hasn't opted in. If only one signal is
present (e.g. `.changeset/` exists but the dependency was removed, or vice
versa), treat that as a stale or half-migrated setup and ask rather than
guessing.

## Step 2 — decide whether this change needs one

Add a changeset for anything that changes what a consumer of the published
package(s) experiences:

- A bug fix
- A new feature or capability
- A breaking change
- A dependency bump that changes runtime behavior consumers can observe
  (this was the exact trigger for this skill:
  [dfadler/payload-plugin-mermaid#30](https://github.com/dfadler/payload-plugin-mermaid/issues/30)
  was a dependency bump that still needed a changeset)

Skip it for a change with no externally visible effect: a pure internal
refactor, docs-only, test-only, tooling/CI-only, or a change scoped entirely
to unpublished internal code. The [changesets docs themselves say the
same](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md#not-every-change-requires-a-changeset):
"Since changesets are focused on releases and changelogs, changes to your
repository that don't require these won't need a changeset." Defer to a
given repo's own written convention (e.g. a CONTRIBUTING.md note, or an
existing changeset-bot / CI gate) if it says something more specific than
this general rule.

## Step 3 — the file format

A changeset is one Markdown file with YAML frontmatter, at
`.changeset/<any-unique-slug>.md` (the filename itself is arbitrary — the
CLI generates a random human-readable slug, but any unique name works when
hand-writing one). Source:
[`detailed-explanation.md`](https://github.com/changesets/changesets/blob/main/docs/detailed-explanation.md)
and
[`adding-a-changeset.md`](https://github.com/changesets/changesets/blob/main/docs/adding-a-changeset.md).

Single-package repo, one package bumped:

```md
---
"@myproject/core": patch
---

Fix incorrect line-height calculation in the mermaid parser's label renderer.
```

Monorepo, multiple packages named in one changeset:

```md
---
"@myproject/cli": major
"@myproject/core": minor
---

Change all the things
```

The frontmatter is a flat map of `"<package-name>": <bump-type>` pairs
(quote the package name; it may contain `@scope/` and slashes). Everything
below the closing `---` is plain Markdown and becomes the changelog entry
verbatim — write as much or as little as the change warrants.

**Which package(s) to name in a monorepo:** name every package whose
published output actually changed as a direct result of this diff — not
every package that merely imports it (Changesets' own `version` step
handles bumping a *dependent* package's version separately, via its
`updateInternalDependents` config, so you don't need to hunt down and
manually list every downstream consumer). For `zombie-mermaid`'s
`packages/` layout, that means: if the fix touches only the parser package,
name only that package; if it also required a matching change in a
consuming package's public surface, name both, and each package name gets
its own independently-chosen bump type in the same frontmatter block (a
`patch` fix in one package can sit next to a `minor` addition in another,
in the same file).

## Step 4 — pick the bump type

Changesets defers entirely to [semver](https://semver.org/) semantics — it
doesn't invent its own rules, so use ordinary semver judgment on the
*public* surface of the named package:

- **`patch`** — a bug fix, or any change with no effect on the package's
  public API/behavior contract. The zombie-mermaid parser fix
  ([#1087](https://github.com/dfadler/zombie-mermaid/issues/1087)) is a
  `patch`: it corrects behavior a consumer already relied on being correct,
  without changing the API shape.
  A dependency bump is a `patch` when it only changes internals a consumer
  can't observe.
- **`minor`** — a backward-compatible addition: a new export, a new
  optional parameter, a new feature that doesn't change or remove existing
  behavior.
- **`major`** — a breaking change: removing or renaming a public export,
  changing a function's required signature, changing default behavior in a
  way existing callers would need to adapt to.

When a single change plausibly touches more than one bump level across
multiple named packages, evaluate each package independently — the bump
type describes that package's own public contract, not the change's overall
"size."

If a repo's own docs specify something more specific than plain semver
(pre-1.0 conventions, an internal API carve-out, etc.), follow that instead
— this is the general-case fallback, not an override.

## Step 5 — hand-write the file; don't try to drive `changeset add` interactively

`changeset add` (also invocable as the bare `changeset` command — see
[`command-line-options.md`](https://github.com/changesets/changesets/blob/main/docs/command-line-options.md#add))
is the CLI's normal entry point for a human: it prompts for which
package(s) to bump, then a bump type per package, then a free-text summary,
and finally writes the file after confirmation. That interactive prompt
sequence doesn't fit a non-interactive agent turn — there's no clean way to
answer a multi-step `inquirer`-style prompt through a one-shot tool call.

The CLI does support `changeset add --empty`, but that flag exists for a
different purpose than "let me automate the fields": it produces a changeset
with **empty frontmatter** —

```md
---
---
```

— meant only to satisfy a CI gate that blocks merges without *any*
changeset file present, for a PR that genuinely bumps nothing. It does not
give you a way to pass package names, bump types, or the summary as
non-interactive flags (the only other relevant flag is `--message`/`-m`,
which supplies just the summary text and still leaves the package/bump-type
prompts interactive).

**The practical approach: write the `.changeset/<slug>.md` file directly**,
in the exact format from Step 3, with a filename of your own choosing (any
short, unique, kebab-case slug — it never appears in the changelog output,
only the file's content does). This is explicitly sanctioned by the docs
themselves — the intro guide notes "if you want to write changeset files
yourself, that's also fine" — and produces a byte-identical result to what
the interactive CLI would have written, without the futile prompt-driving
step in between.

## Step 6 — where the changeset entry goes

Changesets' own contributor workflow (from
[`intro-to-using-changesets.md`](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md)
and
[`detailed-explanation.md`](https://github.com/changesets/changesets/blob/main/docs/detailed-explanation.md))
is explicit that adding a changeset is a per-PR contributor action, done
"while the change is fresh in their mind" — i.e. as part of the same PR that
makes the change, not a separate follow-up PR. Within that PR:

- **Same PR: yes, always.** A changeset with no matching code change (or
  vice versa) breaks the "intent to change" model the tool is built around.
- **Same commit vs. a separate commit in the same PR: either is fine.**
  Changesets' own tooling doesn't care how the PR's commits are split — a
  changeset-bot or CI gate checks only for the file's presence in the diff
  against the PR's base, not which commit introduced it. Adding it as part
  of the same commit as the code change is simplest and keeps the "why" and
  "what" together in one place; a separate trailing commit in the same PR
  (e.g. "add changeset") works equally well if that fits the repo's commit
  style better.
- **Multiple changesets in one PR are fine** — the docs call this out
  explicitly ("you want to release multiple packages with different
  changelog entries" or "you have made multiple changes to a package that
  should each be called out separately"). Don't feel compelled to force
  everything into a single frontmatter block if the PR genuinely bundles
  distinguishable changes.
- This repo (`agent-config`) has no Changesets convention of its own to
  defer to — it doesn't use the tool (Step 1 above always fails for it) — so
  the ordering rule above is drawn entirely from upstream Changesets
  workflow guidance, not any local override.

## Quick checklist

1. Confirm `.changeset/config.json` + `@changesets/cli` in `devDependencies`
   — otherwise, skip.
2. Confirm the change is user-facing (bug fix / feature / breaking change /
   observable dependency bump) — otherwise, skip.
3. Pick every package whose public surface actually changed.
4. Pick a bump type per package using semver semantics.
5. Hand-write `.changeset/<slug>.md`: frontmatter block, blank line, then an
   imperative, changelog-facing summary describing the effect of the change
   — not a narration of the diff or internal implementation details (same
   spirit as this repo's `humanizer` skill's diff-anchored-writing rule,
   applied to changelog prose).
6. Commit it alongside the code change, in the same PR (same commit or a
   trailing one — either is fine).
