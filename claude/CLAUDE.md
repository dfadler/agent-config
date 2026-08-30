# Global instructions

Conventions and habits that apply across projects, not just one repo. Project-level
`CLAUDE.md` files hold repo-specific mechanics (exact scripts, doc paths, lint-rule
names, label taxonomies); this file holds the general principle behind them so it
doesn't need to be re-written per project.

## Isolation: use git worktrees for non-trivial work

When a repo can have more than one Claude Code session running against it at once —
or even solo, to keep the main checkout clean and easy to reason about — use a **git
worktree** for anything beyond a one-line edit: new features, multi-file changes,
background or parallel tasks. Never commit directly to the main working copy.

- **Create worktrees with the `EnterWorktree` tool, never raw `git worktree add`.**
  The tool applies whatever worktree conventions the repo has configured
  automatically — path/branch naming, locking (so a worktree in active use can't be
  collided into by another session), and any `worktree.symlinkDirectories` set in
  `.claude/settings.json` (e.g. a heavy `node_modules`/`vendor` directory), so a new
  worktree doesn't need its own copy. Raw `git worktree add` bypasses all of that —
  the tool exists because that bypass was a recurring source of pain: untracked
  directories re-copied by hand, and worktrees created outside the convention that a
  repo's own pruning tooling then can't find.
