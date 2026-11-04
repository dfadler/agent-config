---
name: pnpm-usage
description: |
  Use when working in a pnpm project (`pnpm-lock.yaml`, a `packageManager` pin or
  `pnpm-workspace.yaml`): adding, removing or auditing dependencies, a lockfile conflict or
  drift, `ERR_PNPM_*`, a dependency's postinstall that did not run, "Cannot find module"
  under strict `node_modules`, pnpm settings such as `overrides`, CI installs. Returns the
  pnpm command and where the setting goes. Not for the Node version (use `node-version`).
metadata:
  version: "1.0.0"
---

# Working in a pnpm project

## Contract

- **Input:** a pnpm project and a task: change dependencies, fix an install or lockfile
  error, set a pnpm setting, set up CI.
- **Output:** the pnpm commands to run, the file a setting belongs in, and the
  verification command with its result.
- **Does not:** run `pnpm dlx` or approve dependency build scripts without the user's yes,
  or hand-edit `pnpm-lock.yaml`.

## First

1. Read `packageManager` in `package.json` and run `pnpm --version`. Behavior below depends
   on the major; check the installed major's docs at [pnpm.io](https://pnpm.io) and
   `pnpm help <command>` before relying on a flag or setting name.
2. A repo with `pnpm-lock.yaml` uses pnpm only. Do not run `npm install` or `yarn`, and do
   not create `package-lock.json` or `yarn.lock`.
3. `packageManager` names an exact pnpm version. pnpm downloads and runs that version by
   default, controlled by `pmOnFail` in pnpm 11 and `managePackageManagerVersions` in pnpm
   10 ([pnpm 11 release notes](https://pnpm.io/blog/releases/11.0)). Do not
   `npm install -g pnpm@<version>` to fix a mismatch; fix the pin or the shell `PATH`.
4. pnpm runs on Node, so pin the Node version first (`node-version` skill).

## Where settings go

pnpm 11 ignores the `pnpm` field of `package.json`; `overrides`,
`onlyBuiltDependencies` and similar belong in `pnpm-workspace.yaml`
([pnpm 11 release notes](https://pnpm.io/blog/releases/11.0)). pnpm 11.28.2 printed a
warning and ignored the keys when tested locally (observed, not from the docs), so an
`overrides` entry added to `package.json` has no effect.
When the project has `pnpm-workspace.yaml`, edit settings there. For pnpm 10, check
[the 10.x settings page](https://pnpm.io/10.x/settings) before choosing a file.
`catalog:` entries live in `pnpm-workspace.yaml` too ([catalogs](https://pnpm.io/catalogs)).

## Dependencies and the lockfile

- Add and remove with `pnpm add <pkg>` and `pnpm remove <pkg>`; never edit
  `pnpm-lock.yaml` by hand.
- `pnpm add` at a workspace root fails unless you pass `-w`
  ([pnpm add](https://pnpm.io/cli/add)). In a workspace, select packages with
  `--filter` ([filtering](https://pnpm.io/filtering)).
- Verify that the lockfile matches `package.json` with `pnpm install --frozen-lockfile`;
  it fails on drift and never writes the lockfile
  ([pnpm install](https://pnpm.io/cli/install)). In CI that flag is the default when a
  lockfile exists.
- Drift or a broken entry: `pnpm install` regenerates it, then commit the lockfile with the
  `package.json` change. `pnpm install --fix-lockfile` repairs broken entries.
- Why a package is present: `pnpm why <pkg>` ([docs](https://pnpm.io/cli/why)).
- `pnpm store prune` only removes unreferenced packages
  ([docs](https://pnpm.io/cli/store)); it is not a fix for a failing install.

## Strict `node_modules`

pnpm does not hoist undeclared dependencies into the root `node_modules`
([settings](https://pnpm.io/settings/node-modules)). "Cannot find module `<x>`" for a
package the code imports but `package.json` does not list is a missing dependency: add it
with `pnpm add`. Do not enable `shamefullyHoist` to hide it.

## Dependency build scripts

pnpm does not run a dependency's lifecycle scripts unless the project allows it: the
setting is `allowBuilds` in pnpm 11 and `onlyBuiltDependencies` in pnpm 10
([pnpm 11 release notes](https://pnpm.io/blog/releases/11.0)). A native addon or CLI that is
missing its binary after install usually hit this. List what is blocked and tell the user;
`pnpm approve-builds` ([docs](https://pnpm.io/cli/approve-builds)) lets third-party code run
at install time, so ask before running it. Do not use `--all` or
`dangerouslyAllowAllBuilds`, and do not reach for `--ignore-scripts` to silence the error.

## One-off tools

`pnpm dlx` fetches a package and runs it in one step
([docs](https://pnpm.io/cli/dlx)): load `fetch-execute-guide` and ask first. For a binary
the project already depends on, use `pnpm exec <bin>` or a `package.json` script
([docs](https://pnpm.io/cli/exec)).

## Supply chain

`pnpm audit` reports advisories ([docs](https://pnpm.io/cli/audit)); the `dependency-audits`
skill owns the audit-after-a-bump procedure. `minimumReleaseAge` (minutes) refuses versions
published too recently ([docs](https://pnpm.io/settings/dependency-resolution)); its default
differs by major, so read the installed major's docs before reporting its value.

## CI

Install the pnpm version from `packageManager` with
[`pnpm/action-setup`](https://github.com/pnpm/action-setup) before
[`actions/setup-node`](https://github.com/actions/setup-node) when using its `cache: pnpm`,
then run `pnpm install --frozen-lockfile`. The setup-node README says the package manager
should be pre-installed; the action order is from its advanced-usage example.
