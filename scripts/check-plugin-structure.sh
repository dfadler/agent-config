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

# Extract one scalar from a Markdown file's YAML frontmatter. Only handles the
# flat `key: value` and `key: |` block forms this repo uses; anything more
# structured belongs in a real YAML parser, not here.
frontmatter_has() {
  local file="$1" key="$2"
  awk -v key="$key" '
    NR == 1 { if ($0 != "---") exit 1; next }
    /^---[[:space:]]*$/ { exit found ? 0 : 1 }
    $0 ~ "^" key ":" {
      value = substr($0, length(key) + 2)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      # `key: |` opens a block scalar; the value is on the following lines.
      if (value == "|" || value == ">" || value != "") found = 1
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

check_manifest() {
  local plugin_dir="$1" manifest="$1/.claude-plugin/plugin.json"
  local plugin_name
  plugin_name="$(basename "$plugin_dir")"

  if [[ ! -f "$manifest" ]]; then
    fail "$plugin_dir: missing .claude-plugin/plugin.json"
    return
  fi
  if ! python3 -m json.tool "$manifest" >/dev/null 2>&1; then
    fail "$manifest: not valid JSON"
    return
  fi

  local key
  for key in name version description; do
    python3 -c "
import json, sys
d = json.load(open('$manifest'))
sys.exit(0 if d.get('$key') else 1)
" 2>/dev/null || fail "$manifest: missing or empty '$key'"
  done

  local declared
  declared="$(python3 -c "
import json
print(json.load(open('$manifest')).get('name', ''))
" 2>/dev/null || echo "")"
  [[ "$declared" == "$plugin_name" ]] ||
    fail "$manifest: name '$declared' does not match plugin directory '$plugin_name'"
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
