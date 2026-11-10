# claude -p headless contract, --worktree, permission modes and rules

Research for #1082 (part of #1071). Researched 2026-11-10. Installed CLI: 2.1.321 (`claude --version`).
No `claude -p` run or session was started. `claude --help` output below is from the installed 2.1.321.

Source keys: HEADLESS = https://code.claude.com/docs/en/headless ; MODES = https://code.claude.com/docs/en/permission-modes ;
CLI = https://code.claude.com/docs/en/cli-reference ; WT = https://code.claude.com/docs/en/worktrees ;
LOOP = https://code.claude.com/docs/en/agent-sdk/agent-loop ; TS = https://code.claude.com/docs/en/agent-sdk/typescript ;
CL = https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md ; HELP = `claude --help` (2.1.321).

## 1. stream-json event stream and result message

- `--output-format stream-json` needs `--verbose` (HEADLESS "Stream responses"); `--include-partial-messages` adds `stream_event` token deltas. HELP: stream-json flags "only work with --print".
- Last line is a `result` message (HEADLESS "Stream responses").
- First event is `system/init` (model, tools, `mcp_servers`, `plugins`, optional `plugin_errors`, `mcp_server_errors`, `capabilities`), unless `plugin_install` or hook events (`hook_started` etc.) precede it (HEADLESS "Read session metadata").
- Other documented events: `system/api_retry` (fields `attempt`, `max_retries`, `retry_delay_ms`, `error_status`, `error`, `uuid`, `session_id`); `permission_denied` system messages; `assistant`/`user` messages with `parent_tool_use_id` (null for main conversation; subagent text only with `--forward-subagent-text`) (HEADLESS).
- Result message (TS, `SDKResultMessage`): `type:"result"`, `subtype`, `uuid`, `session_id`, `duration_ms`, `duration_api_ms`, `is_error`, `num_turns`, `stop_reason`, `total_cost_usd`, `usage`, `modelUsage`, `permission_denials`. Success arm adds `result` (and `structured_output` when `--json-schema` yields one); error arm adds `errors: string[]` and optional `startup_failure_reason`.
- Subtypes (LOOP "Handle the result"): `success`, `error_max_turns`, `error_max_budget_usd`, `error_during_execution`, `error_max_structured_output_retries`. `result` text exists only on `success`. All subtypes carry `total_cost_usd`, `usage`, `num_turns`, `session_id`. After a session crash the result is `error_during_execution`, cost fields may be zero, `stop_reason` null.
- `--output-format json` returns the same payload as one object incl. `total_cost_usd` and per-model breakdown; resumed sessions report the whole conversation's total; both are client-side estimates (HEADLESS "Pipe data").

## 2. Exit codes and signals

- Exit 0 on success, non-zero on failure (HEADLESS "Basic usage"). Failures inside the run (e.g. missing auth) print as the result on stdout.
- SIGTERM: exit code 143; in-progress turn left unfinished, no result recorded; process tree of running Bash killed; only `SessionEnd` hooks run (HEADLESS "Stop a run with SIGTERM"). Send SIGINT or SDK `interrupt()` first to end the turn cleanly.
- SIGINT exit code: UNCONFIRMED (docs say only that SIGINT ends the turn).
- Exit code for a run that ends in `error_max_turns` or `error_max_budget_usd`: UNCONFIRMED. Docs describe the subtype, not the process exit status. Branch on `subtype`/`is_error` in the result, not on the exit code.
- Changelog exit-1 fixes: 2.1.319 "`claude -p` exiting 0 in auto mode when its actions were refused because no safety check was available: text and JSON output now exit 1"; earlier entries for exit 1 on startup failure and on lost transcript writes (CL).
- Resume refusals in `-p` (worktree): stderr error plus a `result` with `error_during_execution`, `errors`, and `startup_failure_reason` `worktree_unverified` or `worktree_resume_refused` (WT "The session resumes outside its worktree").

## 3. --max-turns and --max-budget-usd

