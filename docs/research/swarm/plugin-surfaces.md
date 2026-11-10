# Plugin surfaces: .mcp.json, userConfig, validate and the dev loop

Research for #1080 (part of #1071). Researched 2026-11-10 against Claude Code 2.1.321.
Sources: official docs at code.claude.com and `claude ... --help` output from the installed CLI.
Fetched doc text is treated as data. Anything not stated by a source is marked UNCONFIRMED.

Doc URLs (short names used below):
- MANIFEST = https://code.claude.com/docs/en/plugins/manifest-reference.md (also served at /docs/en/plugins-reference)
- MCP = https://code.claude.com/docs/en/mcp.md#plugin-provided-mcp-servers
- LOADING = https://code.claude.com/docs/en/plugins/loading.md
- CLI = https://code.claude.com/docs/en/plugins/cli-reference.md
- MODS = https://code.claude.com/docs/en/plugins/mods/reference.md
- ENV = https://code.claude.com/docs/en/env-vars.md

## Headline: can a structured worker list live in userConfig?

No for structured (object) entries. Yes, only as a flat list of strings.

- MANIFEST "User configuration": `type` is one of `string`, `number`, `boolean`, `directory`, `file`. There is no `list` or `object` type.
- `default` may be "a string, number, boolean, or array of strings". `multiple` "for `string`, allows an array of strings".
- Each option is a strict object; "An unknown key fails validation". So no nested schema.
- Consequence: a worker list of `{name, host, ...}` objects cannot be declared. A `multiple` string field could carry encoded entries (for example `name=host`), parsed by the consumer. Whether a `multiple` value substitutes into `args`/`env` as a joined string, repeated args, or JSON is UNCONFIRMED (the docs do not say). Test with a real plugin before relying on it.
- `multiple` lists and `sensitive` options get no row in `/config` (MANIFEST). They are prompted when the plugin is enabled.
- The map's choice of an inventory file stands.

## .mcp.json shape

- Location: `.mcp.json` at plugin root, or inline `mcpServers` in plugin.json (MCP; MANIFEST "Standard layout").
- Documented example (MCP) wraps servers in `mcpServers`:
  `{"mcpServers": {"database-tools": {"command": "${CLAUDE_PLUGIN_ROOT}/servers/db-server", "args": ["--config", "${CLAUDE_PLUGIN_ROOT}/config.json"], "env": {"DB_URL": "${DB_URL}"}}}}`
- A form without the `mcpServers` wrapper: UNCONFIRMED (not shown in MCP or MANIFEST).
- Local evidence: this repo's only `.mcp.json` files are lint fixtures, e.g. `plugins/eval-authoring/tests/lint-fixtures/EVAL013/good-case-yaml/.mcp.json` uses `{"mcpServers": {"tracker": {"command": "tracker-server"}}}`. No shipping plugin under `plugins/` declares `userConfig` or `${user_config.*}` (grep found none).
- `mcpServers` in plugin.json also accepts a `.json` path, `.mcpb`/`.dxt` bundle, URL, or array. `.mcp.json` loads first, then declared shapes; a later server name replaces an earlier one (MANIFEST).
- Substitution in stdio servers: `command`, `args`, `env`. In http/sse/ws: `url`, `headers`, `headersHelper` (MCP).
- Process env exported to stdio servers: `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_PROJECT_DIR` (MANIFEST "Where each variable resolves"). `CLAUDE_PLUGIN_OPTION_<KEY>` is documented as exported to hook processes only.

## userConfig reaching an MCP server's env

- MANIFEST "Reference a saved value": `${user_config.KEY}` is "substituted in MCP server config, LSP server config, exec-form hook `args`, and skill and agent content".
- Sensitive values reach MCP `env`: the MANIFEST "Channels" example puts a `sensitive: true` `bot_token` into `"env": {"BOT_TOKEN": "${user_config.bot_token}"}`. That example is a channel-bound server with channel-scoped userConfig; the docs show no equivalent example for top-level userConfig, but the substitution rule above names MCP server config with no sensitive exception. Treat top-level sensitive-to-env as documented by rule, not by example.
- Storage: non-sensitive in `pluginConfigs` in settings.json; sensitive in the platform credential store (MANIFEST "Where values are stored").
- `claude plugin validate` errors on a `${user_config.KEY}` reference to an undeclared option (v2.1.281+).
- Set values from a script: `claude plugin configure <plugin> --values-stdin` reads "option values from stdin as a JSON object of single-line strings; options left out keep their values" (CLI help, 2.1.321). Whether non-string options (boolean, multiple) can be set that way is UNCONFIRMED.

## Variables in skill text and Bash commands

