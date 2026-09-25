---
name: capture
description: >
  Generic primitive for capturing a screenshot (image) or short walkthrough
  (video) of a URL, on either Playwright (primary) or system Chrome via CDP
  (config-driven fallback). Use whenever something needs a page rendered to a
  file on disk — not just previewed in an in-app browser tool. Engine,
  browser, viewport, output type, and output directory are all config-driven
  (see Config resolution below), not hardcoded per call.
license: MIT
metadata:
  version: "0.1.0"
---

# Screen capture

A generic page-capture primitive: given a URL, produce an image or video file
on disk. Two engines are supported; which one runs is config, not a per-call
choice you make in prose.

This is the *mechanics* skill for producing the file. It has no opinion on
what the caller does with it afterwards (attach to a PR, embed in a doc,
etc.) — for the PR/issue-attachment workflow specifically (before/after
tables, GitHub upload, responsive/Lighthouse passes), see
`pr-visual-capture:pr-visual-capture`, which this skill's Chrome+CDP path is
adapted from.

## Config resolution

Resolve each setting in this order — first source that defines the key wins,
otherwise fall through to the next:

1. **`second-brain:config`** (vault-global config, from the sibling
   `second-brain` plugin) — read via that skill under a `screen-capture.*`
   namespace. **This dependency may not be installed yet** (it ships from a
   separate epic issue); if the skill isn't available, skip straight to step 2
   rather than failing.
2. **`.claude/settings.json`** in the current project, under a `screenCapture`
   object.
3. **`SCREEN_CAPTURE_*` environment variables.**
4. **Built-in default**, listed below.

| Setting | `second-brain:config` key | `settings.json` key | env var | default |
|---|---|---|---|---|
| engine | `screen-capture.engine` | `screenCapture.engine` | `SCREEN_CAPTURE_ENGINE` | `playwright` |
| browser | `screen-capture.browser` | `screenCapture.browser` | `SCREEN_CAPTURE_BROWSER` | `chromium` |
| viewport | `screen-capture.viewport` | `screenCapture.viewport` | `SCREEN_CAPTURE_VIEWPORT` | `1280x900` |
| output_type | `screen-capture.output_type` | `screenCapture.outputType` | `SCREEN_CAPTURE_OUTPUT_TYPE` | `image` |
| output_dir | `screen-capture.output_dir` | `screenCapture.outputDir` | `SCREEN_CAPTURE_OUTPUT_DIR` | this session's scratchpad directory |

`engine` is the only key that changes which section below you follow;
`viewport` is `WIDTHxHEIGHT` (CSS pixels); `output_type` is `image` or
`video`.

## Engine: Playwright (default)

Check for an already-installed Playwright before reaching for `npx` —
`node_modules/.bin/playwright` or `playwright`/`@playwright/test` in the
current project's `package.json` means the project already owns the
dependency and version; use that binary instead of pulling a possibly
different version via `npx`. Otherwise `npx --yes playwright ...` runs it
one-off with no project install needed. Either way, Chromium's own browser
binary is a one-time install if missing:

```bash
npx --yes playwright install chromium
```

### `output_type: image`

The CLI covers a plain screenshot, including a client-rendered SPA — unlike
raw headless Chrome's `--screenshot` flag (see the CDP path below), Playwright
waits for the `load` event and JS execution by default:

```bash
width="${viewport%x*}"; height="${viewport#*x}"
npx --yes playwright screenshot \
  --browser="$browser" \
  --viewport-size="${width},${height}" \
  --full-page \
  "$url" "$output_dir/capture.png"
```

If the page needs more readiness than `load` (a specific selector, a fetch
that resolves after paint), don't reach for a fixed sleep — drop to the short
Node script below and poll before calling `page.screenshot()`.

### `output_type: video`

The CLI has no video mode; use a short Node script — Playwright records video
per browser *context*, and the file is only finalized once that context
closes:

```js
const { chromium, firefox, webkit } = require('playwright');
const engines = { chromium, firefox, webkit };

(async () => {
  const [, , browserName, width, height, url, outputDir] = process.argv;
  const browser = await engines[browserName].launch();
  const context = await browser.newContext({
    viewport: { width: Number(width), height: Number(height) },
    recordVideo: { dir: outputDir, size: { width: Number(width), height: Number(height) } },
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });
  // Add any interaction/wait steps here (page.click, page.waitForSelector, …)
  // before closing — the recording covers everything up to context.close().
  await context.close(); // finalizes the video file; the path is only known now
  const video = await page.video().path();
  console.log(video);
  await browser.close();
})();
```

Run it with `node script.js "$browser" "$width" "$height" "$url" "$output_dir"`
and move/rename the printed path to your expected output filename — Playwright
names the file with an internal UUID, not something you choose up front.

## Engine: Chrome + CDP (fallback)

