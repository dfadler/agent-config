---
name: dependency-audits
description: |
  Audit dependencies for vulnerabilities before finishing a change that adds or
  updates a dependency — any time a manifest or lockfile is touched
  (`package.json`, `requirements.txt`/`pyproject.toml`, `Cargo.toml`,
  `go.mod`, etc.). Run the ecosystem's audit tool (`npm audit`, `yarn npm
  audit --all`, `pip-audit`, `cargo audit`, `govulncheck`, or the project's
  own equivalent) and surface any new high/critical findings in the commit/PR.
license: MIT
metadata:
  version: "1.0.0"
---

# Dependency audits

When a change touches a manifest or lockfile, run the audit tool for that
ecosystem before considering the change done. Don't assume a new or bumped
dependency is safe just because it installed cleanly.

## Audit commands by ecosystem

| Ecosystem | Command |
|-----------|---------|
| npm | `npm audit` |
| Yarn | `yarn npm audit --all` |
| Python | `pip-audit` |
| Rust | `cargo audit` |
| Go | `govulncheck ./...` |

Fall back to the project's own equivalent if it has one.

## On findings

If the audit surfaces a new high/critical finding, say so in the commit/PR
rather than silently proceeding. Whether that finding blocks the change is a
per-repo policy call, not a blanket rule here.

Low/moderate findings on pre-existing dependencies are noise for this task —
this check is specifically about what the current change introduced.
