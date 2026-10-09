// Merge collect_timing.json and render_timing.json into timing.json, one
// level above <outputs_dir> (the eval root, e.g. with_skill/).
//
// Usage: node merge-timing.ts <outputs_dir>
//
// timing.json fields (each number|string or null when that phase is absent):
//   collect_duration_seconds, render_duration_seconds, total_duration_seconds,
//   collect_start_iso, collect_end_iso, render_start_iso, render_end_iso
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { defaultIo, isObject, type Io, type Json } from "./common.ts";

const readTiming = (path: string): Json | null => {
  if (!existsSync(path)) return null;
  const data: unknown = JSON.parse(readFileSync(path, "utf8"));
  return isObject(data) ? data : null;
};

const num = (t: Json | null, k: string): number | null => {
  const v = t?.[k];
  return typeof v === "number" ? v : null;
};
const iso = (t: Json | null, k: string): string | null => {
  const v = t?.[k];
  return typeof v === "string" ? v : null;
};

export const main = (argv: string[], io: Io = defaultIo): number => {
  const [dir, ...rest] = argv;
  if (dir === undefined || rest.length > 0) {
    io.err("Usage: merge-timing.ts <outputs_dir>\n");
    return 1;
  }
  const collect = readTiming(join(dir, "collect_timing.json"));
  const render = readTiming(join(dir, "render_timing.json"));
  if (collect === null && render === null) {
    io.err(
      `No timing files found in ${dir}. Expected collect_timing.json and/or render_timing.json.\n`,
    );
    return 1;
  }
  const c = num(collect, "duration_seconds");
  const r = num(render, "duration_seconds");
  const timing = {
    collect_duration_seconds: c,
    render_duration_seconds: r,
    total_duration_seconds: c === null && r === null ? null : (c ?? 0) + (r ?? 0),
    collect_start_iso: iso(collect, "start_iso"),
    collect_end_iso: iso(collect, "end_iso"),
    render_start_iso: iso(render, "start_iso"),
    render_end_iso: iso(render, "end_iso"),
  };
  const out = join(dirname(resolve(dir)), "timing.json");
  const text = JSON.stringify(timing, null, 2);
  writeFileSync(out, text + "\n");
  io.out(text + "\n");
  io.err(`Written to ${out}\n`);
  return 0;
};

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
