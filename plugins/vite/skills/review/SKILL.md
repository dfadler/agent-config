---
name: vite:review
description: |
  Review a Vite plugin against conventions: checks for deprecated hooks,
  missing required fields, incorrect enforce/apply usage, peerDependency ranges,
  and SSR awareness gaps. Use when asked to review an existing Vite plugin file
  or a diff that touches a plugin.
metadata:
  version: "1.0.0"
---

# Review a Vite Plugin

Work through each checklist item. Report every finding with the file path and
line number. Skip items that don't apply to the plugin under review.

## 1. Deprecated APIs

- [ ] `handleHotUpdate` present → replace with `hotUpdate`. The new hook receives
  `HotUpdateOptions` (with `type: 'create' | 'update' | 'delete'`) and is called
  once per environment with `this.environment` available.
- [ ] `transformWithEsbuild` imported or called → replace with `transformWithOxc`
  from `vite`. The API is a drop-in replacement; `transformWithEsbuild` is
  deprecated in Vite 7.

## 2. Required fields

- [ ] Plugin object has a `name` field in `kebab-case`.
- [ ] Plugin is exported from a factory function (not a class, not a plain object
  at module scope).

## 3. Return type

- [ ] Return type is `Plugin`, `PluginOption`, or the project's local `VitePlugin`
  alias — all imported from `vite`. Raw `object` or `any` return types are wrong.

## 4. `enforce` usage

- [ ] `enforce` is present only when ordering relative to Vite core plugins is
  genuinely needed. Challenge any `enforce` that lacks a comment explaining why.
- [ ] `enforce: 'pre'` is only used for transforms that must see raw source before
  Vite's own transforms run (custom JSX, alias injection, etc.).
- [ ] `enforce: 'post'` is only used when the plugin must run after all other
  plugins and Vite's own build plugins.

## 5. `apply` usage

- [ ] `apply` is only present when the plugin must be entirely excluded from one
  mode. If the plugin uses `if (env.mode === 'development')` guards internally,
  `apply` is probably unnecessary.

## 6. `transform` hook correctness

- [ ] Returns `null` (not `undefined`, not the original `code`) for files the
  plugin doesn't handle. Returning the original code causes a no-op transform
  but still goes through sourcemap chain processing.
- [ ] Returns `{ code, map }` (not bare `code`) when a sourcemap should be
  preserved. Returning a bare string drops the original sourcemap.
- [ ] Guards on file extension or path before processing: avoids accidentally
  transforming node_modules or asset files.

## 7. `configureServer` / `configurePreviewServer` hooks

- [ ] If the plugin needs to run middleware **after** Vite's internal middleware,
  it returns a function from `configureServer` rather than registering middleware
  directly.
- [ ] Servers are not stored in module-level state without cleanup — store on the
  plugin closure scope or clean up in `closeServer`.

## 8. SSR awareness

- [ ] `transform`, `load`, and `resolveId` hooks that should not run during SSR
  check `options?.ssr` and return `null`/skip accordingly.
- [ ] Plugins that inject client-side-only code (event listeners, DOM APIs) guard
  against SSR execution.

## 9. `generateBundle` hook

- [ ] Mutates the `bundle` argument in place rather than returning a new value
  (the Rolldown hook ignores return values from `generateBundle`).
- [ ] Uses `this.emitFile` to add new files rather than directly mutating
  `bundle` keys with non-existing entries.

## 10. `peerDependencies` (for publishable plugins)

- [ ] `peerDependencies` declares `"vite"` with an explicit minimum version range
  (e.g., `">=7.0.0"`) rather than `"*"`.
- [ ] The declared range matches what the plugin actually requires. If the plugin
  uses Environment API hooks (`configEnvironment`, `hotUpdate`, `this.environment`),
  the minimum is Vite 6. If it uses `transformWithOxc`, the minimum is Vite 7.
- [ ] When a new Vite major ships, the range must be updated before users can
  install without peer-dependency conflicts. Run `vite:peer-deps` to walk through
  the update.

## 11. HMR hook (`hotUpdate`)

- [ ] Uses `hotUpdate` not `handleHotUpdate`.
- [ ] If the hook filters modules, it returns the filtered array (or an empty
  array to suppress HMR), not `undefined`.
- [ ] Accesses `this.environment` (available in Vite 6+) rather than inspecting
  a global server reference.