- `--max-turns`: "Limit the number of agentic turns (print mode only). No limit by default." With stream-json input a queued message starts a new turn with its own limit (CLI).
- Turn counting (LOOP): each tool-call turn counts, plus one for the final text-only reply; hitting the cap gives `error_max_turns` with no final response.
- `--max-budget-usd`: stops once estimated spend reaches the amount; client-side estimate; subagent spend counts; spend can pass the cap (leave headroom); totals restored by `--resume`/`--continue` do not count; once reached, new subagents fail with `Budget limit reached` and background subagents are stopped (v2.1.217+) (CLI). Checked after each model response (LOOP "budget headroom").

## 4. Permissions in -p

- v2.1.302 change (CL 2.1.302, verbatim): "Changed `claude -p` and Agent SDK sessions with no permission mode to start in `default` mode on third-party providers, with telemetry off or on a fresh install; `--permission-mode auto` keeps auto". MODES/HEADLESS state it more broadly: with 2.1.302+, `-p` and SDK runs with no mode set start in Manual (`default`); calls needing approval are denied unless an allow rule, `PermissionRequest` hook, `canUseTool` or `--permission-prompt-tool` approves. Before 2.1.302 some runs could start in auto (MODES). The changelog wording is narrower than the docs; docs describe current behavior.
- HELP lists `--permission-mode` choices: acceptEdits, auto, bypassPermissions, manual, dontAsk, plan (`manual` is accepted alongside `default`, per a CL entry "Changed the 'default' permission mode to 'Manual'").
- `--permission-prompts host|none` (default `host`; v2.1.259+): `none` denies anything that would prompt (unless a `PermissionRequest` hook allows), tells Claude not to retry, removes `AskUserQuestion`, cancels unanswered MCP elicitation. Rules, hooks and mode still decide first. In a `-p` run with no host, requests are denied either way; the flag adds the "do not retry" message. Denials show as `permission_denied` events and in `permission_denials` of the result (HEADLESS; HELP).
- Setting `permissions.denyInsteadOfPrompting` added in 2.1.319 (CL): applies to terminal sessions, subagents, teammates.
- `dontAsk`: denies everything that would prompt; reads in working dirs, read-only commands, allow-rule matches and PreToolUse-approved calls still run; `AskUserQuestion` and explicit `ask` rules are denied (MODES).
- `acceptEdits`: file edits plus common fs commands (mkdir, touch, mv, cp); other shell/network needs allow rules (HEADLESS).

## 5. Allow/deny rule syntax and which modes honour them

