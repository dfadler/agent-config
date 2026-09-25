---
name: lighthouse
description: >
  Run a Lighthouse CLI pass (mobile + desktop) against a URL and store the
  results in the second-brain vault under knowledge/lighthouse/<project>/.
  Use whenever a change needs a repeatable, scriptable performance/
  accessibility/best-practices check — complementing, not replacing, a
  manual responsive resize-and-look pass. Config-driven: which form factors
  run, whether the skill runs at all, and where results land are all
  controlled by lighthouse_enabled, lighthouse_form_factors, and
  lighthouse_output_dir.
license: MIT
metadata:
  version: "0.1.0"
---

# screen-capture:lighthouse

Runs `npx lighthouse` for one or both form factors and stores the JSON
results in second-brain so scores are queryable/comparable across runs
instead of living only in a PR comment or a throwaway temp file. The CLI
invocations here are adapted from `pr-visual-capture`'s Lighthouse section;
this skill adds config-driven form-factor selection and vault storage on
top of the same underlying commands.

This is a scripted CLI pass, not a substitute for the manual resize-and-look
pass in `screen-capture:capture` (or the legacy `pr-visual-capture` skill) —
Lighthouse scores performance/accessibility/best-practices but won't catch
overflow, clipping, or dead-space layout bugs the way actually resizing a
live page does.

## Config keys

Resolved in this order — first source that defines the key wins:

1. **`second-brain:config`** (vault, if connected) — reads
   `config/global/lighthouse.md` then `config/projects/<project>/lighthouse.md`
   frontmatter (per-project overrides global). Degrades gracefully (skips
   to the next source) if the Obsidian MCP is disconnected — see
   `second-brain:config`'s own SKILL.md (issue #328) for that resolution
   contract.
2. **`.claude/settings.json`** (project) → **`~/.claude/settings.json`**
   (user) — under a `screenCapture` key, e.g. `screenCapture.lighthouseEnabled`.
3. **`SCREEN_CAPTURE_*` env vars** — `SCREEN_CAPTURE_LIGHTHOUSE_ENABLED`,
   `SCREEN_CAPTURE_LIGHTHOUSE_FORM_FACTORS` (comma-separated),
   `SCREEN_CAPTURE_LIGHTHOUSE_OUTPUT_DIR`.
4. Built-in default (last column below).

| Key | Type | Default | Meaning |
|---|---|---|---|
| `lighthouse_enabled` | boolean | `true` | Whether this skill runs at all. If `false`, skip the CLI pass entirely (treat as a no-op, not an error) — a caller that unconditionally invokes this skill on every PR shouldn't have to branch on it. |
| `lighthouse_form_factors` | list of `mobile` \| `desktop` | `[mobile, desktop]` | Which form factor(s) to run. A single value (`[mobile]`) skips the other CLI invocation entirely, not just its scoring. |
| `lighthouse_output_dir` | path | `knowledge/lighthouse/<project>/` inside the resolved second-brain vault | Where results are stored. Overriding this opts out of vault storage — e.g. pointing it at a local scratch path when second-brain isn't set up (see "No second-brain available" below). |

`<project>` is the repo's directory name (or the `name` field in its
`package.json`/`pyproject.toml` if present) — the same value `compare`
(#325) and `capture` (#323) use for their own worktree/project detection,
so results land under the same project key those skills key off of.

## Running the pass

For each form factor selected by `lighthouse_form_factors`:

```bash
# Mobile form factor
npx lighthouse "<url>" \
  --output=json --output-path="<output_dir>/<timestamp>-mobile.json" \
  --form-factor=mobile --screenEmulation.mobile \
  --chrome-flags="--headless=new" --quiet

# Desktop form factor -- --preset=desktop applies Lighthouse's own desktop
# config (formFactor: 'desktop' plus its desktop screenEmulation metrics;
# see core/config/desktop-config.js in the Lighthouse repo) instead of
# spelling the equivalent flags out by hand
npx lighthouse "<url>" \
  --output=json --output-path="<output_dir>/<timestamp>-desktop.json" \
  --preset=desktop \
  --chrome-flags="--headless=new" --quiet
```

(CLI flag reference:
https://github.com/GoogleChrome/lighthouse/blob/main/readme.md#cli-options
and
https://github.com/GoogleChrome/lighthouse/blob/main/core/config/desktop-config.js.)

`<url>` needs to be reachable by the headless Chrome Lighthouse launches — a
local dev server URL, not a `file://` path. This skill doesn't start dev
servers, same as `compare` (#325) — the caller supplies a reachable URL.

Read the resulting JSON for score regressions and new findings; don't just
skim the top-level `categories.*.score` numbers.

## Output storage path and naming

Results are written under `lighthouse_output_dir`, which defaults to
`knowledge/lighthouse/<project>/` inside the second-brain vault:

```
knowledge/lighthouse/<project>/<timestamp>-<form-factor>.json
```

- `<timestamp>` — `YYYY-MM-DDTHHmmss` (UTC, filesystem-safe — no colons),
  one per invocation, shared between the mobile and desktop file when both
  run in the same pass so they sort and pair together.
- `<form-factor>` — `mobile` or `desktop`, matching the CLI invocation that
  produced it.

Example, both form factors run against `agent-config` on 2026-09-25:

```
knowledge/lighthouse/agent-config/2026-09-25T143022-mobile.json
knowledge/lighthouse/agent-config/2026-09-25T143022-desktop.json
```

This mirrors `pr-visual-capture`'s flat `lighthouse-mobile.json` /
`lighthouse-desktop.json` naming, just namespaced by project and timestamped
so repeated runs accumulate in the vault instead of overwriting each other.

## No second-brain available

`plugins/second-brain/` (issues #327-329) provides the vault-write
primitive this skill's default output location depends on. Until it's
present:

- If `lighthouse_output_dir` is explicitly configured (settings.json or
  `SCREEN_CAPTURE_LIGHTHOUSE_OUTPUT_DIR`), write there instead — no vault
  needed.
- Otherwise, fall back to the scratchpad directory and say so plainly
  (e.g. "second-brain not available; wrote to <scratchpad path> instead of
  knowledge/lighthouse/<project>/") rather than silently dropping the
  results or hard-failing.

## Relationship to other screen-capture skills

- **`capture`** (#323) owns the manual resize-and-look pass and general
  page capture; this skill only runs the scripted Lighthouse CLI pass.
- **`compare`**/**`attach`** (#325/#324) are for before/after screenshots
  and PR-comment formatting — Lighthouse scores aren't part of that table
  unless a caller explicitly pulls the JSON's summary scores in.
