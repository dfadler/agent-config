---
name: pnpm-usage
description: |
  Use when working in a pnpm project (`pnpm-lock.yaml`, a `packageManager` pin or
  `pnpm-workspace.yaml`): adding, removing or auditing dependencies, a lockfile conflict or
  drift, `ERR_PNPM_*`, a dependency's postinstall that did not run, "Cannot find module"
  under strict `node_modules`, pnpm settings such as `overrides`, CI installs. Returns the
  pnpm command and where the setting goes. Not for the Node version (use `nodejs:node-version`).
metadata:
  version: "1.1.0"
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

1. Read `packageManager` and `devEngines.packageManager` in `package.json`; either one pins
   pnpm, and `devEngines.packageManager` accepts a range
   ([package.json docs](https://pnpm.io/package_json)). Behavior below depends on the
   major; check the installed major's docs at [pnpm.io](https://pnpm.io) and
   `pnpm help <command>` before relying on a flag or setting name. From pnpm 11.28.10 every
   command, including `pnpm --version`, applies the project's pin
   ([release notes](https://pnpm.io/blog/releases/11.28.10)), so run `pnpm --version`
   outside the project to see the installed pnpm. Fetching an uncached pinned version is an
   inference from that note, not stated there: ask before running a pnpm command inside the
   project if the pin differs from the installed version.
2. A repo with `pnpm-lock.yaml` uses pnpm only. Do not run `npm install` or `yarn`, and do
   not create `package-lock.json` or `yarn.lock`.
3. pnpm downloads and runs the pinned version by default. The setting is `pmOnFail` in
   pnpm 11 ([release notes](https://pnpm.io/blog/releases/11.0)) and
   `managePackageManagerVersions` in pnpm 10
   ([10.x settings](https://pnpm.io/10.x/settings)). Do not
   `npm install -g pnpm@<version>` to fix a mismatch; fix the pin or the shell `PATH`.
4. pnpm 12 is a native executable and needs no Node.js to run; it needs Node for project
   scripts, tools or an npm-based install ([installation](https://pnpm.io/installation)).
   pnpm 11 and earlier run on Node, and pnpm 11 requires Node 22 or newer
   ([release notes](https://pnpm.io/blog/releases/11.0)). Before a task that runs project
   JavaScript, pin the Node version first (`nodejs:node-version`).

## Where settings go

pnpm 11 ignores the `pnpm` field of `package.json`; `overrides`,
`allowBuilds` and similar belong in `pnpm-workspace.yaml`
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
- Merge conflict in `pnpm-lock.yaml`: do not resolve the markers by hand. A non-frozen
  `pnpm install` merges them (pnpm 11 source,
  [readLockfiles.ts](https://github.com/pnpm/pnpm/blob/main/pnpm11/installing/context/src/readLockfiles.ts));
  a frozen install, the CI default, does not. The pnpm 12 [docs](https://pnpm.io/git) say an
  unparseable lockfile fails with the parse error. Run `pnpm install` locally, then commit.
- `pnpm run` and `pnpm exec` can write `node_modules` because `verifyDepsBeforeRun`
  defaults to `install` in pnpm 11 and later and `false` in pnpm 10
  ([settings](https://pnpm.io/11.x/settings/build)).
- Why a package is present: `pnpm why <pkg>` ([docs](https://pnpm.io/cli/why)).
- `pnpm store prune` only removes unreferenced packages
  ([docs](https://pnpm.io/cli/store)); it is not a fix for a failing install.

## Strict `node_modules`

pnpm does not hoist undeclared dependencies into the root `node_modules`
([settings](https://pnpm.io/settings/node-modules)). "Cannot find module `<x>`" for a
package the code imports but `package.json` does not list is a missing dependency: add it
with `pnpm add`. Do not enable `shamefullyHoist` to hide it.

## Dependency build scripts

pnpm does not run a dependency's lifecycle scripts unless the project allows it
([supply-chain security](https://pnpm.io/supply-chain-security)). The allow-list is
`allowBuilds` (added in pnpm 10.26.0) and, in pnpm 10 only, `onlyBuiltDependencies`, which
pnpm 11 removed ([pnpm 11 release notes](https://pnpm.io/blog/releases/11.0)). In pnpm 11
`strictDepBuilds` is true, so an unreviewed build script fails the install with
`ERR_PNPM_IGNORED_BUILDS`; in pnpm 10 the script is skipped with a warning and a native
addon or CLI is left missing its binary. List what is blocked and tell the user;
`pnpm approve-builds` ([docs](https://pnpm.io/cli/approve-builds)) lets third-party code run
at install time, so ask before running it. Do not use `--all` or
`dangerouslyAllowAllBuilds`, and do not reach for `--ignore-scripts` to silence the error.

## One-off tools

`pnpm dlx` (aliases `pnx` and `pnpx`) fetches a package and runs it in one step
([docs](https://pnpm.io/cli/dlx)): load `fetch-execute-guide` and ask first. For a binary
the project already depends on, use `pnpm exec <bin>` or a `package.json` script
([docs](https://pnpm.io/cli/exec)).

## Supply chain

`pnpm audit` reports advisories ([docs](https://pnpm.io/cli/audit)); the `dependency-audits`
skill owns the audit-after-a-bump procedure. `minimumReleaseAge` (minutes) delays versions
published too recently
([docs](https://pnpm.io/settings/dependency-resolution)): the default is 0 in pnpm 10 and
1440 in pnpm 11 and later. The built-in default is non-strict, so pnpm falls back to a
version that is too new when no in-range version qualifies; setting the value yourself
turns on `minimumReleaseAgeStrict`. Report the value for the installed major, not one
number.

## CI

This section owns the CI order for pnpm and Node; `nodejs:node-version` owns only the pin file.
If the repo already has a setup step (a local composite action or a workflow under
`.github/`), call or copy that; it wins over the options below. Both take the pnpm version
from `packageManager`; keep the Node pin in `.nvmrc` rather than a second copy:

- **pnpm 11 or newer: [`pnpm/setup`](https://github.com/pnpm/setup)**, which pnpm's
  [CI page](https://pnpm.io/continuous-integration) recommends; prefer it for a new setup
  on those versions. One step installs pnpm and
  Node (no `actions/setup-node`; it detects `.nvmrc` itself) and runs `pnpm install`. A
  stale lockfile already fails in CI, but a missing one does not: set `require-lockfile: true`.
- **Any pnpm up to 12: [`pnpm/action-setup`](https://github.com/pnpm/action-setup)** before
  [`actions/setup-node`](https://github.com/actions/setup-node) when using its `cache: pnpm`,
  with `node-version-file: .nvmrc`, then `pnpm install --frozen-lockfile`. The action-setup
  README says it does not set up
  Node and that this pairing still works on pnpm 11 and 12. The setup-node README says the
  package manager should be pre-installed; the order is from its advanced-usage example.

Do not add Corepack to a new setup: the CI page says it runs pnpm through a Node.js shim on every call.
