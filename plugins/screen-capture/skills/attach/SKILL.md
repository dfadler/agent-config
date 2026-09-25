---
name: attach
description: |
  Attach already-captured screenshot/video artefacts (e.g. from
  pr-visual-capture) to a destination, routed by a `--target` flag. This
  skill owns destination-specific formatting — for `--target=github` (the
  only implemented target), that means the before/after PR comment table and
  video embed — and delegates the raw upload mechanics to
  `gh-attach-image:gh-attach-image`. Use this whenever a task needs captured
  visual artefacts posted somewhere, rather than re-deriving the comment
  layout or the upload call by hand each time.
license: MIT
metadata:
  version: "0.1.0"
---

# Attach captured artefacts

Thin routing layer over target-specific upload skills. It does two things:

1. Picks the destination from `--target`.
2. Owns the comment/body formatting for that destination — the upload
   mechanics themselves live in the delegated skill, not here.

## Usage

```
attach --target=<target> --repo OWNER/NAME --pr N \
  --before before.png --after after.png \
  [--video walkthrough.mp4] \
  [--caption "what to look for"] \
  [--comment]
```

- `--target` (required): which destination to route to. See "Targets" below.
- `--repo`, `--pr` (or `--issue`): the GitHub repo and PR/issue number to post to.
- `--before` / `--after`: local image file paths for a before/after
  comparison. Either may be omitted for a single-image or video-only post.
- `--video`: local video file path (`.mp4`/`.mov`/`.webm`) for a walkthrough
  embed, in addition to or instead of before/after stills.
- `--caption`: one-line description of what the reviewer should look for.
  Required when posting a before/after table (see format below).
- `--comment`: post as a new PR/issue comment instead of editing the body
  (same semantics as `gh-attach-image`'s own `--comment` flag).

## Targets

The `--target` value selects a section below. Each target section is
self-contained: it says what it delegates to and what it formats. Unknown or
not-yet-implemented values (e.g. `jira`) must fail with a clear "target not
supported yet" error naming the tracking issue, not fall through to `github`
or silently no-op.

### `--target=github` (v1 — implemented)

1. **Upload.** Delegate the raw file upload to
   `gh-attach-image:gh-attach-image` (its `scripts/upload.sh`) — this skill
   never re-derives the `uploads.github.com` call itself. Upload every
   supplied file (`--before`, `--after`, `--video`) in one `upload.sh`
   invocation so the returned URLs are ready before formatting.
2. **Format.** Build the PR/issue body section from the returned URLs:

   ```markdown
   ## Visual verification

   | Before | After |
   | --- | --- |
   | `![before](<before-url>)` | `![after](<after-url>)` |

   <caption text>

   <video-url, on its own line, if --video was supplied>
   ```

   - Omit whichever column has no corresponding file (e.g. `--after` only →
     a single-column table, or drop the table entirely and use the plain
     `![after](<url>)` line if there's no before to compare against).
   - The video URL goes on its own line, unwrapped — per
     `gh-attach-image`'s own note, wrapping a video URL in `![alt](url)`
     markdown renders a broken-image icon instead of the inline player.
   - `<caption text>` is `--caption` verbatim, one line, no extra prose.
3. **Post.** Save the formatted section the same way `gh-attach-image`
   documents: `gh pr edit --body-file` / `gh issue edit --body-file` (default),
   or `gh pr comment` / `gh issue comment` (`--comment`). This is also what
   "claims" the uploaded assets — see `gh-attach-image:gh-attach-image`'s
   SKILL.md for why an unsaved upload URL 404s.
4. **Verify.** `curl -sI -L <url>` each attached URL and confirm `200`, not
   `404`, after saving — same verification step `gh-attach-image` and
   `pr-visual-capture` both call out.

### `--target=jira` (not implemented)

Tracked separately, out of scope for this skill's v1. Do not implement here —
fail closed with a "target not supported yet" error rather than guessing at
Jira's attachment API.

## Adding a new target

Add a new `### --target=<name>` section above describing what it delegates
to for the raw upload/post and what it formats, plus a branch for that value
wherever this skill's routing is invoked. This never means renaming this
skill, changing the `--target` flag's shape, or breaking an existing
caller's `--target=github` invocation — routing is additive only.
