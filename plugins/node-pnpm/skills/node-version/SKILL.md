---
name: node-version
description: |
  Use when a command must run on the project's Node version, or fails for a Node-version
  reason: `nvm: command not found`, `node` resolving to the wrong version, an `.nvmrc` or
  `engines` mismatch, a script that exits 0 and does nothing, switching versions, moving a
  repo to a new Node major (upgrade the pin), Node setup in CI. Returns the version check
  and the exact commands. Not for installing packages (use `pnpm-usage`) or Node API
  questions.
metadata:
  version: "1.1.0"
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
([nvm README](https://github.com/nvm-sh/nvm#verify-installation)). Two separate hazards:

- **The switch does not persist.** Each Claude Code Bash command runs in a separate process
  and environment variables do not carry over
  ([tools reference](https://code.claude.com/docs/en/tools-reference#bash-tool-behavior)),
  so `nvm use` in one call is gone in the next. Observed on one machine: `nvm use` printed
  the pinned version, and `node --version` in the next call showed the default again.
- **`nvm` may not be defined.** Claude Code captures functions from the startup file at
  session start (same page), so `nvm` exists only if that file loads it. Non-interactive
  shells skip profile files
  ([nvm README, Docker section](https://github.com/nvm-sh/nvm#installing-in-docker)), so
  `bash -c`, hooks and CI can report `nvm: command not found`. A lazy-loading stub can
  also make `command -v nvm` succeed while `nvm use` fails; one open issue reports that the
  zsh snapshot drops single-underscore functions
  ([claude-code#107038](https://github.com/anthropics/claude-code/issues/107038)), so test
  with `nvm --version`.

Run `nvm use` and the command in one call. This form works whether or not `nvm` is defined:

```bash
bash -c '. "${NVM_DIR:-$HOME/.nvm}/nvm.sh" && nvm use >/dev/null && <command>'
```

`nvm use` returns non-zero on failure, so the `&&` stops the chain; `;` would run the
command on the wrong Node. If nvm lives under `$XDG_CONFIG_HOME/nvm`, set `NVM_DIR` to it.

To persist the version for every Bash command in a session, a `SessionStart`, `Setup`,
`CwdChanged` or `FileChanged` hook can write exports to `CLAUDE_ENV_FILE`
([hooks reference](https://code.claude.com/docs/en/hooks#persist-environment-variables)).
The docs' nvm example hardcodes a version and one issue reports the variable arriving
empty, so test it before relying on it. Setting it up edits the user's settings: ask first.

`nvm use` with no argument reads `.nvmrc` from the current directory or a parent
([nvm README, .nvmrc](https://github.com/nvm-sh/nvm#nvmrc)). If a hook blocks compound
commands, put the version's bin directory on `PATH` for the one command instead:
`PATH="${NVM_DIR:-$HOME/.nvm}/versions/node/v<X.Y.Z>/bin:$PATH" <command>`.

## Check the version before blaming the code

1. Read the pin: `.nvmrc` and `engines.node` in `package.json`.
2. Read what runs: `node --version` and `command -v node`, inside the call above.
3. `.nvmrc` may name only a major (`24`). `nvm use 24` picks the highest installed 24.x,
   which can sit below an `engines` floor like `>=24.4`; `nvm install 24` resolves against
   the remote index, so it can fetch a newer 24.x than `nvm use` selected (from the
   `nvm.sh` source, not run). Compare the full version with `engines.node`, not just the
   major.
4. A script that exits 0 and prints nothing on an old Node is a version symptom, not a
   code bug. Re-run it on the pinned version before debugging. Running `.ts` files natively
   needs Node 22.18 or newer ([Node TypeScript docs](https://nodejs.org/api/typescript.html)).

`engines` is advisory for `npm install` only. Tested on npm 11.19.0: a root mismatch warns
(`EBADENGINE`) on install and is ignored by `npm run` and `node --run`
([npm docs](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#engines)).
`devEngines.runtime` errors on a mismatch by default (same page, tested). pnpm fails on a
root `engines` mismatch even without `engineStrict`, per its
[docs](https://pnpm.io/package_json) (not tested). Do not treat a clean install as proof
the version is right.

## Diagnose a wrong or missing Node (read-only)

List, do not change: `type -a node`, `nvm --version`, `nvm ls` and `nvm current` (inside
the sourced call), the `PATH` entries in order, and `grep -n nvm ~/.zshrc ~/.zprofile
~/.bashrc ~/.bash_profile`. Report which `node` wins, whether it lives under
`$NVM_DIR/versions`, `/opt/homebrew`, `/usr/local` or the system, and which rc file (if any)
loads nvm. A Homebrew or `/usr/local` Node ahead of nvm on `PATH` is a common shadowing
cause; the nvm README's [Problems](https://github.com/nvm-sh/nvm#problems) section covers
`PATH` order. nvm before v0.41.0 can pile up `PATH` entries in nested sessions
([release notes](https://github.com/nvm-sh/nvm/releases/tag/v0.41.0)).

## Fix, with the user's yes first

- Missing version: `nvm install` with no argument installs the `.nvmrc` version.
- Default for new shells: `nvm alias default <version>`; `nvm use` affects only the current
  shell ([nvm README](https://github.com/nvm-sh/nvm#usage)).
- Globals lost on a version switch: `nvm install --reinstall-packages-from=<old> <new>`
  ([nvm README](https://github.com/nvm-sh/nvm#migrating-global-packages-while-installing)).
- Native-module ABI errors after a switch: Node's own error text suggests `npm rebuild` or
  `npm install`; try the project's rebuild first and delete `node_modules` only if that
  fails. Node-API addons need no rebuild
  ([Node-API docs](https://nodejs.org/api/n-api.html)).
- nvm itself is installed by `curl <url> | bash`, a fetch-and-execute install: load
  `fetch-execute-guide` and ask before running it. `install.sh` has no checksum or
  signature; the README's Git Install avoids the pipe, and `PROFILE=/dev/null` skips the
  rc-file edit ([nvm README](https://github.com/nvm-sh/nvm#installing-and-updating)).
- On nvm older than v0.41.0, do not run `nvm use` in a directory with an untrusted
  `.nvmrc`: the project's [security advisories](https://github.com/nvm-sh/nvm/security/advisories)
  list `.nvmrc` and version-string issues. Check with `nvm --version`.
  `NVM_NODEJS_ORG_MIRROR` is a trust decision; do not point it at an unreviewed host.
- Do not run `brew install node`, `sudo npm`, or edit an rc file as a first fix. Show the
  change and ask.

## Upgrade the pin across a repo

Pick a supported LTS major from the [Node release schedule](https://github.com/nodejs/Release#release-schedule),
and read its EOL date and latest patch in `schedule.json`: only that file carries EOL
dates, and a pinned major should be on a patched release
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
