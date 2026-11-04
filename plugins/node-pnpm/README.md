# node-pnpm plugin for Claude Code

Two skills for the Node and pnpm mistakes an agent makes without help. Claims link to the
nvm, Node, npm and pnpm docs; the pnpm text names the major it applies to.

| Piece | Use |
|-------|-----|
| `node-pnpm:node-version` | A command must run on the project's Node version; `nvm: command not found`; wrong `node` on `PATH`; `.nvmrc` or `engines` mismatch; upgrading the pin; Node in CI |
| `node-pnpm:pnpm-usage` | Adding or removing dependencies, lockfile drift, `ERR_PNPM_*`, blocked build scripts, strict `node_modules`, where a pnpm setting goes |

Not covered here: `pnpm dlx` and the nvm install script are fetch-and-execute installs
(`fetch-execute-guide` owns the ask-first rule); auditing after a bump belongs to
`dependency-audits`. No agent and no always-on include: each area has a task trigger a
skill description can name ([conventions README](../../claude/conventions/README.md)).
