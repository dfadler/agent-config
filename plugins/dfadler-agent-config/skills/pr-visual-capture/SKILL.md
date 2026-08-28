---
name: pr-visual-capture
description: >
  How to actually produce screenshot (PNG) and walkthrough video (MP4) files
  for a PR/issue's visual-verification requirement, when an in-app/embedded
  browser tool can verify a render but can't write the result to disk. Covers
  driving headless system Chrome for a server-rendered page, driving it via
  CDP for a client-rendered SPA (the plain `--screenshot` flag fires before
  React/Vue/etc. paint), and stitching captured stills into an MP4 with
  ffmpeg. Use whenever a PR/issue needs a screenshot or video file attached
  and the available browser tooling can only preview, not export.
license: MIT
metadata:
  version: "1.0.0"
---

# PR/issue visual capture

This is the *mechanics* skill for producing a screenshot or video file to
attach to a PR/issue body — not the policy of *when* one is required (that
lives in your project's own CLAUDE.md; see the "Visual verification on
PRs/issues that change rendered output" convention in this repo's global
CLAUDE.md for one example policy).

## Why not an in-app/embedded browser tool

A computer-use-style or embedded browser tool (e.g. `mcp__*Browser__computer`
`screenshot`) renders faithfully and is the right tool for *verifying* a
change interactively — but it typically returns image data inline only,
with no file written to disk. Attaching to a PR/issue (via a GitHub
attachment upload, e.g. the `dfadler-agent-config:gh-attach-image` skill) needs a real file path.
Drive the system Chrome binary headlessly instead.

**macOS only below** — the Chrome binary path and video encoder are
Mac-specific. On a non-macOS session (e.g. a cloud/Linux session),
substitute `google-chrome`/`chromium` for the binary and `libx264` for the
video encoder in the Video section.

## Screenshot: server-rendered pages

A page that paints on the initial HTML (no client-side data fetch before
first paint) works with a plain headless screenshot:

```bash
rm -f /path/to/out.png   # Chrome only creates this at capture time, so a leftover
                          # file from an earlier run would satisfy the poll below on
                          # iteration 1 and ship a stale screenshot instead of failing
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu \
  --window-size=1280,900 --force-device-scale-factor=2 \
  --screenshot=/path/to/out.png \
  "<your dev server URL>/some/page" &
chrome_pid=$!
for _ in $(seq 1 100); do
  [ -s /path/to/out.png ] && break
  kill -0 "$chrome_pid" 2>/dev/null || { echo "chrome exited before writing a screenshot" >&2; exit 1; }
  sleep 0.2
done
[ -s /path/to/out.png ] || { echo "timed out waiting for the screenshot" >&2; exit 1; }
kill -9 "$chrome_pid" 2>/dev/null   # the process lingers even after the file is written —
                                     # kill only the PID we launched, never a broad `pkill -f`
                                     # pattern if you may have other headless Chrome
                                     # instances (e.g. other worktree/session captures) in flight
```

- `--window-size=W,H` is the **CSS viewport**; with `--force-device-scale-factor=2`
  the output image is `2W×2H`. Desktop = `1280,900`; true mobile = `390,844`.
- Try `--headless=new` first, as in the recipe above — it's Chrome's
  supported direction (the changelog says legacy headless is being removed
  in favor of the standalone `chrome-headless-shell` binary) and reliably
  writes the file and exits zero (process lingers — kill it after, as
  above). `--headless=new` has hung on some Chrome versions in the past —
  if it hangs on the Chrome actually installed, fall back to
  `--headless=old`; empirically (Chrome 151, byte-identical output on the
  same fixture) `=old` still works fine and has not been removed, so it
  remains a safe fallback rather than something you should expect to fail.
  Verify against the installed Chrome rather than assuming either claim.
  If neither works, install `chrome-headless-shell` via
  `npx @puppeteer/browsers install chrome-headless-shell@stable`.
