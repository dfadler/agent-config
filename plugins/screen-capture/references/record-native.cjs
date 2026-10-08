// Template: record headless keyboard-interaction video with Playwright.
// Usage: copy, edit CONFIG, then `node record-native.cjs`.
const { chromium, webkit } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG = {
  baseUrl: 'http://localhost:6006',
  stories: ['example-button--primary'], // story ids
  routePattern: (id) => `/iframe.html?id=${id}&viewMode=story`,
  playFunctionPattern: /./, // stretch only zero-length timers whose callback source matches this
  openButtonName: 'Open', // accessible name of the button that opens the dialog; null to skip
  dialogSelector: '[role="dialog"]', // null to skip
  tabPresses: 6,
  browsers: { chromium, webkit },
  outputDir: './recordings',
  waitMs: 250, // stretched zero-length setTimeout waits
};

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

async function record(browserName, engine, storyId) {
  const dir = path.join(CONFIG.outputDir, `${storyId}-${browserName}`);
  fs.mkdirSync(dir, { recursive: true });
  const browser = await engine.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    recordVideo: { dir, size: { width: 1024, height: 768 } },
    // Required: headless Chromium reports HeadlessChrome, which UA-sniffing libraries mishandle.
    ...(browserName === 'chromium' ? { userAgent: CHROME_UA } : {}),
  });
  const page = await ctx.newPage();
  await page.addInitScript(
    ({ waitMs, source }) => {
      const orig = window.setTimeout;
      const re = new RegExp(source);
      window.setTimeout = (fn, ms, ...args) =>
        orig(fn, (ms === 0 || ms === undefined) && re.test(String(fn)) ? waitMs : ms, ...args);
    },
    { waitMs: CONFIG.waitMs, source: CONFIG.playFunctionPattern.source },
  );
  await page.goto(CONFIG.baseUrl + CONFIG.routePattern(storyId), { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  if (CONFIG.openButtonName) {
    await page.getByRole('button', { name: CONFIG.openButtonName }).click();
    if (CONFIG.dialogSelector) {
      await page.locator(CONFIG.dialogSelector).first().click(); // focus into the dialog before Tab
    }
  }
  for (let i = 0; i < CONFIG.tabPresses; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(CONFIG.waitMs * 2);
  }
  const video = page.video();
  await ctx.close(); // must precede saveAs: the file is finalized on close
  const out = path.join(CONFIG.outputDir, `${storyId}-${browserName}.webm`);
  await video.saveAs(out);
  await browser.close();
  return out;
}

// Check a recording without ffmpeg: seek in headless Chromium and screenshot.
async function extractFrame(webmPath, seconds, pngPath) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(webmPath)); // not setContent: file:// is blocked there
  await page.evaluate(
    (t) =>
      new Promise((resolve) => {
        const v = document.querySelector('video') ?? document.body.appendChild(document.createElement('video'));
        v.addEventListener('seeked', resolve, { once: true });
        v.currentTime = t;
      }),
    seconds,
  );
  await page.screenshot({ path: pngPath });
  await browser.close();
}

module.exports = { extractFrame };

if (require.main === module) {
  Promise.all(
    CONFIG.stories.flatMap((id) =>
      Object.entries(CONFIG.browsers).map(([name, engine]) => record(name, engine, id)),
    ),
  ).then((files) => files.forEach((f) => console.log(f)));
}
