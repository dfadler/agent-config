---
engine: playwright
browser_type: chromium
headless: true
viewport_width: 1280
viewport_height: 800
auth_strategy: none
output_type: screenshot
video_width: 1280
video_height: 800
wait_until: networkidle
timeout_ms: 30000
responsive_breakpoints: [375, 768, 1280]
lighthouse_enabled: false
lighthouse_form_factors: [mobile, desktop]
---

Global defaults for `screen-capture`. Vault path: `config/global/screen-capture.md`.
See `plugins/screen-capture/references/config-schema.md` for what each key means
and which of these a per-project config is expected to override.