- Narrow (~390px) headless captures don't emulate a real mobile viewport and
  can show phantom overflow — verify actual responsiveness with an in-app
  browser tool's mobile preset instead (`document.scrollWidth === innerWidth`),
  and treat the headless narrow shot as illustrative only.
- Media served from a remote host (CDN, object storage) may not have loaded
  by the time the headless screenshot fires, showing as a broken-image
  glyph — crop it out top-anchored with Pillow (`sips -c` crops centered,
  which doesn't help here). The crop box is in **image** pixels, not the CSS
  pixels `--window-size` and any on-page measurement (e.g.
  `getBoundingClientRect().top`) use — at `--force-device-scale-factor=2` a
  CSS-pixel offset must be doubled, so scale by the ratio rather than
  pasting a raw CSS value into the box:
  ```python
  from PIL import Image
  DSF = 2  # must match --force-device-scale-factor
  img = Image.open(path_in)
  img.crop((0, 0, img.width, css_height_above_content * DSF)).save(path_out)
  ```
- **If a lightweight rasterizer (`sharp`/librsvg) renders an SVG wrong** (e.g.
  solid black, missing content) rather than actually reproducing what a
  browser shows, capture it through the real browser above instead of
  `sharp().png()` — but check first whether your project's own SVG rendering
  actually uses CSS custom properties/`color-mix()`; a renderer that uses
  static colors with no CSS variables won't hit this at all.

## Screenshot: a client-rendered SPA (via CDP)

A client-rendered view (React/Vue/etc. that fetches and paints after page
load) makes plain `--screenshot`/`--virtual-time-budget` fire too early,
producing a blank page. Drive Chrome via CDP instead (Node 22's built-in
`WebSocket` talks CDP directly — no puppeteer/playwright needed for a
one-off capture).

**This browser may hold an authenticated session** if the target route is
login-gated. The CDP debug port has no auth of its own, so treat
launch/teardown as load-bearing, not incidental — especially if more than
one agent session could be running on this machine at once:

1. **Launch.** Pick the profile based on your auth path (see below) *before*
   this step — an autonomous/scripted login uses a fresh temp profile, a
   human-assisted login reuses a persistent one, and they are not
   interchangeable (the persistent profile's whole point is the login
   cookie already in it):
   ```bash
   # scripted login: profile_dir=$(mktemp -d); owns_profile=1
   # human-assisted: profile_dir=/path/to/your/dedicated-profile; owns_profile=0
   rm -f "$profile_dir/DevToolsActivePort"   # a reused profile (the human-assisted path)
                                              # can carry a stale port from a run whose
                                              # teardown got skipped — step 2's poll would
                                              # otherwise read that dead port instead of
                                              # this launch's real one
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --headless=new --disable-gpu --user-data-dir="$profile_dir" \
     --remote-debugging-port=0 &
   chrome_pid=$!
   ```
   `--remote-debugging-port=0` asks Chrome to pick an ephemeral port rather
   than a fixed one another session could collide with.
2. **Wait for the debug port, bounded.** Chrome writes the chosen port to
   `DevToolsActivePort` (first line) inside the profile dir once it's ready —
   but an unbounded wait hangs forever if Chrome never gets that far (missing
   binary, a rejected flag, a stale singleton lock), so check the child is
   still alive and give up loudly instead:
   ```bash
   for _ in $(seq 1 100); do
     [ -s "$profile_dir/DevToolsActivePort" ] && break
     kill -0 "$chrome_pid" 2>/dev/null || { echo "chrome exited before opening a debug port" >&2; exit 1; }
     sleep 0.1
   done
   [ -s "$profile_dir/DevToolsActivePort" ] || { echo "timed out waiting for DevToolsActivePort" >&2; exit 1; }
   port=$(head -1 "$profile_dir/DevToolsActivePort")
   ```
   Try connecting with **no** `--remote-allow-origins` flag first — Node's
   `WebSocket` client typically sends no `Origin` header, so Chrome's origin
   check has nothing to reject. Only add the flag if the handshake is
   actually refused, and then pin it to the exact origin in use
   (`--remote-allow-origins=http://127.0.0.1:$port`) — never `*`, which
   accepts a handshake from any web origin against a browser that (per the
   **Auth** note below) may be holding an authenticated session.
3. `Target.createTarget` a new tab — this returns a target ID, not an
   attached session.
4. `Target.attachToTarget` with `{flatten: true}` to get a `sessionId`; every
   command below must carry that `sessionId` in its CDP envelope so it's
   routed to this target, not sent target-less.
5. `Page.enable` (via the session), **then** register your
   `Page.loadEventFired` listener — before triggering navigation, so the
   event can't fire before anything is listening for it.
6. `Emulation.setDeviceMetricsOverride` (via the session) — **required**;
   CDP-created tabs ignore `--window-size`, so the screenshot is empty
   without this.
7. `Page.navigate` (via the session) to the target route.
8. Wait for `Page.loadEventFired`, then poll (via `Runtime.evaluate`, bounded
   — e.g. 20 attempts × 250ms) for a concrete readiness signal instead of
   only a fixed sleep: `document.readyState === 'complete'` is a floor, not a
   guarantee the content itself has loaded, so where you know a specific
   selector for the content you're capturing (a field value, a heading text),
   poll for that instead. **If the poll times out, stop — don't proceed to
   step 9 anyway.** Report the timeout and run teardown (step 10); a fixed
   delay or an exhausted poll both risk capturing a still-loading page on a
   slow API response, with no error to signal it unless you treat the
   timeout itself as the error.
9. `Page.captureScreenshot` (via the session), only once step 8's readiness
   check actually succeeded. **Look at the result before using it** — a
   still-loading or errored page produces a plausible-looking PNG that
   silently misrepresents the change under review.
10. **Teardown — the sole cleanup, run explicitly.** Steps 3–9 are a separate
    Node/CDP client process, so an `EXIT` trap on step 1's shell would fire —
    and kill the browser — the moment that shell finishes, before the CDP
    client ever connects. There is no automatic teardown; run this yourself
    once the screenshot is in hand — **and on a failure path too, not only on
    success:** if the CDP client, login, navigation, or capture fails partway
    through, you're still holding a `$chrome_pid`/`$profile_dir` from step 1.
    Run this step regardless of where things went wrong before giving up,
    rather than abandoning a running browser (and, on a scripted-login path,
    an authenticated session inside it):
    ```bash
    kill "$chrome_pid" 2>/dev/null
    [ "$owns_profile" = 1 ] && rm -rf "$profile_dir"   # never remove a caller-owned persistent profile
    ```
    This recipe is a sequence of discrete steps for an agent to run, not a
    single script with a `finally` block — if this capture becomes something
    you reach for often enough that manual failure-path cleanup gets missed
    in practice, that's a sign it belongs as an actual script instead of a doc.

**Auth**, if the target route is login-gated:

- *With a human available:* have them log into a dedicated, **persistent**
  `--user-data-dir` in a headed window once. Scope that path uniquely to the
  calling context — e.g. fold a worktree path/slug or another session-specific
  identifier into the directory name — rather than a single shared fixed path.
  Cookies aren't port-scoped (a cookie set for one `localhost:<port>` origin is
  also sent to another `localhost:<port>` origin), so if more than one
  concurrent context (parallel worktree sessions, each with its own dev-server
  port and backing data) reuses one profile directory, an admin/login session
  cookie captured in one context can get replayed against a different
  context's server. Use that same path as `profile_dir` in step 1 with
  `owns_profile=0`, so step 10 never deletes the directory — but step 10's
  `kill "$chrome_pid"` still applies here too, unconditionally: stop the
  Chrome process after the capture (success or failure) so a stale run isn't
  left holding a live authenticated session. Only the profile *directory*
  is meant to persist between runs, not the running process.
  A session cookie may be short-lived — capture promptly after login.
