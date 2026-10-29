import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NUDGE, run } from "./incident-nudge-hook.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "cr-nudge-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const call = (input: unknown, env: Record<string, string> = {}) => {
  const out: string[] = [];
  const code = run({
    env: { TMPDIR: tmp, COLLAB_RETRO_NUDGE: "on", ...env },
    stdin: typeof input === "string" ? input : JSON.stringify(input),
    now: new Date("2026-10-27T00:00:00Z"),
    out: (t) => out.push(t),
  });
  return { code, out: out.join("") };
};
const prompt = (p: string, s = "s1") => ({ hook_event_name: "UserPromptSubmit", session_id: s, prompt: p });
const stop = (extra = {}, s = "s1") => ({ hook_event_name: "Stop", session_id: s, ...extra });
const pendingFile = (s = "s1") => join(tmp, "agent-config-collab-retro", `${s}.pending`);

describe("collab-retro incident nudge hook", () => {
  it("is off by default", () => {
    call(prompt("I told you already"), { COLLAB_RETRO_NUDGE: "" });
    expect(existsSync(pendingFile())).toBe(false);
  });

  it("logs one line for a frustration phrase, without the prompt text, and prints nothing", () => {
    const r = call(prompt("I already told you to use pnpm, secret-token-123"));
    expect(r).toEqual({ code: 0, out: "" });
    const body = readFileSync(pendingFile(), "utf8");
    expect(body).toBe("2026-10-27T00:00:00.000Z i already told you\n");
  });

  it("ignores neutral and overlong prompts", () => {
    call(prompt("please add a test"));
    call(prompt(`how many times ${"x".repeat(600)}`));
    expect(existsSync(pendingFile())).toBe(false);
  });

  it("Stop nudges at most once per session, only when a line is pending", () => {
    expect(call(stop()).out).toBe("");
    call(prompt("how many times do I have to say it"));
    expect(JSON.parse(call(stop()).out)).toEqual(NUDGE);
    expect(call(stop()).out).toBe("");
    expect(call(stop({}, "s2")).out).toBe("");
  });

  it("Stop does nothing when stop_hook_active", () => {
    call(prompt("not what I asked"));
    expect(call(stop({ stop_hook_active: true })).out).toBe("");
    expect(JSON.parse(call(stop()).out)).toEqual(NUDGE);
  });

  it("fails open on bad input", () => {
    expect(call("not json").code).toBe(0);
    expect(call({ hook_event_name: "Stop" }).out).toBe("");
  });
});

describe("entrypoint (spawned)", () => {
  const entry = join(import.meta.dirname, "incident-nudge-hook.ts");
  const hook = (input: string) =>
    spawnSync(process.execPath, [entry], {
      input,
      encoding: "utf8",
      env: { PATH: "", TMPDIR: tmp, COLLAB_RETRO_NUDGE: "on" },
    });

  it("logs a frustration phrase, then Stop nudges once", () => {
    expect(hook(JSON.stringify(prompt("how many times do I have to say it")))).toMatchObject({ status: 0, stdout: "" });
    expect(existsSync(pendingFile())).toBe(true);
    const first = hook(JSON.stringify(stop()));
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout)).toEqual(NUDGE);
    expect(hook(JSON.stringify(stop())).stdout).toBe("");
  });

  it("fails open on garbage stdin", () => {
    expect(hook("not json")).toMatchObject({ status: 0, stdout: "" });
  });
});
