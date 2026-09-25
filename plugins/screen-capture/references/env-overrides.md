# screen-capture env var overrides

Every config key can be set via a `SCREEN_CAPTURE_<KEY_UPPERCASE>` env var, for
CI environments where the vault (second-brain) and settings files aren't
available.

Example:
```
SCREEN_CAPTURE_ENGINE=playwright
SCREEN_CAPTURE_BASE_URL=http://localhost:8117
SCREEN_CAPTURE_AUTH_STRATEGY=playwright-storage-state
SCREEN_CAPTURE_AUTH_STORAGE_STATE_PATH=/tmp/state.json
SCREEN_CAPTURE_OUTPUT_TYPE=image
SCREEN_CAPTURE_OUTPUT_DIR=./screenshots
```

## Priority order

Highest wins; each step falls through to the next only if the key is unset.

1. Invocation params (explicit args passed to the skill/command)
2. `SCREEN_CAPTURE_<KEY_UPPERCASE>` env vars
3. second-brain project config (`config/projects/<project-name>/screen-capture.md`)
4. second-brain global config (`config/global/screen-capture.md`)
5. `.claude/settings.json` (project)
6. `~/.claude/settings.json` (user/machine)
7. SKILL.md defaults

## Overridable keys

| Key | Env var |
|---|---|
| `engine` | `SCREEN_CAPTURE_ENGINE` |
| `browser_type` | `SCREEN_CAPTURE_BROWSER_TYPE` |
| `headless` | `SCREEN_CAPTURE_HEADLESS` |
| `viewport_width` | `SCREEN_CAPTURE_VIEWPORT_WIDTH` |
| `viewport_height` | `SCREEN_CAPTURE_VIEWPORT_HEIGHT` |
| `auth_strategy` | `SCREEN_CAPTURE_AUTH_STRATEGY` |
| `auth_storage_state_path` | `SCREEN_CAPTURE_AUTH_STORAGE_STATE_PATH` |
| `auth_secret_name` | `SCREEN_CAPTURE_AUTH_SECRET_NAME` |
| `auth_secret_region` | `SCREEN_CAPTURE_AUTH_SECRET_REGION` |
| `auth_env_var` | `SCREEN_CAPTURE_AUTH_ENV_VAR` |
| `current_storage_state_path` | `SCREEN_CAPTURE_CURRENT_STORAGE_STATE_PATH` |
| `output_type` | `SCREEN_CAPTURE_OUTPUT_TYPE` |
| `output_dir` | `SCREEN_CAPTURE_OUTPUT_DIR` |
| `video_width` | `SCREEN_CAPTURE_VIDEO_WIDTH` |
| `video_height` | `SCREEN_CAPTURE_VIDEO_HEIGHT` |
| `wait_until` | `SCREEN_CAPTURE_WAIT_UNTIL` |
| `timeout_ms` | `SCREEN_CAPTURE_TIMEOUT_MS` |
| `responsive_breakpoints` | `SCREEN_CAPTURE_RESPONSIVE_BREAKPOINTS` |
| `lighthouse_enabled` | `SCREEN_CAPTURE_LIGHTHOUSE_ENABLED` |
| `lighthouse_form_factors` | `SCREEN_CAPTURE_LIGHTHOUSE_FORM_FACTORS` |
| `lighthouse_output_dir` | `SCREEN_CAPTURE_LIGHTHOUSE_OUTPUT_DIR` |

Note: `base_url` (used in the example above) is not part of the key schema
enumerated in #330 — confirm it belongs here once that issue's schema doc lands.
