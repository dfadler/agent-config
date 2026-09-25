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
directly — no need to spin up a full Vite dev server for unit tests. Use Vitest
(`vi.fn()`, `vi.mock()`, `describe`/`it`/`expect`).

## Pattern 1: `transform` hook

Call the hook directly. Assert on the returned `code` or `map`.

```ts
import { describe, it, expect } from 'vitest'
import { myPlugin } from './myPlugin'

describe('myPlugin', () => {
  it('has the correct name', () => {
    const plugin = myPlugin()
    expect(plugin.name).toBe('my-plugin')
  })

  it('transforms matching files', () => {
    const plugin = myPlugin()
    const transform = plugin.transform as Function
    const result = transform('const x = 1', '/path/to/file.ts', {})

    expect(result).not.toBeNull()
    expect(result.code).toContain('/* transformed */')
  })

  it('returns null for non-matching files', () => {
    const plugin = myPlugin()
    const transform = plugin.transform as Function
    const result = transform('body {}', '/path/to/style.css', {})

    expect(result).toBeNull()
  })

  it('skips SSR builds', () => {
    const plugin = myPlugin()
    const transform = plugin.transform as Function
    const result = transform('const x = 1', '/path/to/file.ts', { ssr: true })

    expect(result).toBeNull()
  })
})
```

## Pattern 2: `generateBundle` hook

Build a minimal fake `bundle` object with the entries you need to assert on.
`generateBundle` mutates `bundle` in place; assert on its state after the call.

```ts
import { describe, it, expect } from 'vitest'
import type { OutputBundle, OutputChunk } from 'rolldown'
import { myPlugin } from './myPlugin'

function makeChunk(overrides: Partial<OutputChunk> = {}): OutputChunk {
  return {
    type: 'chunk',
    fileName: 'output.js',
    code: 'export const x = 1',
    imports: [],
    exports: [],
    modules: {},
    moduleIds: [],
    isDynamicEntry: false,
    isEntry: true,
    isImplicitEntry: false,
    facadeModuleId: null,
    name: 'output',
    map: null,
    sourcemapFileName: null,
    preliminaryFileName: 'output.js',
    dynamicImports: [],
    implicitlyLoadedBefore: [],
    referencedFiles: [],
    viteMetadata: undefined,
    ...overrides,
  }
}

describe('myPlugin generateBundle', () => {
  it('rewrites import paths in output chunks', () => {
    const plugin = myPlugin()
    const generateBundle = plugin.generateBundle as Function

    const bundle: OutputBundle = {
      'output.js': makeChunk({
        code: "import './dep.js'",
      }),
    }

    generateBundle({}, bundle)

    expect((bundle['output.js'] as OutputChunk).code).toContain("import './dep'")
  })
})
```

## Pattern 3: `configureServer` hook (fake server)

Build a minimal fake `ViteDevServer` with only the surface the plugin touches.
For `configureServer`, the pattern is:
1. Capture what gets registered on `middlewares.use` and `httpServer.on`
2. Fire those handlers with fabricated request/response objects
3. Assert on the handler's side effects

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ViteDevServer } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { myPlugin } from './myPlugin'

function makeFakeServer(): Pick<ViteDevServer, 'middlewares' | 'httpServer'> {
  return {
    middlewares: {
      use: vi.fn(),
    } as unknown as ViteDevServer['middlewares'],
    httpServer: {
      on: vi.fn(),
    } as unknown as ViteDevServer['httpServer'],
  }
}

function makeFakeRequest(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    url: '/',
    method: 'GET',
    headers: {},
    ...overrides,
  } as IncomingMessage
}

function makeFakeResponse(): Partial<ServerResponse> & { writeHead: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> } {
  return {
    writeHead: vi.fn(),
    setHeader: vi.fn(),
    end: vi.fn(),
  }
}

describe('myPlugin configureServer', () => {
  it('registers middleware on the dev server', async () => {
    const plugin = myPlugin()
    const fakeServer = makeFakeServer()

    const configureServer = plugin.configureServer as Function
    await configureServer(fakeServer)

    expect(fakeServer.middlewares.use).toHaveBeenCalledOnce()
  })

  it('serves /my-route with a 200 response', async () => {
    const plugin = myPlugin()
    const fakeServer = makeFakeServer()

    const configureServer = plugin.configureServer as Function
    await configureServer(fakeServer)

    const [, handler] = (fakeServer.middlewares.use as ReturnType<typeof vi.fn>).mock.calls[0]
    const req = makeFakeRequest({ url: '/my-route' })
    const res = makeFakeResponse()
    const next = vi.fn()

    await handler(req, res, next)

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': expect.any(String) }))
    expect(next).not.toHaveBeenCalled()
  })

  it('calls next() for unhandled routes', async () => {
    const plugin = myPlugin()
    const fakeServer = makeFakeServer()

    const configureServer = plugin.configureServer as Function
    await configureServer(fakeServer)

    const [, handler] = (fakeServer.middlewares.use as ReturnType<typeof vi.fn>).mock.calls[0]
    const req = makeFakeRequest({ url: '/unrelated' })
    const res = makeFakeResponse()
    const next = vi.fn()

    await handler(req, res, next)

    expect(next).toHaveBeenCalledOnce()
  })
})
```

## Mocking heavy dependencies

Use `vi.hoisted()` when a mock must be hoisted above module imports (e.g., mocking
a module whose side effect fires at import time). Use `memfs` to replace `fs`
operations without touching disk:

```ts
import { vi } from 'vitest'
import { createFsFromVolume, Volume } from 'memfs'

vi.mock('node:fs/promises', async () => {
  const vol = new Volume()
  const fs = createFsFromVolume(vol)
  vol.fromJSON({ '/project/package.json': JSON.stringify({ name: 'my-app' }) })
  return fs.promises
})
```

## File placement

Test files live adjacent to the plugin they test, in the project's `__tests__`
directory or with a `.test.ts` suffix:

```
src/vite/plugins/myPlugin.ts
src/vite/__tests__/myPlugin.test.ts   ← preferred
# or
src/vite/plugins/myPlugin.test.ts
```
