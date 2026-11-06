---
name: account-balancer
description: |
  Use when the user has more than one Claude account and wants to pick which to spend on:
  "which account should I use", "balance my usage across accounts", "use the account that
  resets soon first", "I'm close to my weekly limit, is my other account freer", or before a
  heavy job (evals, fan-out, big review) when a second account exists. Reads each account's
  weekly usage and reset time and ranks them. Not for a single account's limits (use
  `/usage`) and not for switching accounts or logging in.
metadata:
  version: "0.1.0"
---

# Balancing spend across Claude accounts

## Contract

- **Input:** the accounts to compare, each as `label=<CLAUDE_CONFIG_DIR>` (or
  `label=default` for the normal `~/.claude`).
- **Output:** a ranking, best account to spend on first, with percent left, hours to reset
  and percent-left-per-hour for each, plus a one-line recommendation.
- **Does not:** log in, switch accounts, write credentials, or start the work on the chosen
  account. The user switches (a T3 Code provider, or `CLAUDE_CONFIG_DIR=<dir> claude`).

## Run the probe

Needs the accounts' config directories. If the user has not named them, ask once; do not
guess paths. Each non-default directory must already be logged in
(`CLAUDE_CONFIG_DIR=<dir> claude auth login`, done by the user).

```bash
node ${CLAUDE_SKILL_DIR}/scripts/ts/pick-account.ts work=default personal=~/.claude_personal
```

Add `--json` for machine-readable output. The script runs `claude -p "/usage"` once per
account, which printed plan usage without a model call when tried on one account. Run it
with the repo's Node (`.nvmrc`, 24) and `claude` on `PATH`.

If an account shows `unavailable`, the cause is one of: `claude` not on `PATH`, that
directory not logged in, or `/usage` text in a shape the parser does not know. Run
`CLAUDE_CONFIG_DIR=<dir> claude -p "/usage"` by hand to tell which, and report it. Do not
estimate that account's numbers.

## Decide

The rank is budget left divided by hours to the weekly reset. An account about to reset with
budget left is spend that is lost if unused, so it ranks high. Then:

- **Rank 1 takes the work.** Heavy, parallel or long jobs go there first.
- **Check the job fits.** If rank 1's budget left is small (say under about 10%) and the job
  is big, say so and split: start on rank 1, move to rank 2 when it runs low.
- **An exhausted account** (0% left) ranks last; its reset hour does not matter until then.
- **Only the weekly all-models window decides.** Per-model windows are shown in the raw
  `/usage` text. If the job uses a model whose own window is nearly full, mention it.
- **Point in time.** Each run is a snapshot; for a long job, re-run it later.

Final line, one sentence, for example: "Start the evals on `personal`, 95% left but resets
in 6h, then fall back to `work`."
