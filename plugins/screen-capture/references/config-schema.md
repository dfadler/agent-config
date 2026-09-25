# screen-capture config schema

Vault config for the `screen-capture` plugin, read via `second-brain:config`
(frontmatter only — body text is ignored). Part of #321; schema for #322-#326.

## Vault tree

```
config/
├── global/
│   └── screen-capture.md    # engine, browser, viewport, auth strategy, output, lighthouse
└── projects/
    └── <project-name>/
        └── screen-capture.md    # auth secrets, output dirs
```

Project config overrides global per key; a key absent from both has no
skill-level default documented here (see each skill's own SKILL.md).

## Sources

| Source | Where | Used by any key below? |
|---|---|---|
| Vault (global) | `config/global/screen-capture.md` frontmatter | Yes |
| Vault (project) | `config/projects/<project>/screen-capture.md` frontmatter | Yes |
| Project settings | `.claude/settings.json` | No — this repo's screen-capture keys are vault-only |
| Machine settings | `~/.claude/settings.json` | No for these keys; **yes** for the vault path itself (`secondBrain.vaultPath`, resolved `SECOND_BRAIN_VAULT_PATH` env var → this key — see #327) |
| Env var override | `SCREEN_CAPTURE_<KEY>` | Not yet — CI override system tracked separately in #331 |

Vault access requires the vault path to already be known, which is why that
one value lives in machine settings/env var rather than the vault itself.

## Keys

### Engine & browser — vault (global)

| Key | Type | Example | Notes |
|---|---|---|---|
| `engine` | enum | `playwright` \| `chrome-cdp` | Capture backend |
| `browser_type` | enum | `chromium` \| `firefox` \| `webkit` | Playwright browser (ignored for `chrome-cdp`) |
| `headless` | boolean | `true` | |
| `viewport_width` | integer (px) | `1280` | |
| `viewport_height` | integer (px) | `800` | |

### Auth — vault (project), except strategy

| Key | Type | Example | Source | Notes |
|---|---|---|---|---|
| `auth_strategy` | enum | `none` \| `storage_state` \| `env_var` \| `secrets_manager` | Vault (global) | Per-project auth may still override this key |
| `auth_storage_state_path` | string (path) | `.auth/storage-state.json` | Vault (project) | Playwright `storageState` file to load |
| `auth_secret_name` | string | `myapp/screen-capture/login` | Vault (project) | Secrets manager entry id |
| `auth_secret_region` | string | `us-east-1` | Vault (project) | Secrets manager region |
| `auth_env_var` | string | `SCREEN_CAPTURE_AUTH_TOKEN` | Vault (project) | Env var holding the credential when `auth_strategy: env_var` |
| `current_storage_state_path` | string (path) | `.auth/.current-session.json` | Vault (project) | Runtime-resolved, written by the capture skill after login — not hand-authored |

### Output — vault (global), except dirs

| Key | Type | Example | Source | Notes |
|---|---|---|---|---|
| `output_type` | enum | `screenshot` \| `video` \| `both` | Vault (global) | |
| `output_dir` | string (path) | `captures/` | Vault (project) | Project-relative output location |
| `video_width` | integer (px) | `1280` | Vault (global) | |
| `video_height` | integer (px) | `800` | Vault (global) | |

### Playwright — vault (global)

| Key | Type | Example | Notes |
|---|---|---|---|
| `wait_until` | enum | `load` \| `domcontentloaded` \| `networkidle` \| `commit` | Playwright `page.goto` option |
| `timeout_ms` | integer | `30000` | |
| `responsive_breakpoints` | list\<integer\> (px) | `[375, 768, 1280]` | Viewport widths for the responsive pass |

### Lighthouse — vault (global), except output dir

| Key | Type | Example | Source | Notes |
|---|---|---|---|---|
| `lighthouse_enabled` | boolean | `false` | Vault (global) | |
| `lighthouse_form_factors` | list\<enum\> | `[mobile, desktop]` | Vault (global) | |
| `lighthouse_output_dir` | string (path) | `captures/lighthouse/` | Vault (project) | |

## Templates

Copy into the vault and fill in: `templates/global-screen-capture.md`,
`templates/project-screen-capture.md`.
