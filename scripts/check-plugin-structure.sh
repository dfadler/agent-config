#!/usr/bin/env bash
# Validate the declarative metadata this repo ships: plugin manifests, skill
# frontmatter, and agent frontmatter.
#
# Bash has no typechecker, so this is the nearest equivalent for this repo —
# the files that MUST parse and MUST agree with each other are the plugin's
# JSON manifest and the YAML frontmatter Claude Code reads to discover skills
# and agents. A skill whose `name:` drifts from its directory, or a manifest
# that stops being valid JSON, fails silently at load time rather than loudly
# in review. That drift is not hypothetical here: the plugin was renamed once
# already (37b8bef), which moved every directory and every `name:` with it.
#
# Checks, per plugin under plugins/*/:
#   * .claude-plugin/plugin.json parses as JSON, has name/version/description,
#     and its `name` matches the plugin directory.
#   * every skills/*/SKILL.md has delimited frontmatter carrying `name` and a
#     non-empty `description`, and `name` matches the skill directory.
#   * every agents/*.md has the same, with `name` matching the filename.
#   * every *.sh shipped under a skill's scripts/ is executable — a skill that
#     documents `scripts/foo.sh` is useless if the mode bit didn't survive.
set -euo pipefail

ROOT="${1:-.}"
errors=()

fail() { errors+=("$1"); }

# True when the frontmatter carries `key` with a non-empty EFFECTIVE value.
#
# "Effective" is the subtlety: several YAML spellings look like a value but
# resolve to null, and an empty description is exactly the silent drift this
# check exists to catch. Rejected accordingly:
#   key:                 (nothing)
#   key: ""   / key: ''  (explicit empty scalar)
#   key: # comment       (a comment is not a value)
#   key: |               (block opener with no indented body under it)
#   key: null|Null|NULL|~   (the YAML Core schema's null spellings)
#
# The null match is deliberately case-SENSITIVE and exact. YAML Core resolves
# only those four spellings to null, so `NuLl` and `nullable` are ordinary
# strings and must still pass — matching case-insensitively, or on a prefix,
# would reject valid descriptions.
#
# Only the flat `key: value` and block-scalar forms this repo uses are handled;
# anything more structured belongs in a real YAML parser, not here.
frontmatter_has() {
  local file="$1" key="$2"
  # The empty-single-quote literal is passed in rather than written inline: it
  # cannot appear inside a single-quoted awk program without unreadable escaping.
  awk -v key="$key" -v empty_sq="''" '
    NR == 1 { if ($0 != "---") exit 1; next }
    /^---[[:space:]]*$/ { exit found ? 0 : 1 }

    # Inside a block scalar: any indented, non-blank line is real content.
    in_block {
      if ($0 ~ /^[[:space:]]*$/) next
      if ($0 ~ /^[[:space:]]+/) { found = 1; in_block = 0; next }
      in_block = 0   # dedented back to a sibling key without any content
    }

    $0 ~ "^" key ":" {
      value = substr($0, length(key) + 2)
      # In YAML a " #" (space-hash) begins a comment in a plain scalar.
      sub(/[[:space:]]+#.*$/, "", value)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      if (value ~ /^[|>][0-9+-]*$/) { in_block = 1; next }   # block opener
      if (value == "\"\"" || value == empty_sq) next         # explicit empty
      # Exact, case-sensitive: YAML Core resolves only these to null.
      if (value == "null" || value == "Null" || value == "NULL" || value == "~") next
      if (value != "" && value !~ /^#/) found = 1
    }
    END { exit found ? 0 : 1 }
  ' "$file"
}

frontmatter_value() {
  local file="$1" key="$2"
  awk -v key="$key" '
    NR == 1 && $0 != "---" { exit }
    NR > 1 && /^---[[:space:]]*$/ { exit }
    $0 ~ "^" key ":" {
      value = substr($0, length(key) + 2)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      print value
      exit
    }
  ' "$file"
}

# One Python call, with STATIC source and every filesystem-derived value passed
# through argv.
#
# The first version interpolated "$manifest" into the source string. A plugin
# directory containing a single quote closed that literal and the rest of the
# path ran as Python — arbitrary code execution during what is meant to be
# read-only validation. Caught in review on #60 and reproduced end to end.
# Nothing derived from the filesystem may reach Python (or a shell) as source.
check_manifest() {
  local plugin_dir="$1" manifest="$1/.claude-plugin/plugin.json"
  local plugin_name
  plugin_name="$(basename "$plugin_dir")"

  if [[ ! -f "$manifest" ]]; then
    fail "$plugin_dir: missing .claude-plugin/plugin.json"
    return
  fi

  # Assigned inside `if` on purpose: under `set -e` a bare assignment whose
  # command substitution exits non-zero terminates the script, which would
  # swallow this failure and every later plugin's.
  local output
  if ! output="$(python3 -c '
import json, sys

path, expected = sys.argv[1], sys.argv[2]
try:
    with open(path) as fh:
        data = json.load(fh)
except (json.JSONDecodeError, UnicodeDecodeError):
    print("not valid JSON")
    sys.exit(1)
except OSError as exc:
    print("unreadable: %s" % exc.strerror)
    sys.exit(1)

if not isinstance(data, dict):
    print("top level is not a JSON object")
    sys.exit(1)

for key in ("name", "version", "description"):
    if not data.get(key):
        print("missing or empty %r" % key)
        sys.exit(1)

if data["name"] != expected:
    print("name %r does not match plugin directory %r" % (data["name"], expected))
    sys.exit(1)
' "$manifest" "$plugin_name" 2>&1)"; then
    fail "$manifest: $output"
  fi
}

check_frontmatter_doc() {
  local file="$1" expected="$2" label="$3"

  if ! frontmatter_has "$file" name; then
    fail "$file: frontmatter missing 'name' (or no leading '---' delimiter)"
    return
  fi
  frontmatter_has "$file" description ||
    fail "$file: frontmatter missing a non-empty 'description'"

  local declared
  declared="$(frontmatter_value "$file" name)"
  [[ "$declared" == "$expected" ]] ||
    fail "$file: name '$declared' does not match $label '$expected'"
}

shopt -s nullglob

plugins=("$ROOT"/plugins/*/)
if [[ ${#plugins[@]} -eq 0 ]]; then
  echo "::error::no plugins found under $ROOT/plugins/" >&2
  exit 1
fi

for plugin_dir in "${plugins[@]}"; do
  plugin_dir="${plugin_dir%/}"
  check_manifest "$plugin_dir"

  for skill_dir in "$plugin_dir"/skills/*/; do
    skill_dir="${skill_dir%/}"
    skill_name="$(basename "$skill_dir")"
    skill_md="$skill_dir/SKILL.md"
    if [[ ! -f "$skill_md" ]]; then
      fail "$skill_dir: missing SKILL.md"
      continue
    fi
    check_frontmatter_doc "$skill_md" "$skill_name" "skill directory"

    for script in "$skill_dir"/scripts/*.sh; do
      [[ -x "$script" ]] || fail "$script: not executable (chmod +x)"
    done
  done

  for agent_md in "$plugin_dir"/agents/*.md; do
    agent_name="$(basename "$agent_md" .md)"
    check_frontmatter_doc "$agent_md" "$agent_name" "filename"
  done
done

if [[ ${#errors[@]} -gt 0 ]]; then
  echo "::error::Plugin structure validation failed:" >&2
  printf '  %s\n' "${errors[@]}" >&2
  exit 1
fi

echo "✓ Plugin manifests, skill frontmatter, and agent frontmatter are consistent."
