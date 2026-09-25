---
name: dev-workflow
description: |
  Dev workflow for working on a Vite plugin package: running tests, watch mode,
  coverage, type checking, and local linking. Use when setting up a development
  workflow for a new or existing Vite plugin package.
metadata:
  version: "1.0.0"
---

# Vite Plugin Dev Workflow

## Running tests

Prefer the package's own scripts over invoking `vitest` directly. The scripts
wire up the correct config, reporters, and any task-runner dependency ordering
(e.g. Turbo requires upstream builds to run before tests).

| Goal | Script |
|------|--------|
| Watch mode | `pnpm test` |
| One-shot (no watch) | `pnpm test:nowatch` |
| One-shot, CI mode | `pnpm test:ci` |
| With coverage | `pnpm test:ci:coverage` |
| Single file, watch | `pnpm test -- src/vite/__tests__/myPlugin.test.ts` |
| Single file, no watch | `pnpm test:nowatch -- src/vite/__tests__/myPlugin.test.ts` |

Script names vary across projects — check `package.json` before assuming they
match the table above. Common aliases: `test:watch`, `vitest`, `unit`.

**Standalone packages** (no monorepo, no task runner) can invoke Vitest directly:

```bash
npx vitest                          # watch mode
npx vitest --watch=false            # one-shot
npx vitest --watch=false --coverage # with coverage
npx vitest src/vite/__tests__/myPlugin.test.ts  # single file, watch
```

## Type checking

```bash
npx tsc --noEmit
```

Run this before committing. Type errors in plugin hooks are often silent at
runtime (wrong return types from `transform`, missing `null` returns) but
caught by the type checker.

## Testing against your app

**In a pnpm workspace** — use the workspace protocol in the consumer's
`package.json`, then reinstall:

```json
"dependencies": {
  "@my-org/vite-plugin-name": "workspace:*"
}
```

```bash
pnpm install
```

The consumer imports the plugin from the package path as normal. Changes to the
plugin source are picked up on the next Vite dev server restart (or rebuild for
build-mode plugins).

**For a standalone published plugin** — use `npm link`:

```bash
# From the plugin package directory
npm link

# From the consumer app directory
npm link vite-plugin-my-plugin
```

Then import in `vite.config.ts` as normal.

## Debugging a plugin transform

Use `vite-plugin-inspect` (requires Vite 8+ and `@vitejs/devtools`) to see
intermediate transform states between plugins:

```bash
pnpm add -D vite-plugin-inspect @vitejs/devtools
```

```ts
// vite.config.ts
import Inspect from 'vite-plugin-inspect'

export default {
  plugins: [
    Inspect(),
    myPlugin(),
  ],
  devtools: true,  // required to enable the inspection UI
}
```

Then open `/__inspect` in the browser to step through what each plugin
does to each module. For build inspection, pass `Inspect({ build: true })` and
enable `devtools.build.withApp: true`.

## Adding a test for a new hook

1. Read `vite:test` for the pattern that matches your hook type
   (`transform`, `generateBundle`, or `configureServer`).
2. Add the test adjacent to the plugin: `src/vite/__tests__/<plugin>.test.ts`.
3. Run the test file in watch mode while developing:
   ```bash
   pnpm test -- src/vite/__tests__/<plugin>.test.ts
   # or for standalone packages:
   npx vitest src/vite/__tests__/<plugin>.test.ts
   ```

## Upgrading Vite

When upgrading the installed Vite version in the plugin package:

1. Update `devDependencies` in `package.json`.
2. Run tests via the package script: `pnpm test:ci`.
3. Check for deprecated API usage: run `vite:review` on each plugin file.
4. If this is a publishable plugin, update `peerDependencies` — run `vite:peer-deps`.
