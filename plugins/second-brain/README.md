# second-brain plugin for Claude Code

Vault-path-agnostic port of the personal `claude-skills` second-brain skills
(agent-config#321).

## Vault path resolution

The vault path is the only machine-specific value this plugin needs — everything
else is generic. Skills that touch the vault resolve it in this order:

1. `SECOND_BRAIN_VAULT_PATH` environment variable
2. `secondBrain.vaultPath` in `~/.claude/settings.json`

If neither source is set, a vault-access skill must fail with a clear error
telling the user to set one of the two, rather than guessing a path or silently
no-oping.

## Skills

- **`capture`** — save notes, decisions, links, and other information to the vault.
- **`query`** — answer questions by searching and reading the vault.
- **`sync`** — sync vault notes with their Slack canvas sources and fill in
  missing documentation summaries.
- **`config`** — internal primitive that reads and merges YAML frontmatter
  from vault config files (`config/global/<skill>.md`, optionally overlaid by
  `config/projects/<project>/<skill>.md`); other skills call it to load their
  own settings. Not a user-facing entry point, and unrelated to the vault path
  resolution above — it configures individual skills' *behavior* once the
  vault is already found.
