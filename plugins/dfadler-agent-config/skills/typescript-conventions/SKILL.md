---
name: typescript-conventions
description: |
  TypeScript/JS conventions: when to avoid a type assertion (`as Foo`,
  `as unknown as Foo`, `as any`, the non-null `!` operator) in favor of
  narrowing, boundary validation, or fixing the source type; and which
  comment form (`//`, inline `/* … */`, a starred multi-line `/* … */`
  block, or JSDoc `/** … */`) fits a given comment's role. Use when writing,
  reviewing, or editing TypeScript or JavaScript code — a `.ts`/`.tsx`/
  `.js`/`.jsx` file, a type assertion or `@typescript-eslint/
  consistent-type-assertions`/`no-non-null-assertion` question, or a
  question about which comment syntax to use in JS/TS.
metadata:
  version: "1.0.0"
---

# TypeScript and JS/TS Conventions

## Avoid type assertions

Enable `@typescript-eslint/no-explicit-any`, `consistent-type-assertions` (with
`assertionStyle: "never"` — the default `"as"` setting only standardizes
assertion syntax, it doesn't ban assertions), and `no-non-null-assertion` —
together they diagnose every form below. Don't write a type assertion
(`as Foo`, `as unknown as Foo`, or `as any`) or a non-null assertion (`!`) —
the enabled rules flag both. An assertion silences the compiler instead of
proving the claim, so a wrong one becomes a runtime bug the types said
couldn't happen.
When one is genuinely needed, prefer, in order: **narrow** with a type guard,
**validate** at the boundary (a schema/parse), **fix the source** type or
generic. `as const` is always fine — `consistent-type-assertions` exempts it
even under `"never"`.

With those rules enabled, treat a genuinely unavoidable assertion the same way: a
single-line disable directly above it with a comment stating why it's sound and why
no type-safe path exists — never a bare disable, and never at file/block scope. A
project with its own fix-ladder doc (narrow → validate → fix-source, with concrete
examples) takes precedence over this generic version.

## Comment syntax

Pick the comment form by what the comment is doing, not by habit:

- **`//`** — standalone single-line comments; the default for ordinary one-liners.
- **`/* … */` inline** — a note embedded *within* a line that runs, so the code
  continues after it: `document.querySelector(/* nullable */ '.card')`, `fn(a, /* retries */ 3, cb)`.
- **`/* … */` multi-line (starred block)** — a standalone note spanning multiple lines
  that is *not* documenting the declaration it precedes (a rationale, module overview,
  workaround explanation): aligned leading `*` on each line, never a stack of `//` lines:

  ```ts
  /*
   * Colons/dots aren't filesystem- or URL-friendly; a flattened ISO timestamp
   * stays human-readable and lexically sortable.
   */
  ```

- **`/** … */` JSDoc** — a multi-line comment that documents the function, type, or
  export it directly precedes:

  ```ts
  /**
   * Converts Markdown into the target rich-text shape.
   * Fences must be triple-backtick at the start of the line.
   */
  function markdownToPost(md: string) { /* … */ }
  ```

The "no stacked `//`" half is mechanically checkable via
`@stylistic/multiline-comment-style` if a project's ESLint config enables it — that
rule can't tell starred block from JSDoc apart, so which multi-line form fits stays a
judgment call either way.
