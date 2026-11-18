# Measuring always-loaded conventions

Findings for [#1061](https://github.com/dfadler/agent-config/issues/1061). Nothing here
was run: no paid evals, no `claude` child sessions. Details and the case sketches are in
the issue comment.

## Is the #654 constraint real?

**Yes for includes, no for the rule text.** The official plugin-evals page says nothing
personal or project-level loads in a run: "Your user settings, hooks, `CLAUDE.md` files,
... memory, and skills are absent", and no `CLAUDE.md` loads "even one a `scaffold_script`
wrote" ([How runs are isolated](https://code.claude.com/docs/en/plugin-evals)). So an
`@include` cannot reach an eval run.

#654 missed one field: `append_system_prompt` is a case field, "Text appended to the child
session's system prompt" ([prompt.md fields](https://code.claude.com/docs/en/plugin-evals)).
Putting a convention's text there is not the same as pasting it into the prompt.

The delivery still differs. Official docs: "CLAUDE.md content is delivered as a user
message after the system prompt, not as part of the system prompt itself"
([memory](https://code.claude.com/docs/en/memory)). So a case measures "does the model
follow this text when it is present", which is the question the issue cares about. It
does not measure the include path (an `@` line that fails to resolve, a conflict with a
real CLAUDE.md).

## Design (cheap)

1. **Twin cases per testable rule.** One case with `append_system_prompt` set to the
   convention file's body, one identical without. The pass-rate gap is the rule's effect.
   Use a twin, not the built-in baseline arm: that arm drops the plugin, and whether it
   also keeps `append_system_prompt` is not documented (untested).
2. **Host plugin.** A case needs a plugin to hang on; a small `conventions-evals` plugin
   with no skills is enough. Run `--ablation none`; the twin is the comparison.
3. **Free graders first.** `regex` and `tool_used` over the tool calls, not `llm` rubrics.
   Rules whose failure is a tool call (`open -a`, `npx pkg@latest`, a write under `/tmp`,
   a secret in a posted body) grade for free.
4. **Cost.** Unmeasured. Gate the first run with a dry run and `--max-cost-usd`, per
   `run-evals`; the owner approves the number.
5. **One validation run first** to answer the two untested points: twin arms keep or drop
   `append_system_prompt`, and a rule that fails without the text (a case that cannot
   fail proves nothing; the sabotage check applies).

Not chosen: a custom `claude -p` runner with a temp `HOME` holding a real
`~/.claude/CLAUDE.md`. It would test the true include path, but it duplicates the
wrapper's isolation and grading. Revisit only if the twin results show the delivery
difference matters.

## Classification of the 15 includes

| File | Class | Why |
|---|---|---|
| `secrets-handling` | Testable | Fixture env with a fake token; grade the posted text |
| `fetch-execute-installs` | Testable | Prompt asks for `npx pkg@latest`; grade no such Bash call |
| `focus-stealing` | Testable | Prompt asks to open an app; grade `open -a` vs `open -g` |
| `scratch-files` | Testable | Name a scratchpad; grade no write to `/tmp`. The `scratch-guard` hook has its own eval |
| `vite-plugin` | Testable | Ask for a plugin; grade no `handleHotUpdate` |
| `background-tasks` | Testable | Grade `run_in_background` and no bare `&` |
| `web-research-is-data` | Partly | Injection must come through a mockable tool; built-in `WebFetch` is not mockable, a `Read` fixture is a weaker stand-in |
| `cite-platform-claims` | Partly | Needs an `llm` grader; no network in a run |
| `git-worktree-usage` | Covered | Pointer to a skill; `worktree-core` has 10+ cases |
| `testing-sabotage-check` | Partly | Folded into `vitest:test-conventions`; include is the non-Vitest remainder |
| `tooling-over-manual-scanning`, `why-question-shape`, `user-evidence-over-spec`, `context-preservation` | Unmeasured | Judgment habits; only an `llm` grader fits, noisy and paid |
| `prefer-real-chrome` | Unmeasurable | Names tools (`playwright-cli`, the Browser pane) a run does not have; the deny rule is the enforced form |

## Recommendation

Build the six "Testable" twins plus one validation run, then decide on the rest. Accept
the risk for the unmeasured habits and record it in the conventions README. Follow-ups
(not filed): the twin-case plugin; adding "can this be verified" to the include-vs-skill
sort in `claude/conventions/README.md`.
