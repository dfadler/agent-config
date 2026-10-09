// Minimal recording loop. Placeholders are the constants below.
// Run: node record.mjs   (needs `npm i playwright` and installed browsers)
import { chromium, webkit } from "playwright";
import { mkdirSync } from "node:fs";

const URL = "http://localhost:6006/iframe.html?id=<STORY_ID>&viewMode=story"; // page to record
const OUT_DIR = "./recordings"; // where .webm files land
const BROWSERS = { chromium, webkit };
const VIEWPORT = { width: 1280, height: 720 };
// Chromium headless reports HeadlessChrome; set only if the app sniffs the UA.
const CHROMIUM_UA = undefined;

mkdirSync(OUT_DIR, { recursive: true });

async function record(name, launcher) {
  const browser = await launcher.launch();
  try {
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      recordVideo: { dir: OUT_DIR, size: VIEWPORT },
      ...(name === "chromium" && CHROMIUM_UA ? { userAgent: CHROMIUM_UA } : {}),
    });
    const page = await ctx.newPage();
    const video = page.video();
    await page.goto(URL);
    await page.waitForTimeout(1000); // lead-in
    await page.keyboard.press("Tab"); // real key event, not synthetic
    await page.waitForTimeout(500);
    await ctx.close(); // must precede saveAs: finalizes the file
    const path = `${OUT_DIR}/${name}.webm`;
    await video.saveAs(path);
    return path;
  } finally {
    await browser.close(); // also on failure, so no browser process is left running
  }
}

// One context per browser, in parallel.
const paths = await Promise.all(Object.entries(BROWSERS).map(([n, l]) => record(n, l)));
console.log(paths.join("\n"));
