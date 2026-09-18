## Shell scripts: hygiene baseline

For any non-trivial bash script:

- Every script's first real statement should be `set -uo pipefail` (or
  `set -euo pipefail`). Exempt only a file with explicit sourced-only
  evidence: a literal `# sourced-only` comment line in its header, added
  only after verifying every real call site sources the file rather than
  executing it. A missing shebang alone is NOT that evidence — a file with
  no shebang can still be run via `bash path/to/file.sh` or a wrapper
  (#168). `scripts/check-shell-set-flags.sh` enforces this.
- Run it through shellcheck (correctness) and shfmt (formatting) before considering
  it done, if the project has those set up.
- A shellcheck disable needs a justification at the same bar as a TypeScript type
  assertion: a comment on the line above explaining why it's sound, directly above the
  bare `# shellcheck disable=SCxxxx` directive — never a bare disable.
- Keep script tests hermetic — no network, never a real/production system. Shim
  external commands (`gh`, `curl`, `git` against a throwaway repo, etc.) via `PATH`
  rather than letting a test touch the real thing.
- Support `-h`/`--help`, printing at least a one-line usage summary before any other
  argument handling runs. No need for shared help-printing machinery at this scale — a
  `usage()` function with a heredoc, checked first in a plain `case` statement (or arg
  loop), is enough; `setup.sh` is the style reference already in this repo. `--version`
  isn't required unless a script actually has a version to report.
- Use named, documented exit codes instead of bare `exit 1` — a shared, small
  taxonomy, not a bespoke one per script. Reuse this repo's numbering (skip the ones a
  script has no path for; don't invent new ones without extending this list):
  ```bash
  EXIT_OK=0            # success
  EXIT_FAILURE=1       # general failure — the check ran and found something wrong
  EXIT_USAGE=2         # missing/invalid arguments, including a bad path argument
  EXIT_CONFIG=3        # bad config (reserved — no script needs this yet)
  EXIT_DEPENDENCY=4    # a required external command isn't on PATH
  EXIT_NETWORK=5       # network failure (reserved — no script needs this yet)
  EXIT_TIMEOUT=6       # operation timed out (reserved — no script needs this yet)
  EXIT_INTERNAL=20     # unexpected/assertion failure — should not happen
  ```
  Declare only the constants a given script actually uses (an unused `readonly`
  triggers shellcheck's SC2034). The gap between 6 and 20 is deliberate headroom for
  more specific codes later without renumbering `EXIT_INTERNAL`.

