## Vite Plugin Authoring

When writing, editing, or reviewing any Vite plugin — a file in `src/vite/plugins/`,
`vite.config.ts`, or any TypeScript/JavaScript file that returns an object with a
`name` field and Vite hooks — apply these rules without being asked:

**Never use deprecated APIs:**
- `handleHotUpdate` is deprecated since Vite 5; use `hotUpdate` instead. The new
  hook receives `HotUpdateOptions` (with `type: 'create' | 'update' | 'delete'`),
  is called once per environment, and exposes `this.environment`.
- `transformWithEsbuild` is deprecated in Vite 7; use `transformWithOxc` instead.

**Plugin structure:** A factory function returning a plain object literal with a
`name` field. Never a class. Return type: `Plugin`, `PluginOption`, or the
project's `VitePlugin` alias, all imported from `vite`.

**`transform` hook:** Return explicit `null` (not `undefined`) for files the plugin
does not handle. Return `{ code, map }` (not bare `code`) to preserve sourcemaps.

For full authoring guidance, load `vite:scaffold`. To review a plugin, load
`vite:review`. To generate tests, load `vite:test`.
