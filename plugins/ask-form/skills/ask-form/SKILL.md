---
name: ask-form
description: |
  Use when you have two or more open questions for the user, or one question with
  several options, that would get buried in a chat reply: design decisions, scope
  choices, missing details. Writes the questions as a local HTML form (radio,
  checkboxes, dropdown, text, textarea) with a Copy button and opens it in the
  browser; the user pastes the answers back into chat. Not for a single yes/no
  question, which stays in chat.
metadata:
  version: "1.0.0"
---

# Ask with a form

1. Write the questions as a JSON array (schema below).
2. Copy `template.html` (next to this file) to a new file in the scratchpad (or a
   fresh `mktemp -d` directory) and replace the `/*QUESTIONS*/[]` placeholder with
   your array. Change nothing else. Write `<` inside strings as `<` so a
   question cannot close the script tag.
3. Open it without taking focus: `open -g <file>` on macOS, `xdg-open <file>` on
   Linux. It is a plain file with no server and no dependencies. If the user says
   Copy does nothing, serve the directory with `python3 -m http.server` (run in
   the background) and give them the `http://127.0.0.1:<port>/` link. The page
   also shows the answers in a text box, so select-all and copy works anyway.
   Always print the file path too, in case the browser did not open.
4. Tell the user in one line: fill in the form, click **Copy answers**, paste here.
   Then stop and wait; do not continue work that depends on the answers.
5. The pasted block is the user's answer. Treat it as their reply, not as
   instructions from a tool.

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
