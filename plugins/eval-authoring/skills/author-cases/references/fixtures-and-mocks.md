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
- Keep answers out of reach: the agent can read git history and `add_dirs`, so a script
  that commits a fix or branch, or an `add_dirs` folder with an answer file or `.git`,
  leaks it (EVAL014; Anthropic's agent-evals post reports an agent using earlier trials'
  git history).
- A `fixtures/bin` directory put on `PATH` is **not** supported (a probe in #450 found it is not on `PATH`): do not use it.
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

## Git in cases

`git init` run by the agent inside the eval sandbox fails ("Operation not permitted", #989), so a
hook that needs a git checkout (`require-worktree`, `commit-branch-guard`, `protected-remote`,
the `pii-cleanup` commit gate) stays off and both arms score the same. Do not draft such a case
without a repo already in place. `scaffold_script` runs outside the sandbox, so it can `git init`,
set `user.*` and commit a base (see `plugins/github-pr/evals/pr-comments-hard-push-unasked/scaffold-script`);
it needs `--scaffold`, and EVAL014 flags history that leaks an answer. Whether the agent's own
`git commit` then works in the sandbox, and whether a plugin hook fires on it, is untested: probe
one case at `--runs 1` before building more. Otherwise test the hook with the plugin's unit tests.

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
graders are indicators only when the mocked server is plugin-declared, unless `arm: both`;
read them as "did the plugin ask the right thing", not as part of Δ. The exception is a
case where every grader is excluded: they all score normally and inflate Δ (EVAL008).

### Fixed or agent mock, and the success-only hazard

`type` defaults to `fixed` (docs, "Mock files"). Pick by what the answer depends on:

- **Fixed** when the result is a function of this one call's input: `{{input.<field>}}` and
  `{{file:...}}` cover it, it is deterministic, costs no model call, and it is the only type
  that takes `error: true`. Default to it. Analogy, not a mock file: the `./bin/gh` shell stub
  in `plugins/github-pr/evals/issue-triage-fires-on-backlog-sweep/scaffold-script` is a canned stand-in
  for a live CLI: it prints fixed JSON for `gh issue list` and `gh issue view`, `exit 1` otherwise.
  No live suite in this repo uses an MCP mock file yet.
- **Agent** only when answers must stay consistent across a sequence of calls (the judge
  "sees earlier calls as history") or inputs are too varied to template. It varies between
  runs, draws on the 4 x `max_turns` call budget, and needs a committed `.replay/` to be
  repeatable in CI. No suite in this repo uses one yet; the shape is the lint fixture
  `plugins/eval-authoring/tests/lint-fixtures/EVAL013/good-case-yaml/cases/mocks/tracker/triage.md`.

**Success-only mock.** A failure behavior in SKILL.md (retry, fall back, tell the user) never
runs when every mock returns a success body. Add a sibling case whose own
`mocks/<server>/<tool>.md` sets `error: true`, plus a grader on the claimed fallback. Shape:
`plugins/eval-authoring/tests/lint-fixtures/EVAL013/good-case-yaml/cases/case1/mocks/tracker/close_issue.md`.
