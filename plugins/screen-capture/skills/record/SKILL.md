---
name: record
description: >
  Record headless Playwright video of keyboard interactions (Tab order, focus
  management, dialogs, Storybook play functions) as .webm. ALWAYS invoke this
  skill first when asked to "record" a keyboard walkthrough, Tab order or
  focus behavior, or a Storybook story, before writing any script: it supplies
  the required Chromium user-agent override, the context-close ordering, and
  the setTimeout stretch for short play functions. For a plain page
  screenshot or a single-URL video with no key presses, use
  `screen-capture:capture`.
license: MIT
metadata:
  version: "0.1.0"
---

# Record keyboard-interaction video

## Contract

- **Input:** a base URL plus story ids or routes, and the keys/clicks to drive.
- **Output:** one `.webm` per story and browser in an output directory.
- **Does not:** upload the files (use `screen-capture:attach`), or start the dev server.

Copy `${CLAUDE_PLUGIN_ROOT}/references/record-native.cjs` and fill in the `CONFIG`
block (story ids, route pattern, play-function regex, open-button name, dialog
selector, output dir). Setup and run:

```bash
npx --yes playwright install chromium webkit
node record-native.cjs
```

The script is headless: no window opens, no focus is stolen. It drives real
`page.keyboard.press('Tab')` presses, not synthetic events, and runs one context per
story and browser in parallel with `Promise.all`. Playwright records 25 fps.

## Rules the script encodes (do not drop them)

1. **Override the Chromium user agent.** Headless Chromium reports `HeadlessChrome`;
   libraries that sniff the UA (dialog libraries, for one) take the wrong code path.
   Required for every Chromium context, not optional.
2. **Click inside a dialog before pressing Tab.** Focus does not land in it after the
   opening click.
3. **Stretch short play functions.** Storybook play functions finish in about 160 ms
   (about 4 frames). The `addInitScript` patch of `window.setTimeout` lengthens
   zero-length waits during the play phase (250 ms each is about 8 s total). Render
   phase events come from `window.__STORYBOOK_ADDONS_CHANNEL__`
   (`storyRenderPhaseChanged`, `playFunctionThrewException`).
4. **`ctx.close()` before `video.saveAs()`.** The file is not finalized until the
   context closes.
5. **Use `page.goto('file://...')`, never `setContent`, for local files.** `setContent`
   with a `file://` source is blocked.

## Checking a recording without ffmpeg

Load the `.webm` in headless Chromium (`page.goto('file://...')`), set
`video.currentTime`, wait for `seeked`, then `page.screenshot()`. The template's
`extractFrame` helper does this.

## Limits to state when sharing

- Headless only; no real window or OS focus ring behavior.
- Playwright WebKit is not Safari: it does not reflect Safari's "Press Tab to
  highlight each item" setting.
- Fixed pauses mean a slow machine can show mid-transition frames.

Upload with `screen-capture:attach` (via `gh-attach-image`); the URL 404s until the
PR body that references it is saved.
