# Fixtures and mocks

Source: the [plugin-evals docs](https://code.claude.com/docs/en/plugin-evals), "Set up
fixtures and mocks" and "Mock files".

Each run starts in an empty workspace, so put what the task needs in the prompt, or seed it.
With nothing to read the model tends to hunt the workspace for files, so inline inputs
beat leaving it empty.

## Faking a CLI or fixture files

The supported route is `context.scaffold_script` in a `case.yaml` (needs
`schema_version: "1.1"` and `name`). The script runs in the empty workspace before Claude
starts, as you, outside the sandbox, with a minimal environment and a 120-second limit; a
non-zero exit scores the run 0.

- It runs **only with `--scaffold`**, which is manual opt-in by the user, for suites they
  trust. Never pass it yourself and never put it in a wrapper default.
- Use it for files and git state only. Project configuration it writes (`.claude/`,
  `CLAUDE.md`, `.mcp.json`) is not loaded.
- To stub a CLI, have the script write the stub into the workspace and have the prompt
  call it by relative path (`./bin/tool`). It needs `Bash` in `allowed_tools`, a
  `--allow-tools` grant and a `grants.yaml` entry.
- Keep answers out of reach: the agent can read git history and `add_dirs`, so a script
  that commits a fix or branch, or an `add_dirs` folder with an answer file or `.git`,
  leaks it (EVAL014; Anthropic's agent-evals post reports an agent using earlier trials'
  git history).
- A `fixtures/bin` directory put on `PATH` is **not** supported: do not use it (EVAL014).
- `context.add_dirs` lists case-directory folders Claude may read (read-only).
  `context.history_file` resumes a `.jsonl` transcript; such a case runs one arm by default
  when the target is a path.

## Sandbox limits for `gh` cases

An eval run has no `gh` auth and no network, and a plugin's declared dependencies (for
example `gh-untrusted`) are not installed, so the plugin arm's skill list holds only the
plugin's own skills plus built-ins. A case that reads a live issue or PR ends with the agent
unable to proceed, and a `read_via_skill`-style check for a dependency skill cannot pass.
Stub the read instead: a `scaffold_script` writes `./bin/gh` returning the issue text, the
prompt says "gh in this workspace is `./bin/gh`", and the case is run with `--scaffold` and
`--allow-tools 'Bash(./bin/gh *)'`. Worked example:
`plugins/github-pr/evals/issue-triage-fires-on-backlog-sweep/scaffold-script`. To test the
`gh issue view --json` fallback path instead, say so in the case comment. Each case
directory carries its own copy of the stub (sharing one script across cases is untested).

## Mocking MCP servers

One Markdown file per tool at `evals/mocks/<server>/<tool>.md` (suite-wide) or in a case's
own `mocks/` (overrides the suite file by file). `<server>` is the name in the plugin's MCP
configuration (EVAL013 checks it). A tool with a mock needs no grant; a tool without one is
unavailable to Claude. Real servers start only with `--allow-real-servers` or `--mocks off`.

Body is the tool result. Options:

- `{{input.<field>}}` and `{{file:fixtures/<name>}}` substitutions.
- `expect:` guards the input (type name, `/regex/`, literal, or list of literals). A
  violating call aborts the run with score 0 and an `aborted` record. Put it on the tool
  file, not `_server.md`.
- `error: true` returns the body as a tool error (`fixed` only).
- `type: agent`: the judge model answers as the server. Output varies; saved recordings go
  under results `mock-recordings/` (see `ADOPT.txt`). Copy them to `mocks/.replay/<server>/`
  and commit them so later runs are repeatable.
- `_server.md`: one `type: agent` mock for several tools (`tools:` key). `_tools.json`: a
  saved `tools/list` for real descriptions and schemas.

Grade the calls with `target: mock_calls` (or `focus: mock_calls`). In a two-arm run those
graders are indicators only when the mocked server is plugin-declared, unless `arm: both`
(EVAL010); read them as "did the plugin ask the right thing", not as part of Δ.
