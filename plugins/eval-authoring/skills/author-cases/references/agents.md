# Cases for a plugin's agents

Source: the [plugin-evals docs](https://code.claude.com/docs/en/plugin-evals), "Agent type
... not found" and "How runs are isolated".

- Put `Agent` in the case's `allowed_tools`. Agents are addressed as `plugin:agent`
  (for example `my-plugin:code-reviewer`), so write prompts and any `input_match` regex
  with that form.
- In the no-plugin baseline arm, dispatching the agent fails with `Agent type
  '<plugin>:<agent>' not found`. That is expected, not a bug in the case. To skip the
  baseline, run with `--ablation none` (one arm, no Δ). A case that can only pass with the
  agent cannot show a Δ by design; the with-arm score is the signal.
- A run loads only the plugin under test. Personal settings, `CLAUDE.md`, other plugins,
  memory, user MCP servers and the Artifact tool are absent. Anything the agent calls
  (skills, other agents, hooks, MCP servers) must ship in the same plugin.
- A case's `allowed_tools` cannot grant Bash, Write, Edit, WebFetch or WebSearch; those
  come from `--allow-tools` and `grants.yaml`.
- Grade the dispatch with `tool_used` (`tool: Agent`, `input_match` on the agent name) and
  the result with a `regex` or file check, so a pass shows the agent ran and produced it.
