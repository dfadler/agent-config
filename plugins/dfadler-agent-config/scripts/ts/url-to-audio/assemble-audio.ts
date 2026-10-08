// Assembles the final article.mp3 from the per-chunk OpenAI TTS output in
// <workdir>, once the caller's chunk loop has finished. Its own script because
// it is the one piece of the url-to-audio flow with real branching logic, and
// it had two real bugs (PR #360): ffmpeg running unconditionally on a single
// chunk, and a mid-loop failure still being concatenated into a truncated
// "complete" file.
//
// Usage: node assemble-audio.ts <workdir> <total_chunks> <failed:0|1>
//   workdir      Directory with part_0001.mp3.. and concat.txt
//                (lines: file '<path>', one per successful chunk).
//   total_chunks Number of chunks the caller's loop attempted.
//   failed       1 if any chunk failed (the loop broke early), else 0.
//
// Writes <workdir>/article.mp3 on success. Exits non-zero (writing nothing)
// if any chunk failed, or if ffmpeg is needed but missing. Standalone: node
// builtins only (a plugin installs on its own).
import { spawnSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { join } from "node:path";

const USAGE = "Usage: assemble-audio.ts <workdir> <total_chunks> <failed:0|1>\n";

/** The effects assembly needs; injected so tests stay hermetic. */
export interface Deps {
  copyFile: (from: string, to: string) => void;
  /** Runs ffmpeg with stdio inherited; `missing` means it is not installed. */
  ffmpeg: (args: string[]) => { missing: boolean; status: number };
  out: (s: string) => void;
  errOut: (s: string) => void;
}

export const realDeps: Deps = {
  copyFile: copyFileSync,
  ffmpeg: (args) => {
    const r = spawnSync("ffmpeg", args, { stdio: "inherit" });
    const code: unknown = r.error && "code" in r.error ? r.error.code : undefined;
    return { missing: code === "ENOENT", status: r.status ?? 1 };
  },
  out: (s) => process.stdout.write(s),
  errOut: (s) => process.stderr.write(s),
};

export const main = (argv: string[], deps: Deps = realDeps): number => {
  if (argv.length === 1 && (argv[0] === "-h" || argv[0] === "--help")) {
    deps.out(USAGE);
    return 0;
  }
  const [workdir, total, failed] = argv;
  if (argv.length !== 3 || workdir === undefined) {
    deps.errOut(USAGE);
    return 2;
  }
  if (!/^[0-9]+$/.test(total ?? "")) {
    deps.errOut(`assemble-audio.ts: total_chunks must be a non-negative integer, got: ${String(total)}\n`);
    return 2;
  }
  if (failed !== "0" && failed !== "1") {
    deps.errOut(`assemble-audio.ts: failed must be 0 or 1, got: ${String(failed)}\n`);
    return 2;
  }
  if (failed === "1") {
    deps.errOut("Aborting: not every chunk synthesized — refusing to ship a truncated file\n");
    return 1;
  }
  const article = join(workdir, "article.mp3");
  if (Number(total) === 1) {
    try {
      deps.copyFile(join(workdir, "part_0001.mp3"), article);
    } catch (e) {
      deps.errOut(`assemble-audio.ts: ${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
    return 0;
  }
  const r = deps.ffmpeg(["-y", "-f", "concat", "-safe", "0", "-i", join(workdir, "concat.txt"), "-c", "copy", article]);
  if (r.missing) {
    deps.errOut("ffmpeg not found and there is more than one chunk — stopping rather than shipping only the first chunk's audio\n");
    return 1;
  }
  return r.status;
};

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
