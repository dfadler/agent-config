---
name: peer-deps
description: |
  Walk through updating a Vite plugin's peerDependencies when a new Vite major
  version ships. Use when a Vite major is released and users report peer-dependency
  conflicts, or when proactively keeping a plugin current.
metadata:
  version: "1.0.0"
---

# Maintaining Vite Plugin peerDependencies

When a new Vite major ships (e.g., Vite 7 → Vite 8), check whether each plugin's
declared `"vite"` peer range already includes the new major. A range like
`>=7.0.0` already satisfies Vite 8 and later — no range update is needed unless
the range excludes the new major (e.g., `^7.0.0`) or the plugin adopts APIs
introduced in that major.

## Step 1: Find the current peer dependency declaration

```bash
# Search all package manifests in the repo (monorepo-safe)
grep -r '"vite"' --include='package.json' .
```

Expect to find something like:
```json
"peerDependencies": {
  "vite": ">=7.0.0"
}
```

If the range is `"*"`, that's the old pattern — replace it with an explicit
minimum as part of this update.

## Step 2: Determine the new minimum

Ask: **does this plugin use any API that was introduced after the old minimum?**

| API used | Minimum Vite version |
|----------|---------------------|
| `hotUpdate` hook | 6.0 |
| Environment API (`configEnvironment`, `this.environment`) | 6.0 |
| `transformWithOxc` | 8.0 (rolldown-vite/Vite 8+) |
| `RolldownOutput` from `build()` return type | 8.0 |
| `scss.silenceDeprecations` config option | 5.0 |

If the plugin uses none of these, the minimum can stay at whatever the oldest
supported Vite version is.

## Step 3: Decide the range shape

**For a plugin that supports multiple Vite majors:**
```json
"vite": ">=7.0.0"
```

**For a plugin that only supports the current major:**
```json
"vite": "^8.0.0"
```

**For a plugin that bridges two majors during a transition:**
```json
"vite": "^7.0.0 || ^8.0.0"
```

Use `>=` (lower-bounded, any future major) unless the plugin is known to break
on the next major. Use `||` during a transition period when you've tested both.
Avoid `*` — it fails to communicate the actual minimum and generates unhelpful
npm install errors.

## Step 4: Update package.json

Edit `peerDependencies` in the plugin's `package.json`. Do not change
`devDependencies` — those pin the actual installed version for tests and are
separate from what consumers need.

## Step 5: Determine the semver impact on the plugin itself

Updating a peer dependency range is a **breaking change if you're dropping
support for an old Vite major** (users on the old major can no longer install
your plugin). Bump the plugin's own major version in that case.

If you're only **adding** support for a new major (keeping the old minimum),
it's a non-breaking change — a patch or minor bump is sufficient.

| Change | Plugin semver bump |
|--------|--------------------|
| Add new Vite major to range (keep old min) | patch |
| Raise minimum to new Vite major (drop old) | major |
| Replace `"*"` with explicit minimum that narrows the range | major (drops formerly-supported versions) |

## Step 6: Update the changelog and release

Document the change:
```markdown
## [X.Y.Z]
### Changed
- Updated `peerDependencies` to include Vite 8 (`"vite": ">=7.0.0"`)
```

Then publish a new version of the plugin package.

## Reminder: test with the new Vite version before releasing

Run the plugin's test suite with the new Vite version installed before
widening the range. Install the new Vite as a dev dependency for tests:

```bash
npm install --save-dev vite@^8.0.0
npx vitest run
```

If tests pass, update the range and publish.
