## Dependency changes: audit before done

When a change adds or updates a dependency — a manifest or lockfile is touched
(`package.json`, `requirements.txt`/`pyproject.toml`, `Cargo.toml`, `go.mod`, etc.) —
run the audit tool for whichever ecosystem is in play before considering the change
done: `npm audit` (or `yarn npm audit --all` under Yarn), `pip-audit`, `cargo audit`,
`govulncheck`, or the project's own equivalent. Don't assume a new or bumped
dependency is safe just because it installed cleanly — the same way a shell script
gets run through shellcheck/shfmt before being considered finished.

- This only fires when a dependency file is actually touched — most sessions in most
  repos won't need it.
- If the audit surfaces a new high/critical finding, say so in the commit/PR rather
  than silently proceeding; whether that blocks the change is a per-repo call, not
  a blanket rule here.

