# nodejs plugin for Claude Code

One skill for the Node version mistakes an agent makes without help. Claims link to the
Node, npm, pnpm and setup-node docs.

| Piece | Use |
|-------|-----|
| `nodejs:node-version` | A script exits 0 and does nothing; `.nvmrc` or `engines` mismatch; ABI errors after a switch; upgrading the pin; picking an LTS; Node in CI |

The plugin is named `nodejs`, not `node`, because the repo's contract check
(`scripts/ts/skill-contracts.ts`) reads a `node:<word>` token as a skill reference when a
plugin has that name, and the skill text mentions `node:lts`.

Managing versions with nvm belongs to the `nvm` plugin; package installs belong to `pnpm`.
