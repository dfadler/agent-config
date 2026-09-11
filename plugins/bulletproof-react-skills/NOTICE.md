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

```bash
# 1. Find the new commit to pin (or a specific one you've already decided on):
git ls-remote https://github.com/alan2207/bulletproof-react.git HEAD

# 2. Bump the pin in package.json's devDependencies, then reinstall:
#      "bulletproof-react": "github:alan2207/bulletproof-react#<new-sha>"
npm install

# 3. Re-run the generator (agent-config#217) and review what it flags/changes:
#      - a changed doc-set shape (added/removed/reshaped file) vs. the manifest
#      - the diff in each regenerated SKILL.md
```

Then update the commit SHA/date above and bump this plugin's `version` in
`.claude-plugin/plugin.json`.

`npm install` in this directory respects the local `.npmrc` (`ignore-scripts=true`):
bulletproof-react's own `package.json` has a `prepare` script that would otherwise
try to install three example apps' worth of dependencies just to fetch `docs/*.md`.

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
