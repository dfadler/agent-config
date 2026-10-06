# Grants file format

A plugin's eval cases cannot grant themselves `Bash`, `Write`, `Edit`, `WebFetch` or
`WebSearch`. The operator passes `--allow-tools` on the command line, and a grant applies
to every case in that run. One grant per plugin would therefore be a union: the narrower
case would run under the broader grant and lose its negative check. So grants are
recorded **per case**, in a file beside the cases.

Tracking: [#449](https://github.com/dfadler/agent-config/issues/449),
[#459](https://github.com/dfadler/agent-config/issues/459). The lint (EVAL004, EVAL005),
the run wrapper, the hook and `case-reviewer` all read this file; this document is the
definition they share.

## Location and name

`plugins/<name>/evals/grants.yaml`, next to the case directories. It is reviewed in the
same PR as the cases it describes. Absent file means no case has a grant.

## Shape

```yaml
schema_version: "1"
grants:
  <case-name>:
    - "<allow-tools entry>"
```

- `schema_version`: required, the string `"1"`.
- `grants`: required mapping from case name to a list of entries. It may be empty.
- A **case name** is the case's `name` field (its directory name for the
  `prompt.md` layout).
- An **entry** is exactly the string `--allow-tools` takes: `Tool` or `Tool(specifier)`,
  where `Tool` is one of `Bash`, `Write`, `Edit`, `WebFetch`, `WebSearch` (the tools a
  case cannot grant itself) and `specifier` is a non-empty permission-rule specifier such
  as `npx *` or `domain:example.com`. Entries are not interpreted beyond that shape.
- **No entry for a case means no grants.** An explicit empty list (`[]`) means the same;
  use it only to say "reviewed, needs none".

## Validation

The shared parser rejects, with the offending key or entry in the message:

| Problem | Why |
|---|---|
| Unknown top-level key, or a missing/unsupported `schema_version` | A typo must not silently drop grants |
| A key under `grants` naming a case that does not exist | A stale entry hides a renamed or deleted case |
| An entry that is not a string, is empty, or does not match the shape above (including a tool outside the five) | The wrapper would pass it straight to the CLI |
| A duplicate entry within one case | Grants are a set; a duplicate is a mistake |

## Derived values

- **Grant set** of a case: its entries, de-duplicated and sorted. Two cases have
  *identical grants* when their grant sets are equal; a case with no entry has the empty
  set.
- **Run group**: all cases sharing one grant set. The wrapper makes one run per group,
  selecting its cases with `--case <glob>` (a glob per case name; the CLI's `--help`
  lists the flag). Each group runs under exactly its own grants, never a union.
- The lint checks each case against its own grant set: EVAL004 flags an `allowed_tools`
  entry in the five tools with no matching grant, and EVAL005 flags a `tool_used` grader
  whose tool is not granted.
- Argument order when the wrapper calls the CLI: the target (plugin path) first, then
  `--case`, then `--allow-tools`. How several entries are passed (repeated flag or one
  value) is the wrapper's to confirm against `--help` (#460); entries are never joined
  with commas by this format, because a specifier may contain one.

## Worked example: `fetch-execute-guide`

```yaml
schema_version: "1"
grants:
  fetch-execute-asks-first:
    - "Bash(npx *)"
  fetch-execute-runs-with-permission:
    - "Bash(npx --yes cowsay@latest *)"
```

The two cases have different grant sets, so the wrapper makes two runs:

```
claude plugin eval plugins/fetch-execute-guide --case fetch-execute-asks-first --allow-tools "Bash(npx *)"
claude plugin eval plugins/fetch-execute-guide --case fetch-execute-runs-with-permission --allow-tools "Bash(npx --yes cowsay@latest *)"
```

Had both cases been granted `Bash(npx *)`, they would share one run with
`--case "fetch-execute-*"`. Running them together under a union would let
`fetch-execute-asks-first` execute `npx --yes cowsay@latest`, which that case exists to
forbid.

(Recording these entries for this repo is #488, not part of the format definition.)

## Types

The machine-readable definition is [`grants.schema.json`](grants.schema.json). The
parser's TypeScript type mirrors it:

```ts
type GrantableTool = "Bash" | "Write" | "Edit" | "WebFetch" | "WebSearch";
type GrantEntry = string; // `${GrantableTool}` or `${GrantableTool}(${string})`

interface GrantsFile {
  readonly schema_version: "1";
  readonly grants: Readonly<Record<string, readonly GrantEntry[]>>;
}
```
