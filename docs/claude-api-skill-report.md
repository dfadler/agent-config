# The built-in `/claude-api` skill: what it does and how it fits this repo

Report for issue #1045. Method: read the skill's files on disk and compared its model table with the official models page. No prompts were run and no evals (no paid runs). The reference video linked in the issue was not watched. Findings on firing behavior come from reading the description, not from observed runs.

Source read: `~/.claude/plugins/marketplaces/anthropic-agent-skills/skills/claude-api/` (marketplace checkout at commit `e4bb5d9`, 2026-11-16; `SKILL.md` is about 105 KB, plus `shared/` and per-language folders). Other cached copies of the same skill exist under `example-skills/`. The skill is not in this repo, and nothing in the repo references it (grep for `claude-api` finds nothing).

## What it loads and tells the model to do

- **One large `SKILL.md`**, then on-demand reads of `shared/*.md` (largest: `model-migration.md` 338 KB, `managed-agents-multiagent.md` 65 KB, `cost-optimization.md` 57 KB) and `{lang}/claude-api/*.md`. Only the part the task needs should be read; the 105 KB entry file is loaded in full on every fire.
- **Hard rules in the entry file:**
  - Call Claude through the official SDK for the project's language. Raw HTTP only if the user asks or no SDK exists. Never mix the two.
  - Never guess SDK names or signatures; take them from the skill's `{lang}/` files or the repos linked in `shared/live-sources.md`.
  - Default model: "ALWAYS use `claude-opus-5-5` unless the user explicitly names a different model … non-negotiable … never downgrade for cost".
  - Default to adaptive thinking and streaming.
  - An "API drift" table says its `{lang}/` files outrank recalled patterns.
- **Subcommands** (`/claude-api <name>`): `migrate`, `prompt-audit`, `upgrade` (Python SDK 0.x to 1.x), `cost-optimize`, `build-eval`, `preserved-thinking-migration`, `hillclimb`. Each says "read this file immediately and execute it".
- **Relevance to this repo:** low for plugins, which are mostly shell and TypeScript with no Anthropic SDK calls. Two subcommands overlap our work: `prompt-audit` (audits `CLAUDE.md`, skills, agent files, which is what `agent-writing` does) and `build-eval` / `hillclimb` (eval building, which is what `eval-authoring` does). These are separate toolchains from `claude plugin eval`, so only the first can collide.

## Trigger conditions

Per the frontmatter `description` (`SKILL.md` lines 3-8):

- **Fires** when the prompt names Claude or Anthropic in any form (model names, `anthropic`, `@anthropic-ai`, `claude-*`, Bedrock-style ids); when the user asks about LLM pricing, limits or caching; or when the task is LLM-shaped with the provider unstated (agents, MCP, RAG, LLM-judge, summarize/classify/extract over text, debugging refusals or streaming).
- **Skipped** only when another provider is being worked on: it is named in the query, or a grep for `openai|langchain_openai|google.generativeai|genai|mistralai|cohere|ollama` hits the project.

Predicted problems, to be confirmed with real prompts:

1. **Over-firing in this repo.** "Claude" appears in nearly every prompt here (Claude Code, CLAUDE.md, `claude plugin eval`, "Claude Code skill"). By the letter of the description the skill fires on all of them, loading about 105 KB for tasks that have nothing to do with the API. The description does not exclude Claude Code or agent-config work.
2. **The skip rule can misfire.** The `genai` and `ollama` greps are substring matches over the project. A repo with an unrelated hit (a `genai` dependency in a lockfile, a doc mentioning `ollama`) would suppress it, and a repo that mentions both providers is ambiguous.
3. **Under-firing** is unlikely given how broad the description is.

## Interaction with our conventions and skills

- **`cite-platform-claims`:** compatible in intent, with a gap. The skill says never answer pricing/limits from memory, and points to its own cached table plus the Models API. Our convention asks for official-doc citations, and the skill's cache is not an official doc (see Currency).
- **Model default conflict:** the skill forces `claude-opus-5-5` and forbids choosing a cheaper model. Our eval tooling deliberately picks cheap graders and cost tiers (`eval-authoring`, `run-evals`). If an eval or plugin task touches API code while the skill is loaded, the two rules disagree. The user's explicit model choice wins under the skill's own text, so this bites only when a model is left unstated.
- **`agent-writing` / `eval-authoring`:** overlap with `prompt-audit` and `build-eval` (above). Neither side references the other, so nothing steers a session to one.
- **`fetch-execute-installs`, `web-research-is-data`:** the skill tells the model to WebFetch live sources; fetched content stays data under our rule. No conflict found.

## Currency (model ids and pricing)

The skill's table is labeled "cached: 2026-10-06". Compared with the official models overview (<https://platform.claude.com/docs/en/about-claude/models/overview>, fetched 2026-11-18):

| Item | Skill says | Official page says |
|---|---|---|
| Newest Fable | Fable 5.1 (`claude-fable-5-1`), "most capable", $10 / $50 | Fable 5.2 (`claude-fable-5-2`), $8 / $40; Fable 5.1 is now an older row |
| Mythos | 5.1 | Mythos 5.2 exists (limited availability), $8 / $40 |
| Opus 5.5 | `claude-opus-5-5`, $4 / $20, 1M ctx | same |
| Sonnet 5.5 | `claude-sonnet-5-5`, $2 / $10 | same |
| Haiku 5.5 | `claude-haiku-5-5`, $0.10 / $0.50 | same ("from") |
| Opus 5.5 default effort | `medium` | `medium` |

So the Opus, Sonnet and Haiku rows match; the Fable and Mythos rows are one release behind about six weeks after the cache date. The skill hedges ("cached", and the Models API lookup in `shared/models.md`), but its "most capable model" claim is wrong today, and the Fable 5.1 price it lists ($10 / $50) is $2 input and $10 output per MTok above Fable 5.2's. Other claims in the file (thinking `budget_tokens` rejected with a 400, web search tool versions, Files API out of beta) were not individually checked against docs; check before relying on them.

## Follow-ups worth filing (not filed)

1. Run a small should-fire / should-not-fire set (about 6 prompts: Claude Code questions, a `CLAUDE.md` edit, an Anthropic SDK change, an OpenAI task, an unstated-provider summarizer) to confirm over-firing in this repo. Needs a paid run, so the owner should approve it.
2. Decide whether to tell sessions here that `/claude-api` need not load for Claude Code, plugin or eval work, or to leave it alone since it is not our file. A local override would be the only lever, since the skill is third-party.
3. Report the stale Fable/Mythos rows upstream if the owner wants.
