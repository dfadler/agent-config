---
name: test
description: |
  Generate a Vitest test file for a Vite plugin. Covers all three hook patterns:
  transform (call the hook directly), generateBundle (fake bundle object), and
  configureServer (fake server with middlewares + httpServer). Use when asked to
  write tests for a Vite plugin, or when a plugin file has no corresponding
  test file.
metadata:
  version: "1.0.0"
---

# Testing a Vite Plugin

Vite plugins are plain objects with hook functions. Test them by calling hooks
directly — no need to spin up a full Vite dev server for unit tests.

Check the project for existing test helpers, shared fake factories, or a
`setupTests` file before writing new ones. Many monorepos already provide
`makeChunk`, fake server builders, or a configured test environment.

## Pattern 1: `transform` hook

Call the hook directly with `(code, id, options)`. Assert on the returned
`{ code, map }` object, or that the hook returned `null` for files it skips.

**Key gotchas:**
- A hook may be an object `{ handler, order, ... }` rather than a bare function.
  Unwrap it before calling:
  ```ts
  const raw = plugin.transform
  const transform = typeof raw === 'function' ? raw : raw?.handler
  ```
- Returning `null` (not `undefined`) is the convention for "I didn't handle
  this file." Test both the handled and unhandled cases.
- Pass `{ ssr: true }` in the options argument to test SSR guard branches.

```ts
it('transforms matching files', () => {
  const plugin = myPlugin()
  const raw = plugin.transform
  const transform = typeof raw === 'function' ? raw : raw?.handler

  const result = transform?.('const x = 1', '/src/file.ts', {})
  expect(result).not.toBeNull()
  expect(result.code).toContain('/* transformed */')
})

it('returns null for non-matching files', () => {
  const raw = myPlugin().transform
  const transform = typeof raw === 'function' ? raw : raw?.handler
  expect(transform?.('body {}', '/src/style.css', {})).toBeNull()
})
```

## Pattern 2: `generateBundle` hook

Build a minimal fake `bundle` object containing only the entries your
assertions need. `generateBundle` **mutates `bundle` in place** — the return
value is ignored by Vite. Assert on bundle state after the call.

**Key gotchas:**
- Call the hook with `.call(context, options, bundle)` so `this.emitFile` and
  other plugin-context methods are available. Provide `vi.fn()` stubs for the
  methods the plugin actually calls; you don't need to stub the full context.
- Import output types from the bundler your Vite version uses:
  - Vite 7 (Rollup-based): `import type { OutputBundle, OutputChunk } from 'rollup'`
  - Vite 8+ / rolldown-vite: `import type { OutputBundle, OutputChunk } from 'rolldown'`
- Only fill in the chunk fields your plugin reads. A minimal chunk needs
  `type: 'chunk'`, `fileName`, and `code`; add more only as needed.

```ts
it('rewrites import paths in output chunks', () => {
  const plugin = myPlugin()
  const generateBundle = plugin.generateBundle as Function
  const ctx = { emitFile: vi.fn() }  // add other vi.fn() stubs as needed

  const bundle = {
    'output.js': { type: 'chunk', fileName: 'output.js', code: "import './dep.js'" },
  }

  generateBundle.call(ctx, {}, bundle)

  expect(bundle['output.js'].code).toContain("import './dep'")
})
```

## Pattern 3: `configureServer` hook

Build a minimal fake `ViteDevServer` with only the surface the plugin touches.
Stub `middlewares.use` and `httpServer.on` with `vi.fn()`, then inspect what
was registered and invoke the handlers yourself.

**Key gotchas:**
- `configureServer` may **return a function** (the post-hook, which Vite calls
  after its own internal middleware). Always capture the return value and invoke
  it if present before asserting:
  ```ts
  const postHook = await configureServer(fakeServer)
  if (typeof postHook === 'function') await postHook()
  ```
- `middlewares.use` accepts both `use(handler)` and `use(path, handler)`. When
  extracting the registered handler, check which signature was used:
  ```ts
  const args = useMock.mock.calls[0]
  const handler = typeof args[0] === 'function' ? args[0] : args[1]
  ```
- Fake only what the plugin accesses. A plugin that only calls
  `server.middlewares.use(fn)` doesn't need a fake `httpServer`.

```ts
it('registers a middleware and handles /my-route', async () => {
  const plugin = myPlugin()
  const fakeServer = {
    middlewares: { use: vi.fn() },
  }

  const postHook = await (plugin.configureServer as Function)(fakeServer)
  if (typeof postHook === 'function') await postHook()

  expect(fakeServer.middlewares.use).toHaveBeenCalledOnce()

  const args = fakeServer.middlewares.use.mock.calls[0]
  const handler = typeof args[0] === 'function' ? args[0] : args[1]

  const req = { url: '/my-route', method: 'GET', headers: {} }
  const res = { writeHead: vi.fn(), end: vi.fn() }
  const next = vi.fn()

  await handler(req, res, next)

  expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
  expect(next).not.toHaveBeenCalled()
})
```

## Mocking heavy dependencies

Use `vi.hoisted()` when a mock must be hoisted above module imports. Use
`memfs` to replace `fs` operations without touching disk:

```ts
vi.mock('node:fs/promises', async () => {
  const { createFsFromVolume, Volume } = await import('memfs')
  const vol = new Volume()
  vol.fromJSON({ '/project/package.json': JSON.stringify({ name: 'my-app' }) })
  return createFsFromVolume(vol).promises
})
```

## File placement

Follow the project's existing convention. Common patterns:

```
src/vite/plugins/myPlugin.ts
src/vite/__tests__/myPlugin.test.ts   ← co-located __tests__ directory
src/vite/plugins/myPlugin.test.ts     ← alongside source
```
