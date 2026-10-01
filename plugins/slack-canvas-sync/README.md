# slack-canvas-sync

Two-way sync between a local markdown directory and Slack canvases, through the
Slack connector. Design and research notes live in
[#416](https://github.com/dfadler/agent-config/issues/416); the work is split
across the issues listed there.

## Status

Scaffold. Today this holds the pure TypeScript logic the skills will call, under
`src/`. Skills (`canvas-push`, `canvas-pull`, `canvas-status`) land in follow-up
issues.

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

## Tests and fixtures

`test/fixtures/` pairs a local source with what `slack_read_canvas` returns for
it, and the tests assert both normalize to the same body. `basic.md` is a
recording from a live canvas (one link made absolute so the repo's relative-link
checker passes); `edits.md` is hand-built from behavior
observed there (h4 clamped to h3, a UI-added paragraph, section anchor links).
Fixtures use dummy content only: no real workspace host, team ID, canvas ID,
user, or channel.

Known assumptions to re-verify against a live canvas (#426): ordered lists are
renumbered from 1, table column alignment is dropped, and the layout/column
read format is unrecorded.

Run with `make test-ts` (needs the Node from `.nvmrc`).
