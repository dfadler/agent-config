# GitHub Actions: this repo's practices

Reference for writing, hardening, and debugging the workflows under
`.github/workflows/`. Grew out of a deliberate investigation (issues #108–112)
plus a real incident it documents (#106), rather than accreting ad hoc —
consult it before adding a workflow, changing an existing one, or chasing down
a CI failure here.

## Writing a workflow

- **Composite action vs. reusable workflow are for different-sized problems.**
  A composite action factors out a shared *step sequence* (a handful of steps,
  reused verbatim across workflows) — the right tool once something non-trivial
  (a multi-line install-and-verify block, a URL template, a checksum check)
  shows up identically in two or more files. A reusable workflow
  (`workflow_call`) factors out a shared *multi-job process* — worth it once
  several trigger paths need to invoke the same pipeline identically, not for
  a few shared lines at the top of otherwise-unrelated jobs.
- **Don't force either abstraction below its break-even point.** A 3–4 line
  `checkout` + `setup-python` prefix shared by jobs that otherwise share
  nothing (different runtimes, step counts, `env` blocks) isn't worth a
  `workflow_call` interface — the interface (inputs/outputs/secrets contract,
  a 10-level nesting cap, matrix-with-reusable-workflow output quirks) costs
  more than the duplication it would remove. Revisit once a third near-identical
  instance of something bigger appears, or once an actual shared multi-job
  pipeline exists (e.g. a release workflow several triggers need identically).
- **Every CI check should call the same command a human runs locally**
  (a `make` target, a script) rather than reimplementing the check inline in
  YAML. That's what keeps "CI is green" and "the local check is green" from
  drifting apart, and it's what makes `act`/local reproduction close to free —
  there's no CI-only logic to fall back to Docker for.
- **Matrix builds, `workflow_call` inputs/secrets** — not yet relevant here
  (single pinned runtime, no cross-workflow calls), but design them carefully
  when they do show up: explicit `inputs`/`secrets` blocks, never
  `secrets: inherit` by default.

## Security hardening

- **Pin every *external* `uses:` reference to a full commit SHA, not a tag.**
  This applies to third-party and other-repository actions/workflows
  (`owner/repo@ref`) — a tag like `@v7` is mutable there, since the publisher
  (or a compromised publisher account) can repoint it at different code
  without the workflow file changing at all. GitHub's own hardening guide
  states SHA-pinning is "the only way to use an action as an immutable
  release." Keep the resolved version as a trailing comment for readability:
  `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`.
  It does **not** apply to a local action or a same-repository reusable
  workflow referenced by relative path (`./.github/actions/<name>`,
  `./.github/workflows/<file>.yml`) — those forms take no `@ref` at all
  (GitHub rejects one) and always run at the calling commit, so there's
  nothing to pin.
  To resolve a tag to its commit SHA: `gh api
  repos/<owner>/<repo>/git/refs/tags/<tag>` returns an `object`. If
  `object.type` is `commit` (a lightweight tag), `object.sha` **is** the
  commit SHA — use it directly. If `object.type` is `tag` (an annotated tag),
  `object.sha` is the *tag object's* SHA, not the commit — dereference it
  first via `gh api repos/<owner>/<repo>/git/tags/<that-sha>` and use the
  nested `object.sha` from that response instead. Don't guess or hand-copy a
  SHA from a UI either way.
- **Declare least-privilege `permissions:`.** A top-level
  `permissions: contents: read` block, tightened per-job only where a job
  genuinely needs write, scores highest on OpenSSF Scorecard's
  Token-Permissions check. Also check the repo-level default
  (`gh api repos/<owner>/<repo>/actions/permissions/workflow` —
  `default_workflow_permissions`) independently of what any single workflow
  file declares; both should be read-only unless something specific needs more.
  A `permissions:` block at either level **replaces** the default entirely,
  it doesn't add to it — any scope you don't name is set to `none`. So a job
  that needs `pull-requests: write` must also re-declare `contents: read` in
  that same job-level block if it (or a step in it, like `actions/checkout`)
  still needs read access — adding one permission can silently take another
  away.
- **Verify third-party downloads, don't just fetch-and-run.** For any binary
  pulled from a release URL in a workflow step: download, verify its checksum
  against the publisher's own published manifest, *then* extract/install —
  never pipe a download straight into `tar`/a shell. Be honest in comments
  about which kind of verification you're actually doing: a real
  checksum-manifest check (the publisher's own signed/published hashes) is a
  materially stronger guarantee than "a checksum we recorded once ourselves
  and pin going forward" — the latter only catches *future* tampering, not a
  compromise that happened before the first pin.
- **`concurrency` groups with `cancel-in-progress: true`**, keyed on
  `${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}`,
  are worth having once merge cadence is fast enough that superseded runs are
  common — they stop CI minutes from being spent on runs nobody will look at.
- **Scope triggers as tightly as the workflow allows.** A workflow that can
  only ever find problems in one directory (e.g. a workflow-file linter) should
  trigger only on `paths: [...]` for that directory, not on every push.

## Caching

- Cache a genuinely expensive build (a from-source compile, not a small
  release-binary download) — the download-verify-install pattern above is
  usually fast enough on its own that caching adds complexity without
  measurable benefit.
- **Cache-path ownership is a real, silent-failure trap.** `actions/cache`
  restores as the unprivileged runner user. If the cached path is root-owned
  (e.g. you `sudo install`ed a binary directly into `/usr/local/bin` and cache
  that path), the restore can fail *silently* — the job proceeds as if nothing
  was cached, just slower, with no error to notice. Install into a
  user-writable path first (e.g. under `$HOME`), cache *that*, and only
  `sudo install` into its final location as a separate step after the cache
  hit/build.
- Key the cache on both a generation marker you control (bump it when the
  cached artifact's *shape* changes, e.g. `kcov-bin-v1-...`) and the pinned
  version/commit being cached — so a version bump can't silently keep serving
  the old cached binary.

## Debugging a failing run

Escalate in this order — each step gives you more detail than the last, at
increasing cost:

1. `gh pr checks` / `gh run view <run-id> --log-failed` — logs for just the
   failed steps. This is the default, and usually enough.
2. `gh api repos/<owner>/<repo>/actions/runs/<run-id>/jobs` — per-step status
   and timing (`started_at`/`completed_at`) the summary view collapses. (There
   is no Actions-runs "timeline" endpoint — that term is an Issues/PRs concept.
   This jobs endpoint is the actual equivalent.)
3. `gh run rerun <run-id> --debug --failed` — re-runs the failed jobs (and any
   jobs that depend on them) with verbose step logging, with nothing persisted
   to repo secrets/variables afterward. Prefer this over permanently setting
   `ACTIONS_STEP_DEBUG`/
   `ACTIONS_RUNNER_DEBUG` as repo secrets — those apply to *every* run until
   someone remembers to unset them.
4. `gh run watch <run-id> --compact --exit-status` — follow an in-progress run
   live instead of polling.
5. **Local reproduction (`act`, via Docker) or SSH-into-the-runner
   (`mxschmitt/action-tmate`)** — last resort, and neither can diagnose a
   workflow-*syntax* error or a run that never reaches a runner (`actionlint`
   is the required check for that; it never gets far enough to help there).
   For an in-progress run's actual runtime behavior: `act` doesn't guarantee
   parity with a real hosted runner (secrets handling and service containers
   are the usual divergence points) — lower value here, since every workflow
   already delegates to a `make` target that runs identically outside CI, so
   there's rarely anything Docker-only to reproduce. `action-tmate`, if used:
   place it as its own step immediately after the one being diagnosed, guard
   it with `if: ${{ failure() }}` so a preceding-step failure doesn't skip it,
   restrict access via `limit-access-to-actor: true` (or equivalent — it's an
   open SSH backdoor by default), and never leave it wired into a workflow
   file after the failure is resolved.

## Known failure patterns

- **A trace-based coverage gate (kcov, and others like it) can fail a PR that
  only adds tests, never removes any**, the first time it measures a file the
  coverage run had never executed before. Never-executed code is invisible to
  the tool, not a counted zero — a file the run doesn't touch contributes
  nothing to the denominator, whether or not it has a *dedicated* test
  (indirect execution from another test already counts). The first PR to
  actually execute that file under coverage makes every line in it visible for
  the first time; if that execution only exercises part of the file, the rest
  now drags the aggregate percentage down, and the floor can fail even though
  coverage strictly improved. Real example: `agent-config#106` added 3 tests
  for a new branch in `upload.sh`, a script the kcov gate had never measured
  before — that made the script's other untested code paths visible for the
  first time, dropping aggregate shell coverage from 70.24% to 56.90% against
  a 70% floor. The fix is to finish covering the newly-visible file, not to
  lower the threshold.
- **After merging a PR that adds or tightens an enforcing CI rule**, re-run
  that check against a fresh default branch and sweep any stragglers in a
  follow-up. A branch cut *before* the rule-adding PR merged carries
  violations its own (pre-rule) CI never saw, so the default branch can go red
  on merge despite every individual PR having been green. Watch the
  merge-timing race too: pushing a new commit to a just-merged (and deleted)
  branch re-creates it, so a final commit can *look* merged without actually
  being on the default branch — verify against the PR's own state
  (`gh pr view --json state,mergedAt`), not the branch name. (This repo merges
  via ordinary merge commits, so "the merge commit's parent" is also a valid
  check here; a repo using squash or rebase merges has no such merge commit to
  check against, so the PR-state check is the one that generalizes.)

## What's deliberately not here

No flaky-test-retry, dependency-drift, or timeout guidance yet — this repo has
no real failure history for any of them, and the controls already in place
mitigate specific causes rather than whole categories: every *shell-side*
external tool (shellcheck, shfmt, bats, kcov, actionlint) is pinned by exact
version/SHA with checksum verification, which rules out that tool silently
changing under a workflow — it says nothing about Python's transitive
dependency resolution (`requirements-dev.txt` pins direct packages; pip can
still resolve different transitive versions run to run). `concurrency` with
`cancel-in-progress: true` cancels a *superseded* run in the same group; it
doesn't prevent a timeout or a flaky test in a run that isn't superseded.
Add a section here when one of these actually happens, grounded in the real
incident and naming the specific mechanism — not as a preventive guess.