- Skill, command, agent content: `${...}` resolves "anywhere in the Markdown body"; only non-sensitive `${user_config.*}` values substitute, "a sensitive value there becomes a placeholder" (MANIFEST).
- Bash tool: path variables "aren't present in the environment of commands Claude runs through the Bash tool, in the main session or in a subagent"; write the reference in the Markdown body and it is substituted inline when content loads (MANIFEST "Where each variable resolves"). Whether `${user_config.*}` typed directly in a Bash-tool command (not from skill text) is substituted: UNCONFIRMED, presumably not.
- Shell-form hook commands, monitor commands and MCP `headersHelper` reject `${user_config.*}` and fail with an error. Use exec-form hook `args` or `CLAUDE_PLUGIN_OPTION_<KEY>` (MANIFEST "Fields that run through a shell").

## hooks/hooks.json modules (mods)

- MODS "Files": `hooks/hooks.json` is required and holds `modules`, "an array with one path, relative to this file, to the hooks module, as in `"modules": ["./register.js"]`. Can also hold settings hooks under `hooks`."
- The module exports `register(on, options)`; `options` holds the `userConfig` values with defaults filled in. Extensions `.js .mjs .cjs .jsx .ts .mts .cts .tsx`; an ES module.
- Not checked: whether any plugin in this repo uses `modules` in hooks.json (UNCONFIRMED).
- Same-name plugins: only one copy's hooks module loads (LOADING "Hooks when two enabled plugins share a name"; v2.1.296+).

## claude plugin validate

Help output (claude 2.1.321):
```
Usage: claude plugin validate [options] <path>
Validate a plugin or marketplace manifest, or the skills, agents, and commands in a directory
  --json            Output the validation report as JSON (same exit codes)
  --profile <name>  Also exit 1 when the plugin directory ... would refuse a submission ... (choices: "directory")
  --strict          Treat warnings as errors (exit 1).
```
- Exit codes: 0 success, 1 failure, 2 unexpected error (CLI "claude plugin commands").
- Checks `.mcp.json`/inline MCP entries (v2.1.281+): errors for entries Claude Code would drop, undeclared `${user_config.KEY}`, invalid remote `url`; warnings for non-loopback `http://`/`ws://` and literal-credential-looking headers (MANIFEST "Validate the manifest").
- Unknown top-level plugin.json key: stripped plus warning. Unknown key inside a `userConfig` option: error, plugin does not load (MANIFEST "Unrecognized fields").
- `claude plugin init --with` accepts `skills agents hooks mcp lsp output-style channel` (help, 2.1.321).

## Dev loop

- `claude --plugin-dir <path>` loads a directory or `.zip` for one session, repeatable, one path per flag; plugin appears as `<name>@inline` (CLI "Flags that load a plugin for one session").
- `CLAUDE_CODE_PLUGIN_DIRS`: "Separate multiple paths with `:` on Unix or `;` on Windows. Give each path as an absolute path or start it with `~`, because Claude Code skips relative paths. Requires Claude Code v2.1.280 or later." (ENV). Loaded like `--plugin-dir`.
- A session-only plugin shadows an installed same-name plugin (LOADING "Name conflicts").
- `--plugin-dir` and skills-dir plugins load in place, never copied (LOADING "In-place and copied plugins").
- `/reload-plugins [--force]` applies plugin changes (including edits on disk) without restart and prints `Reloaded: N plugins · N skills · N agents · N hooks · N plugin MCP servers · N plugin LSP servers`. If the reload adds or removes an MCP server and would break the prompt cache, it refuses unless `--force` (CLI "/reload-plugins").
- MCP servers with unchanged config keep their live connections across reload (MCP "Automatic lifecycle").
- In sessions without an interactive terminal (desktop app, Agent SDK, `-p`), reload does not connect or disconnect plugin MCP servers; that takes effect next session (CLI; MCP). Relevant to the Desktop controller.
- Repo-local fact: `setup.sh` symlinks `plugins/<name>` into `~/.claude/skills/<name>` so plugins load as `<name>@skills-dir` from the working copy (`docs/plugin-loading.md`).
- A project-scope plugin's MCP servers go through the per-server approval of a project `.mcp.json`; bundle or outside-directory servers are skipped (LOADING "Trust check and component limits").

## Plugin name restrictions

MANIFEST "name": non-empty; no spaces, `@`, `:`, path separators, control or bidi characters; kebab-case advised. `claude plugin validate` errors on names starting `claude-`, `anthropic-`, `anthropics-`, `cc-plugin-`, on `claude`, `anthropic`, `anthropics`, `claude-code`, `claude-mods`, and on `official` beside `claude`/`anthropic`. It warns when `claude`/`anthropic`/`anthropics` is a whole word elsewhere (for example `mcp-for-claude`). Origin names `inline`, `skills-dir`, `synced` are reserved for marketplaces (LOADING).

## Unconfirmed

1. How a `multiple` userConfig value is rendered when substituted into `args`/`env`.
2. Whether `.mcp.json` is accepted without the `mcpServers` wrapper.
3. Whether `${user_config.*}` in a literal Bash-tool command is substituted.
4. Whether `plugin configure --values-stdin` can set `multiple`/boolean/number options.
5. Whether any plugin in this repo uses `modules` in hooks.json (not checked).
6. anthropics/claude-code CHANGELOG and issues were not consulted; the docs answered the key question.
