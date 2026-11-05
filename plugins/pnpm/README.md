# pnpm plugin for Claude Code

One skill for pnpm projects. Claims link to pnpm.io; the text names the pnpm major each one
applies to.

| Piece | Use |
|-------|-----|
| `pnpm:pnpm-usage` | Adding or removing dependencies, lockfile drift or conflicts, `ERR_PNPM_*`, blocked build scripts, strict `node_modules`, where a pnpm setting goes, CI installs |

Not covered here: the Node version (`nodejs`, `nvm`). `pnpm dlx` is a fetch-and-execute
install (`fetch-execute-guide` owns the ask-first rule), and auditing after a bump belongs to
`dependency-audits`.
