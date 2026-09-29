---
name: typescript-gotchas
description: |
  TypeScript/JS gotchas: subtle patterns that compile but cause runtime bugs or
  are better expressed with a safer/clearer API. Use when writing or editing
  TypeScript or JavaScript source files (`.ts`/`.tsx`/`.js`/`.jsx`) that are
  NOT test files (i.e. not `*.test.*`, `*.spec.*`, or files under `__tests__/`
  directories). Triggers on array access, string indexing, or any time you
  would write `[i]` to read from an array or string.
metadata:
  version: "1.0.0"
---

# TypeScript Gotchas

## Prefer `.at()` for array and string indexed reads

When reading an element from an array or string by index, use `.at(i)` instead
of `[i]`. This rule applies to **new source code only** — not test files
(`*.test.*`, `*.spec.*`, `__tests__/`).

### Why

`Array.prototype.at()` / `String.prototype.at()` accept negative indices,
making end-relative access clear and safe without manual arithmetic. The
bracket form with `length - n` arithmetic is easy to get wrong, and utility
functions like `_.last()` add a dependency for something the language now
provides.

### Patterns to avoid and their replacements

| Avoid | Write instead |
|---|---|
| `arr[arr.length - 1]` | `arr.at(-1)` |
| `arr.slice(-1)[0]` | `arr.at(-1)` |
| `str.charAt(str.length - 5)` | `str.at(-5)` |
| `str.substring(i, i + 1)` | `str.at(i)` |
| `_.last(arr)` / `lodash.last(arr)` | `arr.at(-1)` |

### What is NOT flagged

- **Assignment**: `arr[arr.length - 1] = foo` — `.at()` is read-only; bracket
  assignment is the only option and stays as-is.
- **DOM collections** (`.children`, `.childNodes`, `.querySelectorAll()`
  results): these are array-like but lack `.at()` — keep bracket notation.
- **The `arguments` object**: array-like, lacks `.at()` — keep bracket
  notation (prefer rest params anyway).
- **Positive-integer literal access** like `arr[0]`, `arr[1]`: leave these
  alone unless the project explicitly opts into `checkAllIndexAccess`.
- **Dynamic / unknown keys** like `obj[unknownProp]`: out of scope.
