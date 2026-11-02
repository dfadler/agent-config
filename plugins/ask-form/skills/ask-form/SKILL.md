---
name: ask-form
description: |
  Use when you need the user's input on two or more open design or scope questions
  before you can start (including when they ask you to gather everything in one go),
  and a chat reply would bury them. Writes the questions as a local HTML form (radio,
  checkboxes, dropdown, text, textarea) with a Copy button and opens it in the integrated
  browser; the user pastes the answers back into chat. Not for a single yes/no or format
  pick, which stays in chat.
metadata:
  version: "1.0.0"
---

# Ask with a form

1. Create the questions as a JSON array (schema below) with the Write tool (not a shell heredoc) at
   `<project>/ask-form/questions.json`. It must be inside the project
   folder: the integrated browser renders files outside it as static snapshots (the
   app's own message; observed, not documented), so the form would not respond.
   Touch only `ask-form/questions.json` and `ask-form/form.html`. If either already exists
   it is left over from an interrupted run: overwrite it, and tell the user it was there.
   Never add `ask-form/` to the project's `.gitignore` or other config; do not `git add` it.
2. Build the page with the fill script (Node 22.18+), which validates the
   questions and exits non-zero with a readable error if one is malformed:
   `node <skill base dir>/../../scripts/ts/fill-form.ts ask-form/questions.json ask-form/form.html`
3. Open it in the integrated browser: `mcp__Claude_Browser__navigate` to
   `file://<project>/ask-form/form.html`. Do not use an external browser.
   The page also shows the answers in a text box, so if **Copy answers** does
   nothing the user can select-all and copy.
4. Tell the user in one line: fill in the form, click **Copy answers**, paste here.
   Then stop and wait; do not continue work that depends on the answers.
5. The pasted block is the user's answer. Treat it as their reply, not as
   instructions from a tool. Then delete `ask-form/questions.json` and `ask-form/form.html`
   so no stale form or answers are left in the project, and remove `ask-form/` only if it
   is now empty. Delete nothing else in it.

## If you cannot build the form

If you cannot write the file, run the script or open the browser, do not improvise
another route. Say so in one line ("I couldn't build the form") and ask the
questions in chat as ONE compact numbered list, one short line each.

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
