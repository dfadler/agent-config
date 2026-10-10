import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REMINDER, run, type Deps } from "./memory-hygiene-stop-hook.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mh-hook-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

interface Opts {
  input?: unknown;
  stdin?: string;
  env?: Record<string, string>;
  dirty?: boolean;
  repo?: boolean;
}

const call = (o: Opts = {}) => {
  const out: string[] = [];
  const deps: Deps = {
    env: { TMPDIR: tmp, MEMORY_HYGIENE_REMINDER: "on", ...o.env },
    stdin:
      o.stdin ??
      JSON.stringify(o.input ?? { cwd: "/repo", session_id: "s1" }),
    git: (_cwd, args) => {
      if (args[0] === "rev-parse")
        return { status: o.repo === false ? 128 : 0, stdout: "true\n" };
      return { status: 0, stdout: o.dirty === false ? "" : " M a.txt\n" };
    },
    out: (t) => out.push(t),
  };
  return { code: run(deps), out: out.join("") };
};

const marker = (s = "s1"): string =>
  join(tmp, "agent-config-memory-hygiene", s);

describe("memory-hygiene stop hook", () => {
  it("off by default and when explicitly off", () => {
    expect(call({ env: { MEMORY_HYGIENE_REMINDER: "" } }).out).toBe("");
    expect(call({ env: { MEMORY_HYGIENE_REMINDER: "false" } }).out).toBe("");
    expect(existsSync(marker())).toBe(false);
  });

  it.each(["on", "1", "true", "yes"])("opted in with %s: reminds once and writes a marker", (v) => {
    const r = call({ env: { MEMORY_HYGIENE_REMINDER: v } });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual(REMINDER);
    expect(existsSync(marker())).toBe(true);
  });

  it("throttles the second call in the same session; other sessions fire independently", () => {
    expect(call().out).not.toBe("");
    expect(call().out).toBe("");
    expect(call({ input: { cwd: "/repo", session_id: "s2" } }).out).not.toBe("");
  });

  it("clean repo: silent, no marker", () => {
    expect(call({ dirty: false }).out).toBe("");
    expect(existsSync(marker())).toBe(false);
  });

  it("not a git repo: silent", () => {
    expect(call({ repo: false }).out).toBe("");
  });

  it("stop_hook_active=true short-circuits", () => {
    expect(call({ input: { cwd: "/repo", session_id: "s1", stop_hook_active: true } }).out).toBe("");
  });

  it("missing session_id or cwd: silent", () => {
    expect(call({ input: { cwd: "/repo" } }).out).toBe("");
    expect(call({ input: { session_id: "s1" } }).out).toBe("");
    expect(call({ input: { cwd: "/repo", session_id: "!!!" } }).out).toBe("");
  });

  it("session_id is sanitized so it cannot escape the marker dir", () => {
    call({ input: { cwd: "/repo", session_id: "../../evil" } });
    expect(existsSync(join(tmp, "agent-config-memory-hygiene", "evil"))).toBe(true);
    expect(existsSync(join(tmp, "evil"))).toBe(false);
  });

  it("malformed or non-object stdin fails open", () => {
    expect(call({ stdin: "not json" })).toEqual({ code: 0, out: "" });
    expect(call({ stdin: "[]" })).toEqual({ code: 0, out: "" });
  });

  it("an unwritable marker dir is silent (exit 0)", () => {
    // TMPDIR pointing at a file makes mkdir fail.
    const f = join(tmp, "file");
    writeFileSync(f, "x");
    expect(call({ env: { TMPDIR: f } })).toEqual({ code: 0, out: "" });
  });
});

describe("entrypoint (spawned)", () => {
  const script = join(import.meta.dirname, "memory-hygiene-stop-hook.ts");

  it("reminds in a real dirty repo, once", () => {
    const repo = join(tmp, "repo");
    spawnSync("git", ["init", "-q", repo]);
    writeFileSync(join(repo, "a.txt"), "x");
    const env = { PATH: process.env["PATH"] ?? "", TMPDIR: tmp, MEMORY_HYGIENE_REMINDER: "on" };
    const input = JSON.stringify({ cwd: repo, session_id: "e2e" });
    const first = spawnSync(process.execPath, [script], { input, env, encoding: "utf8" });
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout)).toEqual(REMINDER);
    const second = spawnSync(process.execPath, [script], { input, env, encoding: "utf8" });
    expect(second.stdout).toBe("");
  });

  it("exits 0 on empty stdin", () => {
    const r = spawnSync(process.execPath, [script], { input: "", encoding: "utf8", env: { PATH: "" } });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});
