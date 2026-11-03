/**
 * The real wrapper in a real child process, with a fake `claude` on PATH, and a
 * real SIGINT sent mid-run: what `timeout --signal=INT` does at the CI deadline.
 */
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXIT_PARTIAL } from "./exit-codes.ts";
import { makePlugin } from "./test-support.ts";

// Answers --version; case c1 writes a passing result and exits; case c2 announces it is
// running, then waits for SIGINT and exits 130 the way the real CLI does; c3 must never start.
const FAKE_CLAUDE = `#!${process.execPath}
const fs = require("node:fs");
const a = process.argv.slice(2);
if (a[0] === "--version") { console.log("2.1.287 (Claude Code)"); process.exit(0); }
const name = a[a.indexOf("--case") + 1];
const dir = a[a.indexOf("--output-dir") + 1];
fs.appendFileSync(process.env.FAKE_LOG, name + "\\n");
if (name === "c2") {
  process.on("SIGINT", () => { fs.appendFileSync(process.env.FAKE_LOG, "c2 got SIGINT\\n"); process.exit(130); });
  fs.writeFileSync(process.env.FAKE_READY, "");
  setInterval(() => {}, 1000);
} else {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dir + "/aggregate-result.json", JSON.stringify({
    schemaVersion: 1, partial: false, costUsd: 0.1,
    cases: [{ name, aggregates: {}, arms: { with: [{ score: 1, error: null }], without: [] } }],
  }));
}
`;

const WRAPPER = join(import.meta.dirname, "run-evals.ts");
const scratch: string[] = [];
afterEach(() => {
  scratch.splice(0).forEach((d) => {
    rmSync(d, { recursive: true, force: true });
  });
});

const until = async (ok: () => boolean, ms: number): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe("a real SIGINT", () => {
  it("writes the partial summary, lists the unstarted case, forwards INT to claude, exits 7", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "run-evals-sigint-"));
    scratch.push(tmp);
    const bin = join(tmp, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "claude"), FAKE_CLAUDE);
    chmodSync(join(bin, "claude"), 0o755);
    const plugin = makePlugin([{ name: "c1" }, { name: "c2" }, { name: "c3" }]);
    scratch.push(plugin);
    const out = join(tmp, "out");
    const ready = join(tmp, "ready");
    const log = join(tmp, "log");

    const child = spawn(process.execPath, [WRAPPER, plugin, "--output-dir", out], {
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}`,
        FAKE_READY: ready,
        FAKE_LOG: log,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    const closed = new Promise<number | null>((resolve) => {
      child.on("close", (code) => {
        resolve(code);
      });
    });

    try {
      await until(() => existsSync(ready), 15_000);
    } catch (e) {
      child.kill("SIGKILL");
      throw new Error(`fake claude never reached c2: ${stderr}`, { cause: e });
    }
    child.kill("SIGINT");
    const code = await closed;

    expect(code, stderr).toBe(EXIT_PARTIAL);
    expect(readFileSync(log, "utf8").split("\n").filter(Boolean)).toEqual(["c1", "c2", "c2 got SIGINT"]);
    const runDir = readdirSync(out).find((d) => d.startsWith("run-"));
    const summary: unknown = JSON.parse(readFileSync(join(out, runDir ?? "", "run-evals-summary.json"), "utf8"));
    expect(summary).toMatchObject({
      exit: EXIT_PARTIAL,
      unstarted: ["c3"],
      invocations: [
        { caseName: "c1", exit: 0 },
        { caseName: "c2", exit: EXIT_PARTIAL },
      ],
    });
    expect(stderr).toContain("interrupted (SIGINT); not run: c3");
  }, 30_000);
});
