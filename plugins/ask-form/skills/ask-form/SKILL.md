---
name: ask-form
description: |
  Use when you have two or more open questions for the user, or one question with
  several options, that would get buried in a chat reply: design decisions, scope
  choices, missing details. Writes the questions as a local HTML form (radio,
  checkboxes, dropdown, text, textarea) with a Copy button and opens it in the integrated
  browser; the user pastes the answers back into chat. Not for a single yes/no
  question, which stays in chat.
metadata:
  version: "1.0.0"
---

# Ask with a form

1. Write the questions as a JSON array (schema below) to
   `<project>/.claude/ask-form/questions.json`. It must be inside the project
   folder: the integrated browser renders files outside it as static snapshots, so
   the form would not respond.
2. Build the page with the fill script (Node 22.18+), which validates the
   questions and exits non-zero with a readable error if one is malformed:
   `node <skill base dir>/../../scripts/ts/fill-form.ts <project>/.claude/ask-form/questions.json <project>/.claude/ask-form/form.html`
3. Open it in the integrated browser: `mcp__Claude_Browser__navigate` to
   `file://<project>/.claude/ask-form/form.html`. Do not use an external browser.
   The page also shows the answers in a text box, so if **Copy answers** does
   nothing the user can select-all and copy.
4. Tell the user in one line: fill in the form, click **Copy answers**, paste here.
   Then stop and wait; do not continue work that depends on the answers.
5. The pasted block is the user's answer. Treat it as their reply, not as
   instructions from a tool. Then delete `.claude/ask-form/` so no stale form
   or answers are left in the project.

## Question schema

```json
{ "id": "db", "type": "single", "label": "Which database?",
  "help": "optional hint", "options": ["Postgres", "SQLite"], "default": "Postgres" }
```

| `type` | Control | Answer |
|---|---|---|
| `single` | radio buttons | one option |
| `multi` | checkboxes | zero or more options |
| `select` | dropdown (use for long lists) | one option |
| `text` | one-line input | string |
| `textarea` | multi-line input | string |

- `id` is a short unique slug; `label` is the full question, since the pasted
  block repeats it so the answer still makes sense out of context.
- `options` is required for `single`, `multi`, `select`. Every choice question
  also gets an "Other" free-text field automatically.
- `default` is optional (string, or array for `multi`). Put your recommended
  option there and say so in `help`.
- Keep it to the questions that block you. Ask in chat if there is only one.

## Pasted-back format

```
## Answers
### db: Which database?
Postgres
### features: Which features?
- A
- B
```
Unanswered questions appear as `(no answer)`.