- `--allowedTools "Bash(git diff *),Read"`: permission rule syntax; trailing ` *` is prefix match; the space matters (`Bash(git diff*)` also matches `git diff-index`) (HEADLESS "Create a commit"; rule syntax at https://code.claude.com/docs/en/settings-reference.md#permission-rule-syntax).
- Deny rules apply in every mode including `bypassPermissions`; allow rules have no effect in `bypassPermissions` (MODES, "Which modes honor allow and deny rules"). SDK: scoped `disallowedTools: ["Bash(rm *)"]` denies matching calls in every mode; bare `"Bash"` removes the tool from context (TS Options).
- Auto mode drops broad allow rules on entry (`Bash(*)`, `Bash(python*)`, package-manager run commands, `Agent`, `Monitor`); narrow ones like `Bash(npm test)` stay (MODES). A bare `Bash` in `--allowedTools` is dropped in auto (HEADLESS).
- Never auto-approved in any mode: explicit ask-rule tools, `AskUserQuestion`, MCP `requiresUserInteraction`, recognized critical-path `rm`/`rmdir` (no allow rule or hook approves), reads/writes outside working dirs when the `block*OutsideWorkingDirectories` keys are on (MODES "Actions no mode auto-approves").

## 6. Auto mode requirements (MODES "Auto mode requirements")

- All plans; Team/Enterprise admin can disable with `permissions.disableAutoMode: "disable"`.
- Models: Anthropic API / Claude Platform on AWS: Opus 4.6+, Sonnet 4.6+, Haiku 5.5, or a Fable model. Bedrock, Google Agent Platform, Foundry, Claude apps gateway: Sonnet 5+, Opus 4.7+, Haiku 5.5, or Fable. Unsupported everywhere: Sonnet 4.5, Opus 4.5, Haiku 4.5, claude-3.
- CL 2.1.319: with telemetry/feature flags off (including behind LLM gateways), calls the server cannot check are asked about or denied, no fallback to the built-in classifier; `CLAUDE_CODE_AUTO_MODE_SERVER=0` keeps the client classifier. CL 2.1.302 added `CLAUDE_CODE_AUTO_MODE_MODEL` for the client-side classifier model.
- Unattended pairing: `--permission-mode auto --permission-prompts none` (HEADLESS).

## 7. --bare and the planned -p default

- HELP: "Minimal mode: skip hooks (those defined in settings and by installed plugins; features built into Claude Code are unaffected), LSP, plugin sync, attribution, auto-memory, background prefetches, keychain reads, and CLAUDE.md auto-discovery. Sets CLAUDE_CODE_SIMPLE=1. Anthropic auth is ..." (the auth sentence was cut in my capture). CLI row also lists skills, subagents, plugins, MCP servers skipped; tools limited to Bash, file read, file edit.
- Bare never reads OAuth/keychain: needs `ANTHROPIC_API_KEY` or `apiKeyHelper` in `--settings`; Bedrock/Vertex/Foundry creds still work. Hooks passed via `--settings` or a flag-loaded plugin still do not run. No background tasks, no system reminders (v2.1.286+) (HEADLESS "Start faster with bare mode").
- Planned default (HEADLESS NOTE, verbatim): "`--bare` is the recommended mode for scripted and SDK calls, and will become the default for `-p` in a future release." No version or date given; I found no matching changelog entry in CL (searched through 2.1.319). Plan: pass the flag explicitly rather than rely on a default.
- Without `--bare`, `-p` runs project hooks and `.mcp.json` servers even in an untrusted folder, with no trust dialog (HEADLESS).

## 8. --worktree <name> (WT; HELP: `-w, --worktree [name]`)

- Creates `<repo>/.claude/worktrees/<name>/` on new branch `worktree-<name>`; no name gives a generated one (e.g. `bright-running-fox`). Base is the repo default branch on the remote (`worktree.baseRef` "fresh", default) or local HEAD ("head"). `#<n>` or a PR/MR URL branches from that PR at `.claude/worktrees/pr-<number>`.
- `-p` skips the workspace trust check, so `claude -p --worktree` proceeds.
- Cleanup: interactive exit removes a clean unnamed worktree and its branch; otherwise prompts. `-p` has no exit prompt: Claude does NOT clean up, and the creation lock stays until a later session's stale-lock sweep; remove with `git worktree remove` (run `git worktree unlock` first if locked).
- An existing name is reopened, not recreated; with the "fresh" base a clean, commit-less reopened worktree resets to the default branch.
- `--resume`/`--continue` with `-p` re-enter the worktree (since v2.1.212). `--tmux` requires `--worktree` (HELP).

## 9. Agent SDK query() (TS Options)

- `env`: default `process.env`; REPLACES the subprocess environment rather than merging. Keep `PATH` etc. with `env: { ...process.env, YOUR_VAR: "value" }`.
- `settingSources`: default is the CLI default (all sources: user, project, local); `[]` disables user, project and local settings. Managed policy settings load regardless.
- Related: `maxTurns`, `maxBudgetUsd` (same semantics as the CLI flags; budget counts only the current call), `permissionMode` default undefined so `default` unless settings set one; `bypassPermissions` needs `allowDangerouslySkipPermissions: true`.

## Unconfirmed

1. Process exit code for `error_max_turns` / `error_max_budget_usd` in `claude -p`.
2. SIGINT exit code.
3. Version/date for `--bare` becoming the `-p` default.
4. Why CL 2.1.302's wording (third-party/telemetry-off only) is narrower than MODES/HEADLESS ("no mode set" at 2.1.302+).
