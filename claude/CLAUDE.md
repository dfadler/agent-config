# Global instructions

Conventions and habits that apply across projects, not just one repo. Project-level
`CLAUDE.md` files hold repo-specific mechanics (exact scripts, doc paths, lint-rule
names, label taxonomies); this file holds the general principle behind them so it
doesn't need to be re-written per project.

## Visual verification on PRs/issues that change rendered output

When a change (PR or issue) alters what gets visually rendered — UI components, generated images/diagrams, styled documents, anything a human would look at rather than just read as code — provide before/after screenshots in the PR or issue description, not just a prose description of the change. Skip this for changes that don't affect rendered output: backend logic, config, migrations, scripts, tests, types, docs, tooling.

Do this proactively, without waiting to be asked — treat it as part of finishing the PR, the same way running the test suite is.

### How

1. Render the same input on the base branch ("before") and the change branch ("after"). Reuse whatever the project's own rendering path is (its actual render function/build step/dev server) rather than reimplementing rendering logic — the goal is to prove what a real user would actually see.
2. Convert to PNG if the native output isn't already a raster image (e.g. `qlmanage -t -s 1000 -o <dir> <file.svg>` on macOS is a fast, dependency-free way to rasterize SVG/HTML).
3. Crop to content before uploading. A raw screenshot/thumbnail — especially `qlmanage`, which pads to a square canvas — is often mostly whitespace around a small diagram, and posting it as-is produces a before/after that's technically correct but too small to actually read once GitHub scales it to fit a PR description. Auto-crop to the non-background bounding box with a small margin rather than guessing crop coordinates by hand (hand-guessed offsets from the SVG's own viewBox math are unreliable, since the thumbnailer's own padding/centering behavior isn't part of that math):
   ```python
   from PIL import Image, ImageChops
   img = Image.open(path_in).convert("RGB")
   bg = Image.new("RGB", img.size, (255, 255, 255))
   bbox = ImageChops.difference(img, bg).getbbox()
   pad = 20
   img.crop((max(0, bbox[0]-pad), max(0, bbox[1]-pad), min(img.width, bbox[2]+pad), min(img.height, bbox[3]+pad))).save(path_out)
   ```
   Look at the actual cropped result before uploading — don't assume the crop worked.
4. Upload both images and embed them via the `gh-attach-image` skill (`~/.agents/skills/gh-attach-image/`) — never commit screenshots to the repo and never use a Gist for this; the skill uses GitHub's own attachment upload endpoint, which needs neither.
5. Add a "Visual verification" section to the PR/issue body with a two-column before/after markdown table, plus a one-line caption saying what to look for.
6. Verify the images actually resolve after saving the body (`curl -sI -L <url>` should return 200, not 404 — see the skill for why a fresh upload 404s until claimed).

### Getting an honest before/after, not a false negative

Don't trust a single rendering technique blindly, especially for anything involving CSS custom properties, inherited styles, or embedded/host-page context:

- If a fix's effect only manifests when the rendered output is embedded in a specific host context (e.g. a CSS variable that's only meaningful when a parent page defines it), build that host context rather than screenshotting the artifact in isolation — an isolated screenshot of both branches can look identical even when the fix is real, simply because the thing being tested never gets exercised in isolation.
- When comparing two rendered variants, put them in **separate, isolated documents** rather than side-by-side in one shared page if either one embeds its own `<style>` block — inline `<style>` tags (including inside inline SVG) apply document-wide by default, not scoped to their containing element, so two variants sharing one page can silently cross-contaminate each other's styling and produce a false negative (both look like whichever rule won the cascade, not what each actually specifies). This happened once already: two SVGs side-by-side both rendered with the "after" variant's font because its `<style>` rule won the cascade tie-break for the whole document, masking a real, verified difference.
- Where possible, verify programmatically in addition to the screenshot: grep the raw output for expected content/attributes, or (for a real browser context) `getComputedStyle(...)` on the actual rendered element — don't rely on eyeballing pixels alone, especially for subtle differences (font family, color, small text). If a quick renderer (e.g. a Quick Look thumbnail) and a real browser disagree, trust the real browser and say so — some lightweight renderers don't fully implement CSS semantics.

