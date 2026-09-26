---
auth_strategy: storage_state
auth_storage_state_path: .auth/storage-state.json
auth_secret_name: myproject/screen-capture/login
auth_secret_region: us-east-1
auth_env_var: SCREEN_CAPTURE_AUTH_TOKEN
output_dir: captures/
lighthouse_output_dir: captures/lighthouse/
---

Per-project overrides for `screen-capture`. Vault path:
`config/projects/<project-name>/screen-capture.md`. Only auth secrets and
output dirs belong here — everything else falls back to
`config/global/screen-capture.md`. `current_storage_state_path` is omitted:
it's written by the capture skill at runtime, not hand-authored.
