# slack-canvas-sync

Two-way sync between a local markdown directory and Slack canvases, through the
Slack connector. Design and research notes live in
[#416](https://github.com/dfadler/agent-config/issues/416); the work is split
across the issues listed there.

## Status

Scaffold. Today this holds the pure TypeScript logic the skills will call, under
`scripts/ts/`. Skills (`canvas-push`, `canvas-pull`, `canvas-status`) land in follow-up
issues.

## `scripts/ts/normalize.ts`

Turns local markdown and `slack_read_canvas` output into one canonical form so
they can be hashed and diffed. Slack rewrites markdown on read (`-` bullets
become `*`, blank lines appear after headings, table spacing changes, h4+
headings become h3), so comparing raw text would report false changes.

- `normalizeLocal(markdown)` strips frontmatter, takes a leading `# Title` as the
  canvas title, and normalizes the rest.
- `normalizeRemote(markdown)` takes the first line of a canvas read as the title.
- Both strip the generated navigation block (see `NAV_BLOCK_HEADER`) so it never
  causes a diff.

## `scripts/ts/validate.ts`

`validate(markdown)` reports content Slack would reject or alter, instead of
silently mangling it: headings or code blocks inside list items, mixed list
nesting, tables over 300 cells, content over 1 MiB, and tables or callouts inside
layouts. h4+ headings are reported as warnings because Slack clamps them to h3.

## `scripts/ts/diff3.ts`, `plan.ts`, `manifest.ts`

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

## `scripts/ts/cli.ts` / `bin.ts`

JSON in, JSON out, so skills call this instead of reimplementing it:

```bash
node plugins/slack-canvas-sync/scripts/ts/bin.ts normalize --side local < note.md
node plugins/slack-canvas-sync/scripts/ts/bin.ts validate < note.md
node plugins/slack-canvas-sync/scripts/ts/bin.ts plan < plan-input.json
```

Needs the Node from `.nvmrc`. Exit codes: 0 ok, 1 the check found a problem
(validation errors, bad input shape), 2 usage error.

## Tests and fixtures

`scripts/ts/fixtures/` pairs a local source with what `slack_read_canvas` returns for
it, and the tests assert both normalize to the same body. `basic.md` is a
recording from a live canvas (one link made absolute so the repo's relative-link
checker passes); `edits.md` is hand-built from behavior
observed there (h4 clamped to h3, a UI-added paragraph, section anchor links).
Fixtures use dummy content only: no real workspace host, team ID, canvas ID,
user, or channel.

`scripts/ts/fake-canvas.ts` is an in-memory canvas (read, atomic section edits, and
UI-style edits) used to drive end-to-end sync scenarios and a seeded fuzz test
that checks both sides converge. No network.

Known assumptions to re-verify against a live canvas (#426): ordered lists are
renumbered from 1, table column alignment is dropped, and the layout/column
read format is unrecorded.

Run with `make test-ts` (needs the Node from `.nvmrc`).
