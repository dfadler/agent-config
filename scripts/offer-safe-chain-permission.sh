#!/usr/bin/env bash
# Offers to pre-approve Aikido Safe Chain's official installer in Claude
# Code's permission settings, so a future agent session that needs to run it
# (e.g. because a repo's CONTRIBUTING.md documents it, as
# github.com/dfadler/zombie-mermaid's does) doesn't have to stop and ask.
#
# Safe Chain (https://github.com/AikidoSec/safe-chain) is a free, tokenless
# CLI that wraps npm/pnpm/npx/yarn and blocks installs of packages flagged as
# malware or published in the last 48 hours. Its documented installer is a
# curl | sh pipeline, which Claude Code's auto-mode classifier blocks by
# default like any pipe-to-shell installer — even though the command below is
# pinned to an exact version and verified against a published sha256 before
# it runs. This script does not install Safe Chain itself; it only offers to
# allowlist that one pinned command so Claude Code stops asking about it.
#
# Usage: offer-safe-chain-permission.sh [--settings-file PATH] [--yes|--no]

set -uo pipefail

SETTINGS_FILE="${HOME:-}/.claude/settings.json"
ANSWER=""

usage() {
  cat <<'USAGE'
Usage: offer-safe-chain-permission.sh [--settings-file PATH] [--yes|--no]

Offers to add a Bash permission rule to Claude Code's settings.json that
pre-approves Aikido Safe Chain's pinned, checksum-verified installer command.

  --settings-file PATH   Settings file to update (default: ~/.claude/settings.json)
  --yes                  Add the rule without prompting
  --no                   Skip without prompting
  -h, --help             Show this message and exit
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --settings-file)
      SETTINGS_FILE="$2"
      shift
      ;;
    --yes) ANSWER="yes" ;;
    --no) ANSWER="no" ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

# Pinned to the exact version + checksum documented in CONTRIBUTING.md-style
# install instructions. Changing either constant below changes the rule this
# script offers — bump both together, from an install command you've verified.
SAFE_CHAIN_VERSION="1.5.15"
SAFE_CHAIN_SHA256="de0565e3d6346407a604e84e639e95fea8758748063da2216bbfdca5feda5dd2"
SAFE_CHAIN_INSTALL_CMD="curl -fsSL https://github.com/AikidoSec/safe-chain/releases/download/${SAFE_CHAIN_VERSION}/install-safe-chain.sh -o /tmp/install-safe-chain.sh && echo \"${SAFE_CHAIN_SHA256}  /tmp/install-safe-chain.sh\" | sha256sum -c - && sh /tmp/install-safe-chain.sh && rm /tmp/install-safe-chain.sh"
RULE="Bash(${SAFE_CHAIN_INSTALL_CMD})"

rule_present() {
  [[ -f "$SETTINGS_FILE" ]] || return 1
  command -v jq >/dev/null 2>&1 || return 1
  jq -e --arg r "$RULE" '(.permissions.allow // []) | index($r)' \
    "$SETTINGS_FILE" >/dev/null 2>&1
}

add_rule() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "jq is not installed — add this rule to $SETTINGS_FILE by hand:" >&2
    echo "  \"$RULE\"" >&2
    return 1
  fi

  mkdir -p "$(dirname "$SETTINGS_FILE")"
  [[ -f "$SETTINGS_FILE" ]] || echo '{}' >"$SETTINGS_FILE"

  local tmp
  tmp="$(mktemp)"
  if ! jq --arg r "$RULE" \
    '.permissions.allow = ((.permissions.allow // []) + [$r])' \
    "$SETTINGS_FILE" >"$tmp"; then
    echo "Failed to update $SETTINGS_FILE — is it valid JSON?" >&2
    rm -f "$tmp"
    return 1
  fi
  mv "$tmp" "$SETTINGS_FILE"
  echo "✓ Added Aikido Safe Chain installer to $SETTINGS_FILE"
}

if rule_present; then
  echo "✓ Aikido Safe Chain installer already pre-approved in $SETTINGS_FILE"
  exit 0
fi

if [[ -z "$ANSWER" ]]; then
  # No TTY (CI, a pipe, a non-interactive test run): a blocking `read` here
  # would hang the caller, so skip rather than guess. Pass --yes/--no to
  # decide non-interactively instead.
  if [[ ! -t 0 ]]; then
    echo "Skipping Aikido Safe Chain permission prompt (no interactive terminal)." >&2
    exit 0
  fi
  echo
  echo "Some repos (e.g. via CONTRIBUTING.md) ask you to install Aikido Safe Chain"
  echo "(https://github.com/AikidoSec/safe-chain), a free CLI that blocks npm/pnpm/"
  echo "etc. installs of malware-flagged or just-published packages."
  echo "Claude Code's auto mode blocks its curl|sh installer by default, even though"
  echo "the command is pinned to version $SAFE_CHAIN_VERSION and checksum-verified"
  echo "before it runs."
  echo
  reply=""
  read -r -p "Pre-approve that pinned command in $SETTINGS_FILE? [y/N] " reply
  case "$reply" in
    [yY] | [yY][eE][sS]) ANSWER="yes" ;;
    *) ANSWER="no" ;;
  esac
fi

if [[ "$ANSWER" == "yes" ]]; then
  add_rule
else
  echo "Skipped. Re-run this script anytime, or add the rule manually — see README.md."
fi
