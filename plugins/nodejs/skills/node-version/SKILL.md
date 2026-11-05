---
name: node-version
description: |
  Use when deciding or checking which Node version a project needs: a script that exits 0
  and does nothing, an `.nvmrc` or `engines` mismatch, a native-module ABI error after a
  switch, moving a repo to a new Node major (upgrade the pin), picking a supported LTS,
  Node setup in CI. Returns the version check and the places to change. Not for nvm shell
  mechanics such as `nvm: command not found` (use `nvm:nvm-usage`), installing packages
  (use `pnpm:pnpm-usage`) or Node API questions.
metadata:
  version: "1.0.0"
---

# Choosing and checking the Node version

## Contract

- **Input:** a project directory and a Node-version question or task (check the running
  version against the pin, diagnose a version symptom, upgrade the pin, set up CI).
- **Output:** the running version compared with `.nvmrc` and `engines.node`, then the
  files to change or the commands to run.
- **Does not:** manage versions with nvm (`nvm:nvm-usage` does), edit shell rc files, or
  install Node without the user's yes.

## Check the version before blaming the code

1. Read the pin: `.nvmrc` and `engines.node` in `package.json`.
2. Read what runs: `node --version` and `command -v node`. Under nvm, run them in the one
   call `nvm:nvm-usage` describes, because `nvm use` does not persist between Bash calls.
3. `.nvmrc` may name only a major (`24`), so the installed release of that major can sit
   below an `engines` floor like `>=24.4`. Compare the full version with `engines.node`,
   not just the major.
4. A script that exits 0 and prints nothing on an old Node is a version symptom, not a
   code bug. Re-run it on the pinned version before debugging. Running `.ts` files natively
   needs Node 22.18 or newer ([Node TypeScript docs](https://nodejs.org/api/typescript.html)).

`engines` is advisory for `npm install` only, while npm's `engine-strict` setting is false
(the default; [npm config](https://docs.npmjs.com/cli/v11/using-npm/config#engine-strict)).
Tested on npm 11.19.0 with the default: a root mismatch warns (`EBADENGINE`) on install and
is ignored by `npm run` and `node --run`
([npm docs](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#engines)). With
`engine-strict=true`, npm refuses the install instead, so check `npm config get engine-strict`
before reading an `EBADENGINE` failure as a warning.
`devEngines.runtime` errors on a mismatch by default (same page, tested). pnpm fails on a
root `engines` mismatch even without `engineStrict`, per its
[docs](https://pnpm.io/package_json) (not tested). Do not treat a clean install as proof
the version is right.

## When the version is wrong

Installing, switching or defaulting a version with nvm, and a wrong `node` first on `PATH`,
belong to `nvm:nvm-usage`. For native-module ABI errors after a switch, Node's own error
text suggests `npm rebuild` or `npm install`; try the project's rebuild first and delete
`node_modules` only if that fails. An addon built only on Node-API is ABI-stable across
Node versions and needs no rebuild; one that also uses Node's C++ APIs or an
ABI-unstable external library can still need one
([Node-API docs](https://nodejs.org/api/n-api.html)).

## Upgrade the pin across a repo

Pick a supported LTS major from the [Node release schedule](https://github.com/nodejs/Release#release-schedule),
and read its EOL date in `schedule.json`: only that file carries EOL dates and no patch
versions. Find the latest patch in the [release index](https://nodejs.org/dist/index.json);
a pinned major should be on a patched release
([security releases](https://nodejs.org/en/blog/vulnerability)). `lts/*`, `node:lts` and
`nvm --lts` resolve to whichever major is the newest LTS when they run, so they can jump a
major without a commit. Change every place that names the major, then grep for the old one:

- `.nvmrc` and `engines.node`: the `.nvmrc` version must satisfy the `engines.node` range.
- CI `node-version`, or `node-version-file: .nvmrc` so CI reads the same file.
- The `@types/node` major, which follows Node majors
  ([npm registry](https://www.npmjs.com/package/@types/node)).
- Docs and Dockerfiles that name the old major.

In CI, prefer `actions/setup-node` over installing nvm (a preference, not an nvm
requirement). Its `node-version-file` reads `.nvmrc`, `.node-version`, `.tool-versions`,
`mise.toml` and `package.json`
([advanced usage](https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md)).
In a pnpm project the setup order, and `pnpm/setup` as the alternative that also reads
`.nvmrc`, are in `pnpm:pnpm-usage`.
