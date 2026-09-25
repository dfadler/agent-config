---
name: vite:scaffold
description: |
  Scaffold a new Vite plugin: generates a correctly-structured TypeScript plugin
  file following the factory-function convention, with the right return type,
  name, hook skeleton, and file placement. Use when creating a new Vite plugin
  from scratch or when asked to add a plugin to a project's Vite config.
metadata:
  version: "1.0.0"
---

# Scaffold a Vite Plugin

## Structure

Every Vite plugin is a **factory function** that returns a plain object literal.
Never use a class. The factory accepts an options argument (or none) and returns
the plugin object.

```ts
import type { Plugin } from 'vite'

export function myPlugin(options?: MyPluginOptions): Plugin {
  return {
    name: 'my-plugin',
    // hooks
  }
}
```

**Return type:** Use one of these, imported from `vite`:
- `Plugin` — a single plugin object (most common)
- `PluginOption` — a plugin, array of plugins, null, or false (for conditional plugins)
- The local project alias `VitePlugin` if the codebase defines it

## File placement

In a monorepo with a shared Vite config package (e.g., `core/packages/apps-core`):
- `<config-package>/src/vite/plugins/<plugin-name>.ts`

In a standalone project:
- `vite-plugin-<name>/src/index.ts` — for publishable plugins
- `<project>/src/vite/plugins/<plugin-name>.ts` — for project-local plugins

## The `name` field

Required. Use `kebab-case`. This name appears in Vite error messages and debug
output. For internal/workspace plugins there is no required prefix. For
publishable plugins that only work with Vite (not plain Rolldown), use the
`vite-plugin-` prefix as a signal to consumers.

## Hook selection guide

| Job | Hook | Notes |
|-----|------|-------|
| Inject dev middleware | `configureServer` | Return a function to run *after* internal middleware |
| Inject preview middleware | `configurePreviewServer` | Same signature as `configureServer` |
| Transform source files | `transform(code, id)` | Return `null` for files you don't handle |
| Resolve virtual modules | `resolveId(source)` | Return `\0virtual:name` prefix convention |
| Load virtual modules | `load(id)` | Pair with `resolveId` |
| Inject config defaults | `config(userConfig, env)` | Return a partial config to deep-merge |
| Read final resolved config | `configResolved(config)` | Store `config` for later hooks |
| Rewrite HTML | `transformIndexHtml(html)` | Return the modified HTML string |
| Post-build output manipulation | `generateBundle(options, bundle)` | Mutates `bundle` in place |
| Run after all output is written | `closeBundle()` | Cleanup, reporting |
| HMR file changes | `hotUpdate(ctx)` | Receives `{ type, file, modules, ... }`, called per environment |

## `enforce` property

Omit in most cases. Use only when ordering relative to Vite's built-in plugins matters:

- `enforce: 'pre'` — run before Vite's core plugins (use for custom JSX transforms,
  custom alias injection, or any transform that must see the raw source)
- `enforce: 'post'` — run after Vite's build plugins (rarely needed)

Do **not** add `enforce` speculatively — it changes the transformation order for
all other plugins in the chain.

## `apply` property

Omit unless the plugin is only valid in one mode:

- `apply: 'serve'` — dev server only (never runs during build)
- `apply: 'build'` — production build only (never runs during dev)

## SSR awareness

When writing `transform`, `load`, or `resolveId`, the hook receives an `options`
argument with an `ssr` boolean. Guard SSR-specific behavior:

```ts
transform(code, id, options) {
  if (options?.ssr) return // skip for SSR builds
  // ...
}
```

## Virtual modules

Use the `\0` prefix convention for virtual module IDs to prevent other plugins
from trying to process them:

```ts
const virtualId = 'virtual:my-data'
const resolvedVirtualId = '\0' + virtualId

export function myPlugin(): Plugin {
  return {
    name: 'my-plugin',
    resolveId(id) {
      if (id === virtualId) return resolvedVirtualId
    },
    load(id) {
      if (id === resolvedVirtualId) return `export const data = ${JSON.stringify(...)}`
    },
  }
}
```

## Deprecation guards

Do not use:
- `handleHotUpdate` — deprecated in Vite 5; use `hotUpdate` instead
- `transformWithEsbuild` — deprecated in Vite 7; use `transformWithOxc` instead

## Full skeleton

```ts
import type { Plugin } from 'vite'

interface MyPluginOptions {
  // options
}

export function myPlugin(options: MyPluginOptions = {}): Plugin {
  return {
    name: 'my-plugin',

    configResolved(config) {
      // store resolved config if needed
    },

    transform(code, id, { ssr } = {}) {
      if (!id.endsWith('.ts')) return null
      // transform and return { code, map } or null
    },
  }
}
```
