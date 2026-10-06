# Fixtures and mocks

Source: the [plugin-evals docs](https://code.claude.com/docs/en/plugin-evals), "Set up
fixtures and mocks" and "Mock files".

Each run starts in an empty workspace, so put what the task needs in the prompt, or seed it.

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
- A `fixtures/bin` directory put on `PATH` is **not** supported: do not use it (EVAL014).
- `context.add_dirs` lists case-directory folders Claude may read (read-only).
  `context.history_file` resumes a `.jsonl` transcript; such a case runs one arm by default
  when the target is a path.

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
