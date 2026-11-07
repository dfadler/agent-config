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

Sources: [`/usage`](https://code.claude.com/docs/en/commands),
[`CLAUDE_CONFIG_DIR`](https://code.claude.com/docs/en/env-vars) and
[multiple accounts, credential precedence, `claude auth login`](https://code.claude.com/docs/en/authentication).
The `-p` use of `/usage`, the absence of a model call, and the `Current week (all models)` line
shape are observed, not documented. Accounts are ones you own and log in to yourself; the
[Consumer Terms](https://www.anthropic.com/legal/consumer-terms) bar sharing account
credentials, and the [Usage Policy](https://www.anthropic.com/legal/aup) (effective Nov 12,
2026) bars creating multiple accounts to circumvent guardrails. The pages say nothing either
way about using several of your own accounts, so check them before relying on this.

Not verified: the probe against a second logged-in account (only the default account and a
logged-out directory were tried), and the `/usage` text for session-length windows, which the
parser reads if they match the weekly line's shape. No evals yet.
