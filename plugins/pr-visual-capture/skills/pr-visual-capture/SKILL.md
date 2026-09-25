---
name: pr-visual-capture
description: >
  Deprecated. Produces a screenshot (PNG) or walkthrough video (MP4) for a
  PR/issue's visual-verification requirement by sequencing the
  `screen-capture` plugin's `capture` → `compare` → `attach` skills. Kept as
  a working entry point for existing `/pr-visual-capture:pr-visual-capture`
  callers; new work should invoke the `screen-capture` skills directly. See
  `agent-config/plugins/screen-capture`.
license: MIT
deprecated: true
replaced_by: "screen-capture:compare"
replaced_by_docs: "agent-config/plugins/screen-capture"
metadata:
  version: "2.0.0"
---

# PR/issue visual capture (deprecated shim)

**Deprecated.** This skill's capture/compare/attach mechanics moved to the
composable `screen-capture` plugin (`agent-config/plugins/screen-capture`,
tracked in #321). New callers should invoke those skills directly. This
skill stays as a working entry point so existing
`/pr-visual-capture:pr-visual-capture` callers don't break — it just
sequences the three replacement skills instead of documenting the mechanics
itself.

## What to do

Run these three skills in order:

1. **`screen-capture:capture`** — render the before/after (or single)
   variant(s) via the project's own dev server/build output and produce the
   PNG/MP4 file(s) on disk.
2. **`screen-capture:compare`** — diff the before/after captures (isolated
   documents per variant, avoiding shared-page style bleed) and produce the
   before/after comparison to embed in the PR/issue body.
3. **`screen-capture:attach`** — upload the resulting image/video to the
   PR/issue and verify the attachment URL resolves (not a 404) before
   calling it done.

Follow each skill's own instructions for its step — this shim intentionally
holds no capture mechanics of its own anymore, so Chrome/CDP flags, ffmpeg
invocations, and upload-verification steps are owned by those skills, not
duplicated here.

## If `screen-capture` isn't installed yet

`screen-capture` is being built across sibling issues (#322–#326) and may
not exist in this checkout yet. If any of the three skills above aren't
found, tell the user this skill is mid-migration and point them at
`agent-config/plugins/screen-capture` (or issue #321) rather than
improvising capture mechanics here.

## Not covered by this shim

- The responsive/viewport resize pass and Lighthouse CLI pass this skill
  used to run inline now live in `screen-capture:lighthouse` (#326) — invoke
  it separately for a change touching layout, CSS, or responsive behavior.
- Auth handling for a login-gated capture target, and the diagram/SVG
  auto-crop step, aren't named in the three-skill sequence above; confirm
  `screen-capture:capture`/`compare` still cover them once that plugin
  lands, since this shim's job is only to sequence the replacement skills,
  not to re-document their internals.
