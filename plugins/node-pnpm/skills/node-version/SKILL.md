---
name: node-version
description: |
  Use when a command must run on the project's Node version, or fails for a Node-version
  reason: `nvm: command not found`, `node` resolving to the wrong version, an `.nvmrc` or
  `engines` mismatch, a script that exits 0 and does nothing, switching or upgrading Node,
  Node setup in CI. Returns the version check and the exact commands. Not for installing
  packages (use `pnpm-usage`) or Node API questions.
metadata:
  version: "1.0.0"
---

# Running on the right Node version

## Contract

- **Input:** a project directory and a Node-version symptom or task (run a command, switch
  versions, upgrade the pin, set up CI).
- **Output:** the resolved `node` path and version compared with `.nvmrc` and
  `engines.node`, then the commands to run, or the shell-config change for the user to
  approve.
- **Does not:** edit shell rc files, install nvm, or install Homebrew Node without the
  user's yes.

## Run commands under the pinned version

nvm is a sourced shell function, not an executable
([nvm README](https://github.com/nvm-sh/nvm#verify-installation)). Your shell tool starts a
fresh non-interactive shell per call that sources no rc file
([nvm README, Docker section](https://github.com/nvm-sh/nvm#installing-in-docker)), so `nvm`
is not found and a `nvm use` in one call is gone in the next. Source nvm and run the command
in the same call:

```bash
bash -c '. "${NVM_DIR:-$HOME/.nvm}/nvm.sh" && nvm use >/dev/null && <command>'
```

`nvm use` with no argument reads `.nvmrc` from the current directory or a parent
([nvm README, .nvmrc](https://github.com/nvm-sh/nvm#nvmrc)). If a hook blocks compound
commands, put the version's bin directory on `PATH` for the one command instead:
`PATH="${NVM_DIR:-$HOME/.nvm}/versions/node/v<X.Y.Z>/bin:$PATH" <command>`.

## Check the version before blaming the code

1. Read the pin: `.nvmrc` and `engines.node` in `package.json`.
2. Read what runs: `node --version` and `command -v node`, inside the call above.
3. `.nvmrc` may name only a major (`24`), so `nvm use` picks the highest installed
   release of that major, which can sit below an `engines` floor like `>=24.4`. Compare the
   full version with `engines.node`, not just the major.
4. A script that exits 0 and prints nothing on an old Node is a version symptom, not a
   code bug. Re-run it on the pinned version before debugging.

`engines` is advisory for npm unless `engine-strict` is set
([npm docs](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#engines)); do not
treat a clean install as proof the version is right.

## Diagnose a wrong or missing Node (read-only)

List, do not change: `type -a node`, `command -v nvm`, `nvm ls` and `nvm current` (inside
the sourced call), the `PATH` entries in order, and `grep -n nvm ~/.zshrc ~/.zprofile
~/.bashrc ~/.bash_profile`. Report which `node` wins, whether it lives under
`$NVM_DIR/versions`, `/opt/homebrew`, `/usr/local` or the system, and which rc file (if any)
loads nvm. A Homebrew or `/usr/local` Node ahead of nvm on `PATH` is the usual shadowing
cause.

## Fix, with the user's yes first

- Missing version: `nvm install` with no argument installs the `.nvmrc` version.
- Default for new shells: `nvm alias default <version>`; `nvm use` affects only the current
  shell ([nvm README](https://github.com/nvm-sh/nvm#usage)).
- Globals lost on a version switch: `nvm install --reinstall-packages-from=<old> <new>`
  ([nvm README](https://github.com/nvm-sh/nvm#migrating-global-packages-while-installing)).
- Native-module ABI errors after a switch: delete `node_modules`, then reinstall with the
  project's package manager.
- nvm itself is installed by `curl <url> | bash`, a fetch-and-execute install: load
  `fetch-execute-guide` and ask before running it.
- Do not run `brew install node`, `sudo npm`, or edit an rc file as a first fix. Show the
  change and ask.

## Upgrade the pin across a repo

Pick an LTS major from the [Node release schedule](https://github.com/nodejs/Release#release-schedule).
Change every place that names the major, then grep for the old one:

- `.nvmrc` and `engines.node`, which must agree.
- CI `node-version`, or `node-version-file: .nvmrc`
  ([setup-node](https://github.com/actions/setup-node#usage)) so CI reads the same file.
- The `@types/node` major (inference: it should follow the runtime major).
- Docs and Dockerfiles that name the old major.

In CI, use `actions/setup-node`; do not install nvm there.