- *Fully autonomous:* how you obtain a session (creating a throwaway
  account, a service-account token, a prod-safety guard) is specific to your
  app's auth stack — that part belongs in your own project's skill/doc, not
  here. Once you have a way in, driving a login form via CDP generally needs
  the **native setter**, not a bare assignment, because most modern frameworks'
  controlled inputs ignore `el.value = v`:
  ```js
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  proto.set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  ```
  Set each field this way via `Runtime.evaluate`, click the submit button,
  sleep briefly for the redirect, then navigate to the real target route and
  capture per steps 3–9 above (steps 3–6 set up the session and get you to
  the login route in the first place; steps 7–9 run again afterward, against
  the real target route, once you're authenticated).

## Video

Stitch captured stills into a walkthrough. First capture each frame as its
own PNG — reuse the screenshot recipe above once per step, writing to a
numbered path (`"$frames_dir/frame-001.png"`, `"$frames_dir/frame-002.png"`,
…) so a plain sort orders them correctly.

Then generate `frames.txt`, the concat-demuxer input list the `ffmpeg`
command below reads. Each `file` line must follow the demuxer's own quoting
rules (https://ffmpeg.org/ffmpeg-formats.html#concat) — wrap the path in
single quotes and escape any embedded single quote as `'\''`
(close-quote, escaped-quote, reopen-quote) — splicing a raw filename in
unescaped breaks on any path containing a quote:

```bash
frame_seconds=1   # how long each still holds before the next one
python3 - "$frames_dir" "$frame_seconds" > frames.txt <<'PY'
import glob, os, sys

frames_dir, duration = sys.argv[1], sys.argv[2]
files = sorted(glob.glob(os.path.join(frames_dir, "frame-*.png")))
if not files:
    sys.exit(f"no frame-*.png files found in {frames_dir}")

def esc(path):
    # ffmpeg concat-demuxer quoting: wrap in single quotes, escape an
    # embedded single quote as '\'' (close quote, escaped quote, reopen
    # quote) -- https://ffmpeg.org/ffmpeg-formats.html#concat
    return "'" + path.replace("'", "'\\''") + "'"

for f in files:
    print(f"file {esc(f)}")
    print(f"duration {duration}")
# The concat demuxer ignores the last entry's `duration` line, so the final
# `file` line must be repeated once more with nothing after it -- a
# documented quirk of the format, not a bug here.
print(f"file {esc(files[-1])}")
PY
```

```bash
ffmpeg -f concat -safe 0 -i frames.txt -vf "fps=30,format=yuv420p" \
  -c:v h264_videotoolbox -b:v 5M out.mp4
```

On macOS, `-c:v libx264` may error on `-preset` if the system ffmpeg build
has no libx264 — use `h264_videotoolbox` instead in that case. On Linux,
`-c:v libx264` is the normal choice.

## Attaching to the PR/issue

**Images and video:** use your repo's GitHub-attachment upload script/skill
(e.g. the `dfadler-agent-config:gh-attach-image` skill) — don't re-derive
the upload endpoint by hand. `gh-attach-image`'s `upload.sh` recognizes
`.mp4`/`.mov`/`.webm` alongside the image extensions and already prints a
bare URL (not `![alt](url)`) for video, which is what GitHub needs to
render an inline `<video>` player. Never commit screenshots or recordings
to the repo, never use a Gist.

**Verify before considering it done either way:** `curl -sI -L <url>` should
return `200`, not `404` — a freshly uploaded attachment 404s until the
PR/issue body that references it is saved (GitHub "claims" the asset on
save; see `dfadler-agent-config:gh-attach-image`'s SKILL.md for the full explanation of this
behavior).

## Cropping to content (diagrams/SVGs specifically)

For a rendered diagram/SVG (not a full-page screenshot), auto-crop to the
non-background bounding box rather than guessing coordinates — see the
global CLAUDE.md "Visual verification on PRs/issues that change rendered
output" section for the Pillow bounding-box snippet. Look at the actual
cropped result before uploading; don't assume it worked.
