---
name: playwright
description: |
  Drive Playwright (Chromium and WebKit) from a Node.js script: headless video
  recording (.webm), real key presses, Storybook play-function recordings,
  frame extraction, and parallel recording. Use when asked to record a browser
  interaction, script a browser, or capture a story's behavior, and for the
  gotchas (user-agent sniffing, ctx.close ordering, file:// pages). For a plain
  screenshot of a URL use screen-capture:capture instead.
license: MIT
metadata:
  version: "0.1.0"
---

# Playwright scripting

## Contract

- **Input:** a URL or Storybook story, the browsers to run, and what to do on the page.
- **Output:** `.webm` files, screenshots or extracted frames on disk, with paths reported.
- **Does not:** upload files (use `gh-attach-image` for PR bodies), start the app
  under test, or take plain screenshots (`screen-capture:capture`).

## Setup

```bash
npm i -D playwright            # or pnpm add -D playwright
npx playwright install chromium webkit
```

`playwright install` downloads browsers; ask the user before running it. Run
scripts with `node script.mjs`. Start from `references/record.mjs`: one context
per recording, `recordVideo`, a real key press, and the close-then-save order.

## Recording rules

- **Close before save.** The video file is finalized when the context closes:
  `await ctx.close()` first, then `await video.saveAs(path)`.
- **Real keys vs synthetic events.** `page.keyboard.press('Tab')` sends a real
  browser key event, so focus rings, `:focus-visible` and browser default actions
  behave as for a user. Dispatched events (or Testing Library `userEvent`) are
  synthetic: fine for logic, wrong for anything keyboard-modality-sensitive.
- **User agent.** Headless Chromium reports `HeadlessChrome`. If the app sniffs the
  UA, set `userAgent` on `browser.newContext` to a normal Chrome string.
- **Dialog focus.** After a click opens a dialog, focus may not be inside it. Click
  inside the dialog before pressing Tab, or the Tab order recorded is the page's.
- **Waits.** `waitForTimeout` pauses are fixed, so a slow machine can record a
  mid-transition frame. Prefer waiting on a condition (`locator.waitFor`). Where a
  pause is unavoidable, use at least 300 ms after a transition-bearing action and
  about 1000 ms before the first and after the last action.
- **Local HTML.** A page built with `page.setContent` has an `about:blank` origin, so
  Chromium blocks its `file://` subresources (images, scripts, CSS); use
  `page.goto('file:///abs/path.html')`.
- **Parallel.** One context per story and browser, started together with
  `await Promise.all(jobs.map(runOne))`. Never share a context between recordings.

## Storybook play functions

- Open `iframe.html?id=<story-id>&viewMode=story`. Wait for the render phase through
  `window.__STORYBOOK_ADDONS_CHANNEL__`: subscribe inside `page.evaluate` and
  resolve a promise on the render-phase event you need. Check event names against
  the installed Storybook version; they have changed across majors.
- To record a story without its play function, intercept the story's JS with
  `page.route` and strip the `play` export before it loads.
- To make a very short play function watchable, wrap `setTimeout` via
  `page.addInitScript` so zero-length waits become a stretched delay.
  `page.clock` does not work here: the waits chain inside one clock step.

## Frames from a .webm without ffmpeg

Open the file in a page, seek, screenshot the `<video>`:

```js
await page.goto('file:///abs/clip.webm');
await page.evaluate(async (t) => {
  const v = document.querySelector('video');
  v.currentTime = t;
  await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
}, 1.5);
await page.locator('video').screenshot({ path: 'frame.png' });
```

## Limits to state in any report

- Playwright's WebKit is not Safari. It does not reflect Safari's "Press Tab to
  highlight each item" setting, so tab-focus behavior may differ from real Safari.
- Headless video is silent and shows the page only, no browser chrome.

## Uploading

A `.webm` goes into a PR body or comment through the `gh-attach-image` skill
(GitHub's user-attachments endpoint). Do not commit the video.