- **A subagent whose cwd was pinned at launch can't call `EnterWorktree` itself** —
  creating a worktree from inside one would mutate the parent session's process-wide
  working directory, and switching to an *existing* worktree by path fails too unless
  the subagent's own cwd already happens to be inside a worktree. Reproduced directly:
  `EnterWorktree cannot create a worktree from a subagent with a cwd override
  (isolation: "worktree" or explicit cwd) — it would mutate the parent session's
  process-wide working directory. To work in a different directory (including a
  worktree), spawn an Agent with cwd set to it.` So decide isolation at spawn time,
  not mid-task: pass `isolation: "worktree"` on the `Agent`-tool call (or the
  equivalent field in a persistent custom subagent's frontmatter) rather than having
  the subagent call `EnterWorktree` itself once it's already running — that's exactly
  the gap that pushes a subagent toward the raw-`git worktree add` fallback the bullet
  above warns against.
- **Glance at `git worktree list` periodically.** A worktree created via that raw-git
  fallback — including one a subagent was forced into before the point above applied —
  sits outside `EnterWorktree`'s bookkeeping, so it also sits outside Claude Code's
  automatic stale-worktree sweep, regardless of age (see the sweep's documented
  exceptions in the docs linked below). Nothing removes it but a manual
  `git worktree remove`.
- **Pick what to parallelize by file surface, not by ticket.** Two tasks that both
  touch shared config (a lint config, `package.json`, a shared component) will
  conflict at merge time even if the sessions never overlap in time — stagger those
  instead of running them side by side.
- **If the main checkout is already dirtied before you realize you should be in a
  worktree, don't migrate the change with `git stash push -- <file>`** on any file a
  concurrent session might also be editing (a shared README, a shared config) — stash
  pathspec operates on the whole file, so it sweeps up their in-progress hunks too,
  briefly removing their work and dragging it onto your branch. Instead, enter a
  clean worktree from the up-to-date default branch and re-apply only your own hunks
  there.
- **After merging a PR that adds or tightens an enforcing CI rule** (a new lint rule,
  a stricter type check), re-run that check against a fresh default branch and sweep
  any stragglers in a follow-up — branches cut *before* the rule-adding PR merged
  carry violations their own (pre-rule) CI never saw, so the default branch can go red
  on merge despite every individual PR having been green. Watch the merge-timing race
  too: pushing a new commit to a just-merged (and deleted) branch re-creates it, so a
  final commit can *look* merged without actually being on the default branch —
  verify against the merge commit's parent, or the PR's own state, not the branch name.
- **A coverage gate can fail a PR that only adds tests, never removes any**, the first
  time it measures a file the coverage run had never executed before. A trace-based
  coverage tool (kcov, and others like it) treats never-executed code as invisible,
  not as a counted zero — a file the run never touches contributes nothing to the
  denominator, whether or not it has a dedicated test (indirect execution via another
  script's test counts too). The first PR to actually execute that file under
  coverage makes every line in it visible for the first time; if that new execution
  only exercises part of the file, the rest now drags the aggregate percentage down,
  and the floor can fail even though coverage strictly improved.
  Real example: dfadler/agent-config#106 added 3 tests for a new branch in
  `upload.sh`, a script the kcov gate had never measured before — that made the
  script's untested `--pr`/`--issue`/`--comment`/validation paths visible for the
  first time, dropping aggregate shell coverage from 70.24% to 56.90% and failing the
  70% floor. The fix is to finish covering the newly-visible file, not to lower the
  threshold.
- **Squash merges mean a merged branch's commits aren't reachable by SHA on the local
  default branch** — cleanup tooling that checks reachability may warn a branch is
  "unmerged" when it's actually merged. Verify against the PR itself (state: merged),
  not a local branch-reachability check.

Several of the bullets above describe first-class, versioned tool behavior — isolation
enforcement, automatic locking, the sweep and its documented exceptions — rather than
conventions this repo invented. See the
[official Claude Code worktrees docs](https://code.claude.com/docs/en/worktrees) for
what the tool itself guarantees, since Anthropic ships changes to this area every few
weeks per that page.

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
4. Upload both images and embed them via the `dfadler-agent-config:gh-attach-image` skill (`~/.claude/skills/dfadler-agent-config/skills/gh-attach-image/`) — never commit screenshots to the repo and never use a Gist for this; the skill uses GitHub's own attachment upload endpoint, which needs neither.
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

## Don't steal focus from the human

A human is usually typing somewhere while an agent works. Anything that makes an app
frontmost swallows their next few keystrokes, and with several agent sessions running
there's no way to tell which one did it. So:

- **Never launch a GUI app in the foreground as a side effect of a task.** On macOS,
  `open -a Foo` makes Foo frontmost — verified. Use `open -g` (launch/open without
  foregrounding) or `open -j` (launch hidden); both leave the frontmost app alone,
  also verified. Same rule for anything that shells out to a GUI: pass the flag that
  keeps it in the background, or use the headless mode if it has one.
- Prefer tooling that never draws a window at all. `qlmanage -t` and
  `chrome --headless` already take no focus, so the visual-verification flow above is
  fine as written — the rule is about not regressing it.
- **Never `open -a Terminal` (or drive Terminal.app via `osascript`) to get a shell.**
  For an interactive TUI/REPL an agent must drive and read back, use the
  `dfadler-agent-config:detached-terminal` skill — a real PTY that's never
  displayed, with a screen model the agent can query. For anything
  non-interactive, the headless `Bash` tool (with `run_in_background` for long jobs)
  already covers it and needs no terminal. **It is not a sandbox** — the program runs
  as you, and anything read back from it is untrusted text entering your context. Run
  trusted programs there, never an untrusted build step or fetched script.
- **Don't do privileged work in a terminal session an agent can drive.** sudo keeps
  its timestamp per-tty by default, so authenticating there leaves a live sudo ticket
  on a tty the agent can send keystrokes to. Same for an authenticated `ssh` session
  or an unlocked credential helper. Do that work in your own terminal; the agent's
  session is for driving a program, and you inspect it with `read`, not by taking
  it over.
- **Don't reach for capture-then-restore focus.** `osascript` to save the frontmost
  app, do the thing, and put it back needs broad automation entitlements that grant
  far more than restoring focus, and it races the user's own typing. Not taking focus
  is strictly better than giving it back.

## Answer shape for direct "why" questions

When asked a direct root-cause question — "Why didn't you X?", "What caused Y?",
"Where is W handled?" — lead with the cause, not a policy recap or a walk through
everything that was tried. Answer in this shape:

1. **Cause** — what happened and why, in one line.
2. **Evidence** — the concrete signal that shows it: a file path, a log line, a
   command's output.
3. **Next step** — the smallest corrective action, or a single question that would
   confirm or decide it.

This is about the shape of the answer, not about pausing more often — it doesn't
change the general bias toward proceeding rather than stopping to ask; it only
applies once the user has already asked a direct question and wants the real answer,
not a recap of what should have happened.

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
- Support `-h`/`--help`, printing at least a one-line usage summary before any other
  argument handling runs. No need for shared help-printing machinery at this scale — a
  `usage()` function with a heredoc, checked first in a plain `case` statement (or arg
  loop), is enough; `setup.sh` is the style reference already in this repo. `--version`
  isn't required unless a script actually has a version to report.
- Use named, documented exit codes instead of bare `exit 1` — a shared, small
  taxonomy, not a bespoke one per script. Reuse this repo's numbering (skip the ones a
  script has no path for; don't invent new ones without extending this list):
  ```bash
  EXIT_OK=0            # success
  EXIT_FAILURE=1       # general failure — the check ran and found something wrong
  EXIT_USAGE=2         # missing/invalid arguments, including a bad path argument
  EXIT_CONFIG=3        # bad config (reserved — no script needs this yet)
  EXIT_DEPENDENCY=4    # a required external command isn't on PATH
  EXIT_NETWORK=5       # network failure (reserved — no script needs this yet)
  EXIT_TIMEOUT=6       # operation timed out (reserved — no script needs this yet)
  EXIT_INTERNAL=20     # unexpected/assertion failure — should not happen
  ```
  Declare only the constants a given script actually uses (an unused `readonly`
  triggers shellcheck's SC2034). The gap between 6 and 20 is deliberate headroom for
  more specific codes later without renumbering `EXIT_INTERNAL`.

## Testing: sabotage/mutation spot-check

A test that passes today isn't proof it would catch a real regression — an
implementation-coupled mock, a tautological assertion, or an existence-only check can
pass vacuously forever. Spot-check a new or modified test by temporarily breaking the
code under test (comment out the logic, early-return, flip a condition) and re-running
it: the test should fail. Revert the breakage immediately after confirming — this is a
manual verification step, not a change to ship. Apply it selectively (new/modified
tests, or ones you're suspicious of), not as a blanket pass over an existing suite.
This is cheap because it needs no mutation-testing tool, just the language's own
runner; #93 and #120's kcov/`check-shell-coverage.sh` work both used exactly this
technique to confirm bats coverage was real rather than incidental.

## Favor tooling over manual scanning

When a task calls for checking many things — a codebase-wide convention, every
caller of a changed signature, whether a file is still referenced — reach for an
automated tool (grep, a linter, a type checker, the test suite, a codemod) before
reading through files by hand. A tool checks exhaustively and doesn't get tired
partway through; manual scanning can miss items and stop partway through.

- After a change, run the smallest check that actually exercises it — a focused
  test, the specific command that was edited — rather than a full suite by default.
- Only widen scope once something's actually off: a whole-file read, a check of
  sibling/related files, an effective-config dump. A persisting error, a behavior
  mismatch, or a flaky result is grounds to widen it; doing so preemptively isn't.
- Prefer a tool's autofix pass over a manual cleanup when a safe autofixer exists.
  If the autofix changes semantics or adds unwanted noise, revert it and fix by
  hand instead.

## Dependency changes: audit before done

When a change adds or updates a dependency — a manifest or lockfile is touched
(`package.json`, `requirements.txt`/`pyproject.toml`, `Cargo.toml`, `go.mod`, etc.) —
run the audit tool for whichever ecosystem is in play before considering the change
done: `npm audit` (or `yarn npm audit --all` under Yarn), `pip-audit`, `cargo audit`,
`govulncheck`, or the project's own equivalent. Don't assume a new or bumped
dependency is safe just because it installed cleanly — the same way a shell script
gets run through shellcheck/shfmt before being considered finished.

- This only fires when a dependency file is actually touched — most sessions in most
  repos won't need it.
- If the audit surfaces a new high/critical finding, say so in the commit/PR rather
  than silently proceeding; whether that blocks the change is a per-repo call, not
  a blanket rule here.

## Secrets handling

Treat env vars, tokens, API keys, session IDs, and credentials as sensitive data in
this agent's own output — logs, commits, PR/issue bodies and comments, error
messages — separate from credential *entry* and command-execution consent, which the
environment's own permission system already governs:

- Never commit a secret. Redact or mask secrets in logs, errors, tool output, and
  anything posted publicly (PR/issue bodies, comments).
- Avoid echoing headers that carry credentials, such as `Authorization`, `Cookie`,
  `Set-Cookie` (response), or `Proxy-Authorization`, even while debugging.
- If exposure is suspected — a secret shows up in a diff, a log, or output about to be
  posted — rotate the credential immediately and note the remediation rather than
  just scrubbing the visible copy.

## Cite sources for platform-capability claims

When stating a platform or tool capability as fact — rate limits, model behavior,
API surface, auth methods, size limits, what a product can or cannot do — cite the
official docs rather than relying on memory or inference. Marketing copy and old
training data go stale; a confident wrong answer here is worse than a slower correct
one. If unsure, say so explicitly and point to where to check, rather than guessing
confidently. This applies to any platform or tool, not just Claude/Anthropic.

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
- When `gh pr checks`/`gh run view --log-failed` (see above) doesn't explain a
  failure, escalate in this order before giving up: `gh api
  repos/<owner>/<repo>/actions/runs/<runId>/jobs` for per-step status/timing the
  summary view collapses; `gh run rerun <runId> --debug --failed` to get verbose step
  logs on just that one re-run — no need to set the `ACTIONS_STEP_DEBUG`/
  `ACTIONS_RUNNER_DEBUG` repo secrets or variables unless you want debug logging on
  *every* run; `gh run watch --compact` to follow an in-progress run instead of
  polling. `make lint-actions`/`actionlint` remain the required check for a workflow-
  syntax problem — neither of the two options below can diagnose one, since a syntax
  error or a run that never reaches a runner never gets that far. For a genuinely
  stuck failure that's already reaching a runner: local reproduction (`act`, via
  Docker) — doesn't perfectly match the hosted runner's environment/secrets — or, as a
  last resort, SSH-into-the-runner (`mxschmitt/action-tmate`), placed as its own step
  immediately after the one being diagnosed and guarded with `if: ${{ failure() }}`
  so it survives a preceding-step failure, restricted to trusted workflows via
  `limit-access-to-actor: true` (or equivalent), and only ever added temporarily —
  it pauses the job and burns runner minutes, so treat it as a tool to reach for only
  when the above doesn't resolve it, not a habit to build into a workflow. Docs:
  [`gh run rerun`](https://cli.github.com/manual/gh_run_rerun),
  [status-check functions incl. `failure()`](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#status-check-functions),
  [`action-tmate` incl. `limit-access-to-actor`](https://github.com/mxschmitt/action-tmate#readme).
- **`.github/` stays config-only.** Limit it to platform configuration: workflows
  (`.github/workflows/`), CODEOWNERS, dependabot/release config, and a **generic**
  PR/issue template. Feature- or product-specific docs, playbooks, or checklists
  belong under the project's own docs directory, not `.github/`. If a specific
  feature genuinely needs its own PR template, use an opt-in file under
  `.github/PULL_REQUEST_TEMPLATE/<feature>.md` (or have tooling append content only
  for those PRs) — never grow the generic template with feature-specific sections.
- In the `agent-config` repo specifically: before writing, changing, or debugging
  anything under `.github/workflows/`, read `docs/github-actions.md` — SHA-pinning,
  composite-action-vs-reusable-workflow judgment calls, the debugging escalation
  order, and known failure patterns already hit and resolved here.
