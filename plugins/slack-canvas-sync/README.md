# slack-canvas-sync

Two-way sync between a local markdown directory and Slack canvases, through the
Slack connector. Design and research notes live in
[#416](https://github.com/dfadler/agent-config/issues/416); the work is split
across the issues listed there.

## Status

Working: the TypeScript logic under `src/`, and the `canvas-push` and `canvas-pull`
skills that drive it, `canvas-status` and pending-deletion tracking, and generated
navigation blocks. Still to come: a live verification pass (#426).

## Skills

- **`canvas-push`**: creates canvases for new files and sends local edits to synced
  ones, section by section. Dry run first; nothing is written to Slack until you
  confirm. Stops on conflicts.
- **`canvas-pull`**: brings canvas-only changes into the local files, keeping
  unsent local edits and each file's frontmatter. On a conflict it saves the
  canvas's version under `.canvas-sync/conflicts/` and writes nothing else.

- **`canvas-status`**: local sync state at a glance, plus the **pending manual
  deletion** list. The connector cannot delete canvases, so anything the sync leaves
  behind (a removed file's canvas, a replaced canvas, a `[agent-sync-scratch]` test
  canvas) is listed with its link and Slack's delete steps until you clear it. It
  also warns if `.canvas-sync/` state or `*.remote.md` copies are tracked by git.
  Clearing happens only on your say-so or when a read shows the canvas is gone;
  nothing is ever deleted for you.

`canvas-push` and `canvas-pull` are user-invoked only (`disable-model-invocation`).
All three skills use only the Slack connector's canvas tools and never delete
anything. They need the sync root (`CANVAS_SYNC_ROOT` or an argument) and Node
22.18+ (see `.nvmrc`).

## Navigation blocks

Slack canvases are flat, so the folder tree is turned into a hierarchy with a
generated callout at the top of each canvas (first line `:compass: **Navigation**`):

- a **breadcrumb** of parent canvases (`Home > Projects > Alpha`),
- a **Children** list, and
- a **Related** list from the file's `related:` frontmatter (paths relative to the
  file, e.g. `related: [beta.md, ../notes.md]`).

A folder's canvas is its `index.md`; a file's parent is the nearest `index.md` in its
folder or above. A lone note with no parent, children, or related links gets no
block. Links are whole-canvas links, never section anchors (those embed section IDs
that may not last).

The block is derived, so it is never stored in a file: pull strips it, push
regenerates it. It is compared by hash against what was last written and last read
back, so how Slack stores it can never cause endless rewrites, and an edit made
inside it in Slack is detected and reported before being overwritten. Creating a
tree takes two passes: create the canvases, then update them so every link has a
target (see the `canvas-push` skill). Not implemented: a backlinks section.

## Sync root layout

One dedicated directory. Each `.md` file is one canvas; its title is the
frontmatter `title:`, else a leading `# Heading`, else the file name. Files with
`canvas_sync: false` in frontmatter are skipped. State lives in
`<root>/.canvas-sync/` (manifest and conflict copies), which holds a `.gitignore`
that ignores everything in it, so canvas IDs never reach git.

## `src/normalize.ts`

Turns local markdown and `slack_read_canvas` output into one canonical form so
they can be hashed and diffed. Slack rewrites markdown on read (`-` bullets
become `*`, blank lines appear after headings, table spacing changes, h4+
headings become h3), so comparing raw text would report false changes.

- `normalizeLocal(markdown)` strips frontmatter, takes a leading `# Title` as the
  canvas title, and normalizes the rest.
- `normalizeRemote(markdown)` takes the first line of a canvas read as the title.
- Both strip the generated navigation block (see `NAV_BLOCK_HEADER`) so it never
  causes a diff.

## `src/validate.ts`

`validate(markdown)` reports content Slack would reject or alter, instead of
silently mangling it: headings or code blocks inside list items, mixed list
nesting, tables over 300 cells, content over 1 MiB, and tables or callouts inside
layouts. h4+ headings are reported as warnings because Slack clamps them to h3.

## `src/diff3.ts`, `src/plan.ts`, `src/manifest.ts`

The three-way sync engine. For one file it compares **base** (what the last sync
recorded), **local**, and **remote** (the canvas now), section by section:

- `diff3` matches sections by content hash and position (never by Slack section
  ID) and splits the result into chunks: `same`, `push` (only local changed),
  `pull` (only the canvas changed), `converged` (both changed identically), or
  `conflict`. Edits to different sections never conflict.
- `planFile` / `applyPlan` turn that into canvas edits (`replace`, `delete`,
  `insert_after`, `rename`, addressed by index into the canvas as read, so they
  apply against one snapshot), the new local content, and conflicts. Conflicts
  are reported, never resolved, and nothing is applied for them.
- The manifest records hashes only, never content. Canvas IDs and the workspace
  host live there, in a gitignored local file. `parseManifest` validates
  untrusted JSON; `writeManifest` is stable and diff-friendly. It also holds the
  `pending_manual_deletion` list (tracking behavior lands in the status skill).

Pulling rewrites the local file in normalized form, so formatting the user chose
(for example `-` bullets) is replaced by the canonical form on a pull.

## `src/cli.ts` / `src/bin.ts`

JSON in, JSON out, so skills call this instead of reimplementing it:

```bash
node plugins/slack-canvas-sync/src/bin.ts normalize --side local < note.md
node plugins/slack-canvas-sync/src/bin.ts validate < note.md
node plugins/slack-canvas-sync/src/bin.ts plan < plan-input.json
```

The skills use the sync-root commands (`scan`, `plan-push`, `record`, `pull`,
`fingerprint`); `--help` lists them. `src/sync-fs.ts` rejects any path that is
absolute, contains `..`, is not a `.md` file, or would write through a symlink out
of the root.

Needs the Node from `.nvmrc`. Exit codes: 0 ok, 1 the check found a problem
(validation errors, bad input shape), 2 usage error.

## Tests and fixtures

`test/fixtures/` pairs a local source with what `slack_read_canvas` returns for
it, and the tests assert both normalize to the same body. `basic.md` is a
recording from a live canvas (one link made absolute so the repo's relative-link
checker passes); `edits.md` is hand-built from behavior
observed there (h4 clamped to h3, a UI-added paragraph, section anchor links).
Fixtures use dummy content only: no real workspace host, team ID, canvas ID,
user, or channel.

`test/fake-canvas.ts` is an in-memory canvas (read, atomic section edits, and
UI-style edits) used to drive end-to-end sync scenarios and a seeded fuzz test
that checks both sides converge. No network.

`mention.md` is a recording from a live canvas: Slack accepts `![](@U…)` but reads
it back as `<@U…>`, so the normalizer rewrites both sides to the canvas form.

Verified against a live Pro workspace (#426), details in the issue:

- Section IDs (`temp:C:…`) were unchanged on every read of a canvas over the whole
  working session, including UI edits and `replace`/`append` (replace keeps the ID).
- Several `append` edits to one section in a single call land in **reverse** order;
  one `append` with several blocks keeps their order. This is why inserts are merged
  into one edit per anchor.
- A canvas link inside a callout reads back as a plain link (no unfurl rewriting);
  `[` `]` escaped in link text come back unescaped; a single line break inside a
  paragraph comes back as a space, so the breadcrumb is its own paragraph. None of it
  causes churn, because the navigation block is compared by hash.
- Column layouts round-trip as one section; ordered lists and tables are stored as
  sent (the normalizer already renumbers lists and drops table alignment before
  sending).

- Comment threads: a comment added in the Slack UI is reported by `slack_read_canvas`
  as `comment_threads`. The thread stays listed, unchanged, after its section is
  replaced and after the section is deleted. But a thread's `section_id` is never one
  of the IDs in `section_id_mapping`, so a comment cannot be matched to a section and
  the sync cannot warn per section. It can only tell that the canvas has open
  threads.

- Deleted canvases: after a canvas is deleted in Slack, `slack_read_canvas` **still
  returns its content** (Slack allows restoring a deleted canvas for 24 hours), but
  `slack_update_canvas` fails with `file_not_found`; reading an ID that never existed
  fails with `file_not_found` too. A push to a deleted canvas therefore fails loudly,
  and `canvas-status` detects a deleted canvas with a no-op title write rather than
  a read.

Not verified live: whether a comment still shows attached in the Slack UI after its
section is replaced or deleted, whether a read starts failing once Slack purges a
deleted canvas, and rate limits on a large first sync (docs only: create is Tier 2,
update Tier 3).

Run with `make test-ts` (needs the Node from `.nvmrc`).
