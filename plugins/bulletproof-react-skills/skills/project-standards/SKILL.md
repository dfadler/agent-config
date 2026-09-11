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

Enforce these standards when setting up or reviewing a React project's tooling — they keep the codebase clean, consistent, and scalable as it grows, and catching drift here early is cheaper than untangling it later.

#### ESLint

Configure rules in `.eslintrc.js` and treat ESLint as the first line of defense against common JavaScript errors. It catches mistakes early and enforces uniform coding practices across the codebase, so don't skip configuring it even on a small project — inconsistency compounds as the codebase grows.

[ESLint Configuration Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/.eslintrc.cjs)

#### Prettier

Enable "format on save" in the IDE so code is automatically formatted per the `.prettierrc` config — this keeps style uniform across the codebase without manual effort. Treat a failed auto-format as a signal, not noise: it usually means there's a syntax error to fix. Integrate Prettier with ESLint so formatting and lint enforcement run together instead of as separate, easy-to-skip steps.

[Prettier Configuration Example Code](https://github.com/alan2207/bulletproof-react/blob/9506629ed003a561c6627735480cce4994244bb4/apps/react-vite/.prettierrc)

#### TypeScript

Don't rely on ESLint alone — it catches language-level bugs, but JavaScript's dynamic nature means it misses runtime data issues, especially as a project grows complex. Add TypeScript to close that gap. During a large refactor, update type declarations first, then work through the resulting TypeScript errors across the project — this surfaces breakage that would otherwise go unnoticed until runtime. Keep in mind that TypeScript's type checking happens at build time only: it increases confidence during development but does not prevent runtime failures. See this [resource on using TypeScript with React](https://react-typescript-cheatsheet.netlify.app/) for more.

#### Husky

Wire up Husky to run validations (linting, formatting, type checking) before each commit — this stops faulty commits from reaching the repository instead of catching them after the fact. Configure it as described [here](https://typicode.github.io/husky/#/?id=usage).

#### Absolute imports

Always configure and use absolute imports — they let you move files around freely without breaking import paths, and they avoid messy relative chains like `../../../component`. Set this up:

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

You can define multiple paths for individual folders (e.g. `@components`, `@hooks`), but prefer a single `@/*` alias — it's short enough that you don't need to configure multiple paths, and it's visually distinct from `node_modules` imports so there's no confusion about what's a dependency versus source. With this in place, anything under `src` is reachable via `@`: a file at `src/components/my-component` becomes `@/components/my-component` instead of `../../../components/my-component`.

#### File naming conventions

Enforce file and folder naming conventions in the project rather than leaving them to convention alone — for example, require `kebab-case` for all filenames. This keeps the codebase consistent and easier to navigate.

Enforce it via ESLint:

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
