---
name: project-standards
description: |
  Project standards from bulletproof-react: ESLint/Prettier/TypeScript config,
  absolute imports, pre-commit hooks, and CI conventions. Use when setting up
  tooling for a React project or reviewing its lint/format/type configuration.
license: MIT
metadata:
  version: "0.1.0"
---

> Adapted from [bulletproof-react](https://github.com/alan2207/bulletproof-react) @ [`9506629`](https://github.com/alan2207/bulletproof-react/commit/9506629ed003a561c6627735480cce4994244bb4), MIT licensed. See ../../NOTICE.md for provenance and the re-pin workflow.

# ⚙️ Project Standards

Enforce these standards when setting up or reviewing a React project's tooling — they keep the codebase clean, consistent, and scalable as it grows.

## ESLint

Configure rules in `.eslintrc.js` to catch common errors and enforce coding standards early, before they turn into bugs. This also keeps coding practices uniform across the codebase, which improves overall quality and readability.

[ESLint Configuration Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/.eslintrc.cjs)

## Prettier

Enable "format on save" in the IDE so code is automatically formatted per the `.prettierrc` config — this keeps code style uniform across the codebase. Treat a failed auto-format as a signal of a likely syntax error. Integrate Prettier with ESLint so formatting and standards enforcement happen together throughout development.

[Prettier Configuration Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/.prettierrc)

## TypeScript

ESLint catches language-related bugs in JavaScript, but JavaScript's dynamic nature means it can miss runtime data issues, especially in complex projects — recommend TypeScript to close that gap. When doing a large refactor, update type declarations first, then resolve the TypeScript errors that surface throughout the project — this surfaces issues that would otherwise go unnoticed. Note that TypeScript increases development confidence via build-time type checking, but it does not prevent runtime failures. See this [great resource on using TypeScript with React](https://react-typescript-cheatsheet.netlify.app/).

## Husky

Use Husky to run git hooks — lint, format, and type checks — before each commit, so faulty commits never reach the repository. See [how to configure it here](https://typicode.github.io/husky/#/?id=usage).

## Absolute imports

Always configure and use absolute imports: they make it easy to move files around without breaking messy relative paths like `../../../component` — wherever a file moves, its imports stay intact. Configure it like this:

For JavaScript (`jsconfig.json`) projects:

```json
"compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
```

For TypeScript (`tsconfig.json`) projects:

```json
"compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
```

You can define multiple paths for different folders (`@components`, `@hooks`, etc.), but prefer a single `@/*` — it's short enough that you don't need multiple paths configured, and it's visually distinct from `node_modules` imports, so there's no confusion about what's a dependency versus what's your own source. With this in place, anything under `src` is reachable via `@`: a file at `src/components/my-component` becomes `@/components/my-component` instead of `../../../components/my-component`.

## File naming conventions

Enforce file and folder naming conventions to keep the codebase consistent and easy to navigate — for example, require all files to use `kebab-case`.

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
