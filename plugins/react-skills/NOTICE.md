# Third-party notice

This plugin vendors two skills unmodified from
[vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills), licensed MIT
by Vercel Engineering:

- `skills/react-best-practices`
- `skills/composition-patterns`

Vendored at commit
[`063bee9`](https://github.com/vercel-labs/agent-skills/commit/063bee94c3f4df8453406c830b0a7df0f2860278)
(2026-08-28). Each skill's `metadata.json` and `SKILL.md` front matter carry Vercel's
own version/author/license fields unchanged.

Vendored rather than referenced as an install-time dependency (contrast
`dfadler-agent-config`'s companion-plugin approach to `mattpocock-skills`, see the
README) because `vercel-labs/agent-skills` ships no `.claude-plugin/marketplace.json` —
it's distributed via `npx skills add`, a different mechanism from
`claude plugin install`, and that command pulls the whole collection rather than
selecting individual skills. Copying is legal here — the source repo is MIT-licensed
end to end — but it does mean **this content goes stale silently** unless someone
re-pulls it.

## Updating

```bash
git clone --filter=blob:none --no-checkout https://github.com/vercel-labs/agent-skills.git /tmp/vercel-agent-skills
cd /tmp/vercel-agent-skills && git checkout <new-commit-sha>
cp -R skills/react-best-practices  <this-repo>/plugins/react-skills/skills/react-best-practices
cp -R skills/composition-patterns  <this-repo>/plugins/react-skills/skills/composition-patterns
```

Then update the commit SHA/date above and bump this plugin's `version` in
`.claude-plugin/plugin.json`.

## MIT License (vercel-labs/agent-skills)

Copyright (c) Vercel, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy of this
software and associated documentation files (the "Software"), to deal in the Software
without restriction, including without limitation the rights to use, copy, modify,
merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be included in all copies
or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE
OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
