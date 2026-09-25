# vite plugin for Claude Code

Skills and agents for authoring, reviewing, testing, and maintaining Vite plugins.

## Skills

| Skill | Trigger |
|-------|---------|
| `vite:scaffold` | Creating a new Vite plugin file |
| `vite:review` | Reviewing an existing plugin against conventions |
| `vite:test` | Writing tests for a plugin (transform, generateBundle, configureServer patterns) |
| `vite:peer-deps` | Updating peerDependencies after a Vite major release |
| `vite:dev-workflow` | Setting up a development and testing workflow for a plugin package |

## Agents

| Agent | Use |
|-------|-----|
| `vite-plugin-reviewer` | Independent review of a plugin diff; spawn from code-review orchestration |

## Convention file

`vite-plugin.md` is included in `DEFAULT_ENABLED` — it provides always-on rules
about deprecated hooks and plugin structure that apply whenever Vite plugin code
is being written or reviewed.

## Optional: deprecated-API hook

This plugin does not enable any hooks by default. To get a nudge to run
`vite:review` after editing a Vite plugin file, add the following to your
`~/.claude/settings.json` (or `.claude/settings.json` in a project):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'FILE_PATH=$(python3 -c \"import sys,json; d=json.load(sys.stdin); print(d.get(\\\"tool_input\\\",{}).get(\\\"file_path\\\",\\\"\\\"))\" 2>/dev/null || echo \"\"); case \"$FILE_PATH\" in */vite/plugins/*.ts|*/vite/*.config.ts) echo \"💡 Vite plugin edited — consider running /vite:review to check for deprecated APIs\" ;; esac'"
          }
        ]
      }
    ]
  }
}
```

This fires only when editing files under `vite/plugins/` or `vite/*.config.ts`
and prints an advisory message. It does not block or modify anything.

## Hudl-specific layer

Hudl-frontends conventions (file placement in `core/packages/apps-core/src/vite/`,
return type `VitePlugin`, Vitest shared config) will live in a separate
`hudl-vite` plugin in the `hudl-agent-config` repository.
