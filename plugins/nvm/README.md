# nvm plugin for Claude Code

One skill for running commands under nvm from an agent's shell. Claims link to the nvm
README, the Claude Code docs and nvm's release notes.

| Piece | Use |
|-------|-----|
| `nvm:nvm-usage` | `nvm: command not found`; `nvm use` not sticking between Bash calls; wrong `node` first on `PATH`; installing or defaulting a version; global packages lost on a switch |

Not covered here: which Node version a project needs (`nodejs`), and package installs
(`pnpm`). The nvm install script is a fetch-and-execute install; `fetch-execute-guide`
owns the ask-first rule.
