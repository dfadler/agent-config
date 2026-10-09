---
name: shell-script-hygiene
description: |
  Shell script hygiene baseline: `set -uo pipefail`, shellcheck/shfmt,
  justification-required shellcheck disables, hermetic tests, `-h`/`--help`
  support, and a shared named-exit-code taxonomy. Load before writing,
  editing, or reviewing any non-trivial bash script or `*.sh` file, adding a shellcheck disable, or
  writing script tests.
license: MIT
metadata:
  version: "1.0.0"
---

# Shell script hygiene

## Flags

Every non-trivial bash script's first real statement must be `set -uo pipefail`
(or `set -euo pipefail`). The only exemption is a file with a `# sourced-only`
comment in its header — added only after verifying every real call site sources
rather than executes the file. A missing shebang is **not** that evidence.

## Linting and formatting

Run `shellcheck` (correctness) and `shfmt` (formatting) before considering a
script done, if the project has those set up.

A shellcheck disable needs a justification at the same bar as a TypeScript
type assertion: a comment on the line above explaining why it's sound, directly
above the bare `# shellcheck disable=SCxxxx` directive — never a bare disable.

## Tests

Keep script tests hermetic — no network, never a real/production system. Shim
external commands (`gh`, `curl`, `git` against a throwaway repo, etc.) via
`PATH` rather than letting a test touch the real thing.

## Help

Support `-h`/`--help`, printing at least a one-line usage summary before any
other argument handling runs. A `usage()` function with a heredoc, checked
first in a plain `case` statement (or arg loop), is enough. `--version` isn't
required unless a script actually has a version to report.

## Exit codes

Use named, documented exit codes instead of bare `exit 1`. Reuse this repo's
taxonomy — declare only the constants a given script actually uses (an unused
`readonly` triggers shellcheck's SC2034):

```bash
EXIT_OK=0            # success
EXIT_FAILURE=1       # general failure — the check ran and found something wrong
EXIT_USAGE=2         # missing/invalid arguments, including a bad path argument
EXIT_CONFIG=3        # bad config (reserved)
EXIT_DEPENDENCY=4    # a required external command isn't on PATH
EXIT_NETWORK=5       # network failure (reserved)
EXIT_TIMEOUT=6       # operation timed out (reserved)
EXIT_PARTIAL=7       # partial or untrustworthy run
EXIT_INTERNAL=20     # unexpected/assertion failure — should not happen
EXIT_INTERRUPTED=130 # SIGINT — the shell convention; pass through
EXIT_TERMINATED=143  # SIGTERM — the shell convention; pass through
```

The gap between 7 and 20 is deliberate headroom. 130 and 143 are 128 + signal;
pass them through, never assign them manually.
