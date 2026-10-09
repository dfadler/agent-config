// Shared wall-clock timing helpers for gha-ci-audit's collect and render
// phases (TypeScript port of timing.py).
//
// `start()`/`end()` are pure; the CLI persists the render-phase marker
// between two agent turns (Step 0 and the final step of a long render).
//
// Usage:
//   node timing.ts --start <outputs_dir>   writes <outputs_dir>/.render_start
//   node timing.ts --end   <outputs_dir>   writes <outputs_dir>/render_timing.json
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultIo, isObject, type Io } from "./common.ts";

export const MARKER_NAME = ".render_start";

export interface Marker {
  readonly epoch: number;
  readonly iso: string;
}

export interface TimingResult {
  readonly duration_seconds: number;
  readonly start_iso: string;
  readonly end_iso: string;
}

/** Capture an instant as a `Marker` (whole seconds, UTC). */
export const start = (now: Date = new Date()): Marker => {
  const epoch = Math.floor(now.getTime() / 1000);
  return { epoch, iso: new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, "Z") };
};

/** Duration from a previously captured `Marker` to `now`. */
export const end = (marker: Marker, now: Date = new Date()): TimingResult => {
  const n = start(now);
  return { duration_seconds: n.epoch - marker.epoch, start_iso: marker.iso, end_iso: n.iso };
};

const USAGE = "Usage: timing.ts --start|--end <outputs_dir>\n";

export const main = (argv: string[], io: Io = defaultIo, now: Date = new Date()): number => {
  const [mode, dir, ...rest] = argv;
  if (dir === undefined || rest.length > 0 || (mode !== "--start" && mode !== "--end")) {
    io.err(USAGE);
    return 1;
  }
  const markerPath = join(dir, MARKER_NAME);
  if (mode === "--start") {
    mkdirSync(dir, { recursive: true });
    const marker = start(now);
    writeFileSync(markerPath, JSON.stringify(marker));
    io.out(`Render timing started at ${marker.iso}\n`);
    return 0;
  }
  if (!existsSync(markerPath)) {
    io.err(`Warning: ${MARKER_NAME} not found in ${dir}; skipping timing write.\n`);
    return 0;
  }
  const data: unknown = JSON.parse(readFileSync(markerPath, "utf8"));
  if (!isObject(data) || typeof data["epoch"] !== "number" || typeof data["iso"] !== "string") {
    io.err(`error: malformed ${MARKER_NAME} in ${dir}\n`);
    return 1;
  }
  const result = end({ epoch: data["epoch"], iso: data["iso"] }, now);
  const text = JSON.stringify(result, null, 2);
  writeFileSync(join(dir, "render_timing.json"), text + "\n");
  unlinkSync(markerPath);
  io.out(text + "\n");
  return 0;
};

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
