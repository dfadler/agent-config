# account-balancer plugin for Claude Code

One skill for choosing which of several Claude accounts to spend on. It reads each
account's weekly usage and reset time (`claude -p "/usage"` under that account's
`CLAUDE_CONFIG_DIR`) and ranks accounts by percent left per hour until reset, so budget
that is about to reset gets used first.

| Piece | Use |
|-------|-----|
| `account-balancer:account-balancer` | "which account should I use", balancing spend across accounts, picking the account for a heavy job |

It only recommends. Logging in and switching stay with the user (a T3 Code provider per
account, or `CLAUDE_CONFIG_DIR=<dir> claude`). Each extra account must be logged in first with
`CLAUDE_CONFIG_DIR=<dir> claude auth login`.

Not verified: the probe against a second logged-in account (only the default account and a
logged-out directory were tried), and the `/usage` text for session-length windows, which the
parser reads if they match the weekly line's shape. No evals yet.
