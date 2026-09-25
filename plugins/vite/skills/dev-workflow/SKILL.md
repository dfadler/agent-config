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

From the plugin package directory:

```bash
# Run all tests once
npx vitest run

# Run a specific test file
npx vitest run src/vite/__tests__/myPlugin.test.ts

# Watch mode (re-runs on save)
npx vitest

# With coverage
npx vitest run --coverage
```

In a monorepo with a shared test config, the workspace root may have a script:

```bash
# Example: from workspace root
pnpm --filter @my-org/vite-plugins test
pnpm --filter @my-org/vite-plugins test:watch
```

## Type checking

```bash
npx tsc --noEmit
```

Run this before committing. Type errors in plugin hooks are often silent at
runtime (wrong return types from `transform`, missing `null` returns) but
caught by the type checker.

## Testing against your app

For a workspace-local plugin, no linking is needed — the app imports from
the package path directly. For a standalone published plugin:

```bash
# Link the plugin locally (from plugin dir)
npm link

# Use it in your app (from app dir)
npm link vite-plugin-my-plugin
```

Then import in `vite.config.ts` as normal. Vite picks up changes after a
dev server restart.

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
   npx vitest src/vite/__tests__/<plugin>.test.ts
   ```

## Upgrading Vite

When upgrading the installed Vite version in the plugin package:

1. Update `devDependencies` in `package.json`.
2. Run tests: `npx vitest run`.
3. Check for deprecated API usage: run `vite:review` on each plugin file.
4. If this is a publishable plugin, update `peerDependencies` — run `vite:peer-deps`.
