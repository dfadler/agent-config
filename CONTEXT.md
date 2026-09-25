# Glossary

## Vite Plugin

A factory function that returns a plain object literal with a `name` field and
one or more lifecycle hook functions. The object extends Rolldown's plugin
interface, so a single plugin works for both the dev server and the production
build without modification. Vite adds its own exclusive hooks on top of
Rolldown's.

## Vite-Exclusive Hook

A hook that Vite calls but Rolldown ignores: `config`, `configResolved`,
`configureServer`, `configurePreviewServer`, `transformIndexHtml`, `hotUpdate`,
`closeServer`. These hooks interact with the dev server or HTML pipeline and have
no Rolldown equivalent.

## Rolldown Hook

A hook called by both Vite and Rolldown during the build pipeline: `resolveId`,
`load`, `transform`, `buildStart`, `buildEnd`, `generateBundle`, `closeBundle`.
These form the shared plugin interface that makes a Vite plugin reusable as a
plain Rolldown plugin.

## enforce

An optional property on a plugin object (`"pre"` | `"post"`) that controls the
plugin's position in the execution order relative to Vite's built-in plugins.
`"pre"` runs before Vite's core plugins; `"post"` runs after Vite's build
plugins. Omitting `enforce` places the plugin after Vite's core plugins.

## apply

An optional property on a plugin object (`"serve"` | `"build"`) that restricts
the plugin to the dev server or the production build only. Omitting `apply`
makes the plugin active in both modes.

## Environment (Vite 6+)

A build target (for example, `client` or `ssr`) that has its own module graph and
plugin hook invocations. Per-environment hooks run once per environment and expose
`this.environment`; global hooks run once for the entire server.

## HMR (Hot Module Replacement)

The mechanism by which Vite updates modules in the browser during development
without a full page reload. The server-side entry point for plugin authors is the
`hotUpdate` hook; the client-side API is `import.meta.hot`.

## peerDependency

A package listed in `peerDependencies` in a plugin's `package.json` that the
consuming project must provide. For Vite plugins, `"vite"` is declared as a peer
dependency with an explicit minimum version range (e.g., `">=7.0.0"`). A
lower-bounded range such as `>=7.0.0` already satisfies later Vite majors, so a
new major does not automatically require a range update — only update when the
new major is excluded by the existing range, or when the plugin adopts APIs
introduced in that major.

## Plugin Layer

A scoping concept for this plugin system. The general `vite` plugin (this repo,
`agent-config`) holds patterns valid for any Vite project. A Hudl-specific layer
(`hudl-agent-config`, a separate future repo) extends it with conventions specific
to `hudl-frontends`.
