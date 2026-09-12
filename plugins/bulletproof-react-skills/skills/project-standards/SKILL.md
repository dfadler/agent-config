---
name: project-standards
description: |
  Project standards from bulletproof-react: ESLint/Prettier/TypeScript config,
  absolute imports, pre-commit hooks, and CI conventions. Use when setting up
  tooling for a React project or reviewing its lint/format/type configuration.
  Reach for this whenever asked to "set up linting for a new React project,"
  "configure absolute imports so I stop seeing ../../../," "add a pre-commit
  hook to run lint and type-check," or "review this project's ESLint/Prettier/
  tsconfig setup" — or when enforcing consistent file/folder naming conventions
  across a codebase.
license: MIT
metadata:
  version: "0.1.0"
---

> Adapted from [bulletproof-react](https://github.com/alan2207/bulletproof-react) @ [`9506629`](https://github.com/alan2207/bulletproof-react/commit/9506629ed003a561c6627735480cce4994244bb4), MIT licensed. See ../../NOTICE.md for provenance and the re-pin workflow.

# ⚙️ Project Standards

Enforce these project standards to keep a React codebase clean, consistent, and scalable as it grows — without them, code quality and maintainability degrade as more people touch the project.

## ESLint

Configure rules in `.eslintrc.js` and treat ESLint as your first line of defense against JavaScript errors: it catches mistakes early and enforces uniform coding practices across the codebase, which is what keeps the code correct and readable as the project scales.

[ESLint Configuration Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/.eslintrc.cjs)

## Prettier

Enable "format on save" in the IDE so Prettier auto-formats code against the `.prettierrc` config on every save — this keeps code style uniform across the codebase without manual effort. Treat a failed auto-format as a signal of a syntax error, not a tooling glitch. Integrate Prettier with ESLint so formatting and linting run together as one consistent step in development.

[Prettier Configuration Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/.prettierrc)

## TypeScript

Don't rely on ESLint alone for catching bugs — JavaScript's dynamic nature means ESLint misses runtime data issues, especially in complex projects. Use TypeScript to close that gap and to surface issues during large refactors that would otherwise go unnoticed. When refactoring, update type declarations first, then resolve the TypeScript errors that ripple out across the project — this ordering surfaces the full blast radius of a change instead of missing pieces. Keep in mind TypeScript only checks types at build time; it gives you refactoring confidence, but it does not prevent runtime failures. See this [resource on using TypeScript with React](https://react-typescript-cheatsheet.netlify.app/) for more.

## Husky

Use Husky to run git hooks — lint, format, and type checks — before every commit, so faulty commits never reach the repository in the first place. Configure it as described [here](https://typicode.github.io/husky/#/?id=usage).

## Absolute imports

Always configure and use absolute imports: they let you move files around freely without breaking import paths, and they eliminate messy relative chains like `../../../component`. Configure it as follows:

For JavaScript (`jsconfig.json`) projects:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

For TypeScript (`tsconfig.json`) projects:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

You can define multiple path aliases for individual folders (`@components`, `@hooks`, etc.), but prefer a single `@/*` alias — it's short enough that you don't need to configure multiple paths, and it's visually distinct enough from `node_modules` imports that there's no confusion about what's a dependency versus your own source. With `@/*` mapped to `src`, a file at `src/components/my-component` becomes `@/components/my-component` instead of `../../../components/my-component`.

## File naming conventions

Enforce file and folder naming conventions (e.g., `kebab-case` everywhere) to keep the codebase consistent and easy to navigate — don't leave naming to individual preference.

Enforce it with ESLint:

```js
'check-file/filename-naming-convention': [
  'error',
  {
      '**/*.{ts,tsx}': 'KEBAB_CASE',
  },
  {
      // ignore the middle extensions of the filename to support filename like bable.config.js or smoke.spec.ts
      ignoreMiddleExtensions: true,
  },
],
'check-file/folder-naming-convention': [
  'error',
  {
    // all folders within src (except __tests__)should be named in kebab-case
    'src/**/!(__tests__)': 'KEBAB_CASE',
  },
],
```