Use this engine when `engine` resolves to `chrome-cdp` — e.g. a machine
without Playwright's browser binaries available, or a project that already
standardizes on system Chrome. Mechanics below are adapted from
`pr-visual-capture:pr-visual-capture`; see that skill for the full detail this
condenses (auth-gated routes, cropping, Lighthouse/responsive passes).

**macOS-only paths below** (`/Applications/Google Chrome.app/...`); on Linux
substitute `google-chrome`/`chromium`.

### `output_type: image`, server-rendered page

A page that paints on the initial HTML works with a plain headless
screenshot:

```bash
width="${viewport%x*}"; height="${viewport#*x}"
rm -f "$output_dir/capture.png"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu \
  --window-size="$width,$height" --force-device-scale-factor=2 \
  --screenshot="$output_dir/capture.png" \
  "$url" &
chrome_pid=$!
for _ in $(seq 1 100); do
  [ -s "$output_dir/capture.png" ] && break
  kill -0 "$chrome_pid" 2>/dev/null || { echo "chrome exited before writing a screenshot" >&2; exit 1; }
  sleep 0.2
done
[ -s "$output_dir/capture.png" ] || { echo "timed out waiting for the screenshot" >&2; exit 1; }
kill -9 "$chrome_pid" 2>/dev/null
```

`--window-size` is the CSS viewport; with `--force-device-scale-factor=2` the
output image is `2W×2H`. If `--headless=new` hangs on the installed Chrome,
fall back to `--headless=old`.

### `output_type: image`, client-rendered page (SPA)

Plain `--screenshot` fires before a client-rendered page's JS paints anything,
producing a blank image — drive Chrome over CDP instead (Node's built-in
`WebSocket` speaks CDP directly, no extra dependency):

1. Launch with an ephemeral debug port:
   ```bash
   profile_dir=$(mktemp -d)
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --headless=new --disable-gpu --user-data-dir="$profile_dir" \
     --remote-debugging-port=0 &
   chrome_pid=$!
   ```
2. Poll (bounded, checking the process is still alive) for
   `$profile_dir/DevToolsActivePort`, then read the port from its first line.
3. `Target.createTarget` a new tab, `Target.attachToTarget` with
   `{flatten: true}` to get a `sessionId` — every following command must carry
   it.
4. `Page.enable`, then register a `Page.loadEventFired` listener *before*
   navigating.
5. `Emulation.setDeviceMetricsOverride` with the resolved viewport —
   **required**; CDP-created tabs ignore `--window-size`.
6. `Page.navigate` to `$url`, wait for `Page.loadEventFired`, then poll via
   `Runtime.evaluate` for a concrete readiness signal (a selector, a value) —
   `document.readyState === 'complete'` is a floor, not a guarantee. Stop and
   report if the poll times out; don't capture a still-loading page.
7. `Page.captureScreenshot`, then look at the result before trusting it.
8. **Teardown, unconditionally, including on a failure path:**
   `kill "$chrome_pid"; rm -rf "$profile_dir"`.

Full CDP envelope details, auth-gated-route handling, and the
`--remote-allow-origins` fallback are in `pr-visual-capture:pr-visual-capture`
— reuse that recipe rather than re-deriving it.

### `output_type: video` (either Chrome path)

Chrome/CDP has no built-in video capture, so build the video from stills:
capture one PNG per step with the recipe above (numbered
`frame-001.png`, `frame-002.png`, …), then stitch with `ffmpeg`.

Generate the concat-demuxer input list (each still held for `frame_seconds`):

```bash
frame_seconds=1
python3 - "$output_dir" "$frame_seconds" > "$output_dir/frames.txt" <<'PY'
import glob, os, sys

frames_dir, duration = sys.argv[1], sys.argv[2]
files = sorted(glob.glob(os.path.join(frames_dir, "frame-*.png")))
if not files:
    sys.exit(f"no frame-*.png files found in {frames_dir}")

def esc(path):
    return "'" + path.replace("'", "'\\''") + "'"

for f in files:
    print(f"file {esc(f)}")
    print(f"duration {duration}")
# The concat demuxer ignores the last entry's duration, so repeat the final
# file line once more with nothing after it.
print(f"file {esc(files[-1])}")
PY
```

```bash
ffmpeg -f concat -safe 0 -i "$output_dir/frames.txt" -vf "fps=30,format=yuv420p" \
  -c:v h264_videotoolbox -b:v 5M "$output_dir/capture.mp4"
```

On macOS, use `h264_videotoolbox` if the system `ffmpeg` build has no
`libx264` support for `-preset`; on Linux, `-c:v libx264` is the normal
choice.

## Output

Write to `output_dir` (default: this session's scratchpad directory) as
`capture.png` or `capture.mp4` unless the caller names a specific filename.
Confirm the file is non-empty before reporting success — an interrupted
capture can leave a zero-byte or partial file.
