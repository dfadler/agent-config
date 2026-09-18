# Third-party notice

This plugin's `a11y-review` skill draws on two external sources. Neither is
vendored verbatim; both are adapted and rewritten for a static, agent-driven code
review rather than the runtime tool each was originally written for.

## The A11Y Project checklist

`skills/a11y-review/references/checklist.md` is adapted from
[The A11Y Project's checklist](https://www.a11yproject.com/checklist/), retrieved
2026-09-12, licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
("© 2013–2026 The Accessibility Project"). Each checklist item is reworded and
regrouped under the same category headings as the source, with its WCAG 2.2
success-criterion link preserved.

The checklist page has no version or release tag to pin against, so there is no
automated re-pin workflow here (unlike
[dfadler/bulletproof-react-skills](https://github.com/dfadler/bulletproof-react-skills)'s
`NOTICE.md`/generator, which pins a commit SHA). To refresh: re-fetch
`https://www.a11yproject.com/checklist/`, diff its current items against
`references/checklist.md` by hand, and update the retrieval date above.

## AccessLint grading methodology

`skills/a11y-review/references/grading.md`'s evidence-basis (●/◐/○) and severity
grading structure is adapted from the methodology in
[AccessLint/skills](https://github.com/AccessLint/skills) (MIT licensed), which
grades findings from a live-DOM audit. The grade *definitions* here are rewritten
from scratch for what static source inspection alone can support — a live audit
can verify keyboard operability by driving the page; a static review cannot, and
`grading.md` says so. No AccessLint prose is copied; the two-axis
(evidence-basis × severity) structure and the ●/◐/○ notation are the part
credited here.

## Apache License 2.0 (The Accessibility Project)

The full, unmodified license text is in [`LICENSE`](LICENSE) alongside this
file — Apache-2.0 §4(a) requires giving recipients an actual copy of the
license, not just a link to it. No modifications were made to the license
text; the checklist *content* itself was reworded as described above.

## MIT License (AccessLint)

Copyright (c) AccessLint

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
