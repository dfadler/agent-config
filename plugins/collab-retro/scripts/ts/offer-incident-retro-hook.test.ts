import { describe, expect, it } from "vitest";
import { run, type Deps, type Run } from "./offer-incident-retro-hook.ts";

const PRS = JSON.stringify([
  { number: 7, title: "Bad idea", url: "https://x/pull/7", mergedAt: null },
  { number: 8, title: "Shipped", url: "https://x/pull/8", mergedAt: "2026-10-22T00:00:00Z" },
]);

const call = (runFn: Run, stdin = JSON.stringify({ cwd: "/r" }), env = {}) => {
  const out: string[] = [];
  const err: string[] = [];
  const deps: Deps = {
    env,
    stdin,
    run: runFn,
    now: new Date("2026-10-23T00:00:00Z"),
    out: (t) => out.push(t),
    err: (t) => err.push(t),
  };
  return { code: run(deps), out: out.join(""), err: err.join("") };
};

const fake =
  (o: { gh?: { status: number; stdout: string }; log?: string }): Run =>
  (cmd, args) => {
    if (cmd === "gh") return o.gh ?? { status: 0, stdout: "[]" };
    if (args[0] === "config") return { status: 0, stdout: "me@x.com\n" };
    return { status: 0, stdout: o.log ?? "" };
  };

describe("offer-incident-retro-hook", () => {
  it("offers for a closed-unmerged PR and ignores merged ones", () => {
    const r = call(fake({ gh: { status: 0, stdout: PRS } }));
    expect(r.out).toContain("PR #7 closed unmerged");
    expect(r.out).not.toContain("#8");
    expect(r.code).toBe(0);
  });

  it("offers for a recent revert", () => {
    const r = call(fake({ log: "abc123 Revert \"x\"\n" }));
    expect(r.out).toContain("trigger: revert");
    expect(r.out).toContain("abc123");
  });

  it("is silent when nothing happened", () => {
    expect(call(fake({})).out).toBe("");
  });

  it("fails open with one stderr line when gh fails", () => {
    const r = call(fake({ gh: { status: 1, stdout: "" } }));
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
    expect(r.err.trim().split("\n")).toHaveLength(1);
  });

  it("skips remote sessions and bad stdin", () => {
    expect(call(fake({ gh: { status: 0, stdout: PRS } }), "{}", { CLAUDE_CODE_REMOTE: "true" }).out).toBe("");
    expect(call(fake({ gh: { status: 0, stdout: PRS } }), "not json").out).toBe("");
  });
});
