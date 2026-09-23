---
name: gh-attach-image
description: |
  Upload local image or video files (screenshots, rendered diagrams,
  before/after comparisons, walkthrough recordings) so they render inline in
  a GitHub PR description, issue description, or PR/issue comment — without
  committing the files to the repo and without a browser session. Use this
  whenever a task calls for attaching, embedding, or including a
  screenshot/image/diagram/video in a GitHub PR or issue via `gh`, or when
  asked to "show" or "visually verify" a change and the result needs to land
  in a PR/issue body. Also use this if you're about to commit screenshot or
  video files into a repo just so they can be referenced by a
  raw.githubusercontent.com URL in a PR description, or about to create a
  gist for the same purpose — this skill is the correct, lighter-weight
  alternative to both of those workarounds.
license: MIT
metadata:
  version: "1.1.0"
---

# Attaching images to GitHub PRs/issues via `gh`

## The problem this solves

The official `gh` CLI has no flag for attaching images to a PR or issue body
(`gh pr create --image` doesn't exist — it's an open, unimplemented feature
request: [cli/cli#12960](https://github.com/cli/cli/issues/12960),
[cli/cli#12788](https://github.com/cli/cli/discussions/12788)). Without
this skill, the natural-seeming fallbacks are all worse:

- **Committing the image to the repo** and linking its `raw.githubusercontent.com`
  URL — pollutes repo history with binary files that have nothing to do
  with the actual change, and doesn't work at all for private repos unless
  the viewer already has read access via git (still doesn't work for
  `raw.githubusercontent.com` on a private repo without a token in the URL).
- **Creating a Gist** — works, but publishes the images to an external,
  separately-managed resource for what should be a self-contained PR.
- **Driving a real browser to paste/drag-drop the image** — the actual
  mechanism GitHub's web UI uses, but it needs a real authenticated browser
  session; a computer-use-style browser tool that only clicks/types on page
  elements can't feed it real local file data.

GitHub's actual drag-and-drop upload hits an internal endpoint that turns
out to accept a plain bearer token — no browser, no cookies, no session.
That's what this skill uses.

## Quick path: use the bundled script

`${CLAUDE_SKILL_DIR}/scripts/upload.sh` implements the whole flow. Prefer it
over reconstructing the curl calls by hand — it already handles content-type
detection, URL encoding, and the two usage patterns below.

```bash
# Default: upload and print markdown lines — use this when the images need
# to go in a specific spot in a hand-crafted body (a table, a particular
# section) rather than a simple append.
${CLAUDE_SKILL_DIR}/scripts/upload.sh --repo OWNER/NAME before.png after.png
# -> ![before](https://github.com/user-attachments/assets/<uuid>)
#    ![after](https://github.com/user-attachments/assets/<uuid>)

# Convenience: upload AND append to an existing PR/issue body under a heading
${CLAUDE_SKILL_DIR}/scripts/upload.sh --repo OWNER/NAME --pr 42 screenshot.png

# Or post as a new comment instead of editing the body
${CLAUDE_SKILL_DIR}/scripts/upload.sh --repo OWNER/NAME --issue 7 --comment diagram.png
```

Run `${CLAUDE_SKILL_DIR}/scripts/upload.sh` with no arguments (or read the
top of the file) for the full flag list — it also documents itself inline.

If the default mode is used (no `--pr`/`--issue`), the script prints the
markdown lines and stops — you're then responsible for placing them into
the body (e.g. building a full body file with `Write`, then
`gh pr edit N --repo OWNER/NAME --body-file file.md`) and saving it. See the
gotcha below for why the save step isn't optional.

**Video works too** — `.mp4`, `.mov`, and `.webm` are all recognized
alongside the image extensions. For video the script prints a bare URL
instead of `![alt](url)`, since that's what GitHub needs to render an
inline `<video>` player (image markdown around a video URL shows a
broken-image icon instead).

## The mechanics, if you need to do this by hand

```bash
TOKEN="$(gh auth token)"
REPO_ID="$(gh api repos/OWNER/NAME --jq .id)"

curl -s "https://uploads.github.com/user-attachments/assets?name=<filename>&content_type=<mime-type>&repository_id=${REPO_ID}" \
  -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Accept: application/json" \
  --data-binary "@<local-file-path>"
# -> {"url":"https://github.com/user-attachments/assets/<uuid>"}
```

`content_type` is a standard MIME type: `image/png`, `image/jpeg`,
`image/gif`, `image/webp`, `image/svg+xml`, `image/apng` for images, or
`video/mp4`, `video/quicktime`, `video/webm` for video. Match it to the
actual file — verified working for PNG and MP4; the others follow the same
upload path GitHub's own UI uses so there's no reason to expect them to
differ. For video, put the returned URL on its own line in the body rather
than wrapping it in `![alt](url)` — see the "Quick path" section above.

## The one gotcha that looks like a bug but isn't

**The returned URL 404s immediately after upload.** This is not a failure —
it's the same behavior as GitHub's own drag-and-drop: the asset is only
"claimed" once something references its URL inside a PR/issue/comment body
that actually gets *saved*. Upload alone leaves it in limbo.

The fix is always the same: make sure the markdown line
(`![alt](that url)`) ends up inside a body you save via
`gh pr edit --body-file`, `gh issue edit --body-file`, `gh pr comment`, or
`gh issue comment` — then the URL starts resolving (302 → signed S3 URL →
the actual image). Don't re-upload or try a different endpoint if the first
check 404s; save the body first, then check again.

If you want to confirm it worked, don't just check for a 404 going away —
follow the redirect and confirm the content type matches what you sent:

```bash
curl -sI -L "<the url>" | grep -i content-type
```

## What NOT to do

Don't fall back to committing the images to the repo or creating a Gist
"just to be safe" if this upload flow seems to fail — the 404-before-save
behavior above is the most likely reason it looks broken, not an actual
failure. If `gh auth token` errors, that means the caller isn't logged in
(`gh auth login`) — don't paper over it by switching to a workaround;
surface the actual error so it gets fixed at the source.

## Testing note

This was empirically verified (curl request/response shape, the
upload-then-404-until-claimed behavior, and the final resolved image
content-type) against a real GitHub repo in August 2026. The endpoint is
undocumented and internal to GitHub, so if it stops working entirely
(not just the claim-behavior gotcha above), that's a sign GitHub changed
something — fall back to telling the user to attach the image manually in
the GitHub web UI rather than guessing at a new endpoint shape.
