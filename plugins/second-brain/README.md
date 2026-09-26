# second-brain plugin for Claude Code

Vault-path-agnostic port of the personal `claude-skills` second-brain skills. This
is the foundational scaffold (agent-config#327, part of epic #321); config,
capture, and query skills land in follow-up issues (#328, #329).

## Vault path resolution

The vault path is the only machine-specific value this plugin needs — everything
else is generic. Skills that touch the vault resolve it in this order:

1. `SECOND_BRAIN_VAULT_PATH` environment variable
2. `secondBrain.vaultPath` in `~/.claude/settings.json`

If neither source is set, a vault-access skill must fail with a clear error
telling the user to set one of the two, rather than guessing a path or silently
no-oping.

## Skills

None yet — this issue only adds the plugin manifest and vault path resolution
contract. See #328 (config skill), #329 (capture/query port), #330 (config
schema docs), and #331 (env var docs).
