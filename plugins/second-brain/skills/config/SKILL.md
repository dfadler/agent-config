---
name: config
description: |
  Internal primitive that reads YAML frontmatter from vault config files via
  mcp__obsidian__* tools, and returns it as merged key-value data. Not a
  user-facing slash command — this skill is never triggered by a user
  request directly; other agent-config skills (screen-capture, and
  second-brain's own capture/query skills) invoke it to load their own
  settings. Degrades to an empty config, never a hard failure, when the
  Obsidian MCP is disconnected or the config file doesn't exist. Parse
  `$ARGUMENTS` as `<skill-name> [project-name]`.
license: MIT
metadata:
  version: "1.0.0"
---

# Vault config primitive

Reads a skill's config from an Obsidian vault as plain key-value data, so
other skills don't each reimplement "read frontmatter, merge global with
per-project, don't blow up if Obsidian isn't connected."

**This is a primitive, not an entry point a user invokes by name.** A
calling skill loads it explicitly (`Skill` tool, `second-brain:config`,
`args: "<skill-name> [project-name]"`) as one step in its own procedure —
it has no independent trigger phrase and does nothing a user would
recognize as a result on its own.

## Inputs

- `skill-name` (required) — the calling skill's own name, e.g.
  `screen-capture`. Used verbatim as the config filename.
- `project-name` (optional) — an identifier for the current project,
  typically the repo directory's basename. The caller decides this; this
  skill does not infer it. Omit it to read only the global config.

## Resolution paths

Two files in the vault, read in this order:

1. **Global**: `config/global/<skill-name>.md`
2. **Per-project** (only if `project-name` was given):
   `config/projects/<project-name>/<skill-name>.md`

Both are optional. Neither existing is not an error — see Degradation below.

## Procedure

1. If `project-name` was not supplied, skip straight to step 2 with an empty
   per-project result.
2. Read the global file's contents using this session's `mcp__obsidian__*`
   tools (the exact tool name — e.g. a `get_file_contents`-style read —
   depends on whichever Obsidian MCP server is connected; use whatever tool
   in that namespace reads a vault file's raw text by path).
   - If the read fails for any reason — tool not present, MCP disconnected,
     file not found, malformed response — treat it as "no global config"
     and continue. Do not surface an error to the caller.
3. If `project-name` was given, read the per-project file the same way,
   with the same fail-soft handling.
4. For each file that was read successfully, extract the YAML frontmatter
   (the block between the first two `---` lines at the top of the file) and
   parse it into key-value pairs. A file with no frontmatter block yields no
   keys from that file.
5. Merge: start from the global keys, then overlay the per-project keys on
   top, key by key (a key present in both takes the per-project value). This
   is a shallow merge — a per-project file only needs to name the keys it
   overrides, not repeat the whole global config.
6. Return the merged key-value data to the caller. When both files were
   missing or unreadable, this is an empty object — not an error, not a
   partial result, just nothing to configure with.

## Degradation

The Obsidian MCP being disconnected (or absent from this session entirely)
is an expected, ordinary condition, not a failure:

- Never raise, throw, or stop the calling skill's procedure over a missing
  or errored `mcp__obsidian__*` tool call.
- Return an empty config (`{}`) in that case, exactly as if both files
  simply didn't exist.
- A calling skill is expected to have its own defaults and work correctly
  with an empty config — this primitive's job is only to supply overrides
  when a vault is available, never to be a required dependency.

## Output shape

A flat key-value object — the parsed and merged YAML frontmatter, nothing
else (no file paths, no metadata about which files were found). The calling
skill reads these keys directly as its own configuration values.
