---
name: dependency-audits
description: |
  Run the ecosystem's audit tool before calling a dependency change done. Use when a
  change adds or updates a dependency, or touches a manifest or lockfile
  (`package.json`, `pnpm-lock.yaml`, `requirements.txt`, `pyproject.toml`,
  `Cargo.toml`, `go.mod`).
metadata:
  version: "1.0.0"
---

# Dependency audits

## Contract

- **Input:** a change that touches a dependency manifest or lockfile.
- **Output:** the audit run for that ecosystem, and any new high/critical finding
  called out in the commit/PR.
- **Does not:** decide whether a finding blocks the change; that is a per-repo call.

Run the audit tool for whichever ecosystem is in play before considering the change
done: `npm audit` (or `yarn npm audit --all` under Yarn), `pip-audit`, `cargo audit`,
`govulncheck`, or the project's own equivalent. Don't assume a new or bumped
dependency is safe just because it installed cleanly, the same way a shell script
gets run through shellcheck/shfmt before being considered finished.

- This only fires when a dependency file is actually touched.
- If the audit surfaces a new high/critical finding, say so in the commit/PR rather
  than silently proceeding.