## TypeScript: avoid type assertions

Don't reach for a type assertion — `as Foo`, `as unknown as Foo`, `as any`, or the
non-null `!` operator — to make types line up. An assertion silences the compiler
instead of proving the claim, so a wrong one becomes a runtime bug the types said
couldn't happen. Never use `as any`. Prefer, in order: **narrow** with a type guard,
**validate** at the boundary (a schema/parse), **fix the source** type or generic.
`as const` is always fine.

If a project enables `@typescript-eslint/consistent-type-assertions` and
`no-non-null-assertion`, treat a genuinely unavoidable assertion the same way: a
single-line disable directly above it with a comment stating why it's sound and why
no type-safe path exists — never a bare disable, and never at file/block scope. A
project with its own fix-ladder doc (narrow → validate → fix-source, with concrete
examples) takes precedence over this generic version.

## JS/TS: comment syntax

Pick the comment form by what the comment is doing, not by habit:

- **`//`** — standalone single-line comments; the default for ordinary one-liners.
- **`/* … */` inline** — a note embedded *within* a line that runs, so the code
  continues after it: `document.querySelector(/* nullable */ '.card')`, `fn(a, /* retries */ 3, cb)`.
- **`/* … */` multi-line (starred block)** — a standalone note spanning multiple lines
  that is *not* documenting the declaration it precedes (a rationale, module overview,
  workaround explanation): aligned leading `*` on each line, never a stack of `//` lines:

  ```ts
  /*
   * Colons/dots aren't filesystem- or URL-friendly; a flattened ISO timestamp
   * stays human-readable and lexically sortable.
   */
  ```

- **`/** … */` JSDoc** — a multi-line comment that documents the function, type, or
  export it directly precedes:

  ```ts
  /**
   * Converts Markdown into the target rich-text shape.
   * Fences must be triple-backtick at the start of the line.
   */
  function markdownToPost(md: string) { /* … */ }
  ```

The "no stacked `//`" half is mechanically checkable via
`@stylistic/multiline-comment-style` if a project's ESLint config enables it — that
rule can't tell starred block from JSDoc apart, so which multi-line form fits stays a
judgment call either way.

## Shell scripts: hygiene baseline

For any non-trivial bash script:

- Every script's first real statement should be `set -uo pipefail` (or
  `set -euo pipefail`). A file with no shebang (sourced-only) is exempt.
- Run it through shellcheck (correctness) and shfmt (formatting) before considering
  it done, if the project has those set up.
- A shellcheck disable needs a justification at the same bar as a TypeScript type
  assertion: a comment on the line above explaining why it's sound, directly above the
  bare `# shellcheck disable=SCxxxx` directive — never a bare disable.
- Keep script tests hermetic — no network, never a real/production system. Shim
  external commands (`gh`, `curl`, `git` against a throwaway repo, etc.) via `PATH`
  rather than letting a test touch the real thing.

## GitHub workflow habits

- Prefer GitHub Issues/PRs as the tracker when a project uses GitHub — don't route
  around it into a different tracker (Linear, Jira, ad-hoc docs) even if a connector
  for one is attached to the session, unless the project's own docs say otherwise.
- Use the `gh` CLI for GitHub operations (open/list/view issues and PRs, check CI)
  rather than the web UI, raw REST calls, or a GitHub MCP connector.
- Always label an issue you create — at minimum whatever the project's own label
  set supports; check `gh label list` rather than guessing, and create a label first
  if nothing fits rather than leaving the issue bare.
- After opening a PR, the task isn't done — once CI has had a few minutes to produce
  signal, check its status (`gh pr checks`) and any early review comments
  (`gh pr view --comments`), and act on what's actionable before ending the turn.
  Some projects have a dedicated skill/script for this shepherding pass; use it if
  present, otherwise do the check manually.
- When a change addresses a PR review comment (bot or human), reply to that specific
  comment rather than pushing silently — say what changed, or push back with why not.
  Inline/review comment:
  `gh api repos/<owner>/<repo>/pulls/<pr>/comments/<comment-id>/replies -f body="<reply>"`.
  General PR-level comment: `gh pr comment <pr> --body "<reply>"`.
