---
name: nvm-usage
description: |
  Use when a command must run under an nvm-managed Node: `nvm: command not found`, an
  `nvm use` that does not stick between commands, the wrong `node` first on `PATH`
  (Homebrew shadowing), installing, switching or defaulting a Node version with nvm,
  `.nvmrc` handling, global packages lost on a switch. Returns the one-call command and
  the safe fix. Not for choosing or upgrading the Node version (use `nodejs:node-version`)
  or installing packages (use `pnpm:pnpm-usage`).
metadata:
  version: "1.0.0"
---

# Running commands under nvm

## Contract

- **Input:** a project directory using nvm and a symptom or task (run a command on the
  pinned Node, diagnose which `node` runs, switch or install a version).
- **Output:** the resolved `node` path and version, then the commands to run, or the
  shell-config change for the user to approve.
- **Does not:** edit shell rc files, install nvm, or install Homebrew Node without the
  user's yes, and does not decide which Node version a project should use
  (`nodejs:node-version` does).

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

A major-only `.nvmrc` (`24`): `nvm use 24` picks the highest installed 24.x, while
`nvm install 24` resolves against the remote index, so it can fetch a newer 24.x than
`nvm use` selected (from the `nvm.sh` source, not run). After switching, compare the full
version with the project's `engines.node` (`nodejs:node-version`).

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
