# Third-party notice

This plugin's skills will be **adapted from**, not copied verbatim out of,
[alan2207/bulletproof-react](https://github.com/alan2207/bulletproof-react)'s
`docs/*.md` files, licensed MIT by Alan Alickovic. No generator or skills exist yet —
this notice documents the pinned dependency this infrastructure PR (agent-config#216)
adds. Unlike a hand-vendored copy, the adaptation will be produced by a scripted
generator (agent-config#217) that reads the pinned commit below and re-runs whenever
that pin is bumped — see "Updating".

Currently pinned at commit
[`9506629`](https://github.com/alan2207/bulletproof-react/commit/9506629ed003a561c6627735480cce4994244bb4)
(2026-09-11).

## Why a generator instead of a manual copy

bulletproof-react has no releases or tags — its `package.json` `version` field is
static and doesn't track commits — so there's no semver signal to pin against or
watch for updates. The devDependency in this plugin's `package.json` pins an exact
commit SHA instead. A hand-adapted copy of prose docs would go stale silently the
same way agent-config#211's hand-vendored skill copy did; re-running the generator
against a bumped SHA is the automated fix for that failure mode.

## Doc-set drift already observed

At scoping time (agent-config#215), `docs/` had 11 files. At this pin (`9506629`),
it has 12: a new `additional-resources.md` appeared (a bare list of external links,
no React-specific guidance — same "too thin to distill" shape as `deployment.md`,
so it's dropped the same way). This is exactly the drift #215 flagged as a risk in
its "drift detection" open question, and it materialized before generation even
started. The generator (agent-config#217) is expected to notice a doc-set shape
change like this on every re-run rather than silently regenerating around it.

## Updating

This is a **manual process today** — there is no scheduled or CI job that checks for
a new upstream commit and opens a re-pin PR automatically. Given bulletproof-react
has no releases to watch, that would mean periodically diffing the pinned SHA
against upstream `master` on some cadence; worth doing eventually, but it's
explicitly future work, not a requirement for this plugin to be useful today.

1. **Find the new commit to pin** (or use a specific one you've already decided on):

   ```bash
   git ls-remote https://github.com/alan2207/bulletproof-react.git HEAD
   ```

2. **Bump the pin** in `package.json`'s `devDependencies`, then reinstall:

   ```
   "bulletproof-react": "git+https://github.com/alan2207/bulletproof-react.git#<new-sha>"
   ```

   ```bash
   npm install
   ```

   This respects the local `.npmrc` (`ignore-scripts=true`): bulletproof-react's
   own `package.json` has a `prepare` script that would otherwise try to install
   three example apps' worth of dependencies just to fetch `docs/*.md`.

3. **Re-run the generator** (`npm run generate`, agent-config#217) and read its
   output. It refuses to proceed — rather than silently regenerating around the
   gap — if the doc set no longer matches its mapping (a file added, removed, or
   renamed); in that case, update `generate.js`'s `SKILL_MAP`/`DROPPED` first.

4. **Review the manifest diff** (`.docs-manifest.json`, per-file content hashes) to
   see which source docs actually changed since the last generation.

5. **Run the polish step** (`npm run polish`) to rewrite each changed skill from
   generate.js's mechanical draft into agent-directed guidance, via `claude -p`.
   Skips any skill whose source hasn't changed since it was last polished
   (tracked in `.polish-manifest.json`), so this only spends an API call — and
   only re-rolls wording — on skills the pin bump actually touched.

6. **Review each changed `SKILL.md`** against its source doc(s) anyway — an LLM
   rewrite can still get a technical detail subtly wrong, especially on
   security-sensitive content, so the human pass from the initial generation
   (agent-config#218) still applies on every re-run, not just the first one.

7. **Commit** the updated `SKILL.md` files, `.docs-manifest.json`,
   `.polish-manifest.json`, the new pinned
   SHA/date in this file, and a bumped `version` in `.claude-plugin/plugin.json`.

## MIT License (alan2207/bulletproof-react)

Copyright (c) 2024 Alan Alickovic

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
