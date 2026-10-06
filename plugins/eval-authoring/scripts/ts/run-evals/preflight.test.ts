import { describe, expect, it } from "vitest";
import {
  checkClaudeVersion,
  checkGitVersion,
  checkSandbox,
  checkShadowing,
  runPreflight,
} from "./preflight.ts";
import { fakeIo, spawned } from "./test-support.ts";

const ver = (stdout: string) => spawned({ stdout });

describe("checkClaudeVersion", () => {
  it("accepts 2.1.269 and later", () => {
    expect(checkClaudeVersion(ver("2.1.269 (Claude Code)"))).toEqual([]);
    expect(checkClaudeVersion(ver("2.1.287 (Claude Code)"))).toEqual([]);
  });
  it("rejects an older version, naming both", () => {
    const f = checkClaudeVersion(ver("2.1.268 (Claude Code)"));
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain("2.1.268");
    expect(f[0]?.message).toContain("2.1.269");
    expect(f[0]?.level).toBe("error");
  });
  it("errors when the version cannot be run or read", () => {
    expect(checkClaudeVersion(undefined)).toHaveLength(1);
    expect(checkClaudeVersion(spawned({ status: 1 }))).toHaveLength(1);
    expect(checkClaudeVersion(ver("garbage"))).toHaveLength(1);
  });
});

describe("checkGitVersion", () => {
  it("passes without git", () => {
    expect(checkGitVersion(undefined)).toEqual([]);
    expect(checkGitVersion(spawned({ error: "ENOENT", status: null }))).toEqual([]);
  });
  it("accepts 2.31 and rejects 2.30", () => {
    expect(checkGitVersion(ver("git version 2.31.0"))).toEqual([]);
    expect(checkGitVersion(ver("git version 2.30.9"))).toHaveLength(1);
  });
});

describe("checkSandbox", () => {
  const has = (...names: string[]) => (n: string) => names.includes(n);
  it("needs nothing when Bash is not granted", () => {
    expect(checkSandbox("linux", false, has())).toEqual([]);
    expect(checkSandbox("win32", false, has())).toEqual([]);
  });
  it("fails on native Windows when Bash is granted", () => {
    expect(checkSandbox("win32", true, has())).toHaveLength(1);
  });
  it("needs bwrap and socat on Linux, naming what is missing", () => {
    expect(checkSandbox("linux", true, has("bwrap", "socat"))).toEqual([]);
    const f = checkSandbox("linux", true, has("bwrap"));
    expect(f[0]?.message).toContain("socat");
    expect(f[0]?.message).not.toContain("bubblewrap");
    expect(checkSandbox("linux", true, has())[0]?.message).toContain(
      "bubblewrap and socat",
    );
  });
  it("accepts macOS", () => {
    expect(checkSandbox("darwin", true, has())).toEqual([]);
  });
});

describe("checkShadowing", () => {
  it("warns, without failing, on more than one install", () => {
    expect(checkShadowing(["/a/claude"])).toEqual([]);
    const f = checkShadowing(["/a/claude", "/b/claude"]);
    expect(f).toHaveLength(1);
    expect(f[0]?.level).toBe("warning");
  });
});

describe("runPreflight", () => {
  it("is clean on a good machine", async () => {
    const { io } = fakeIo();
    expect(await runPreflight(io, false)).toEqual([]);
  });
  it("errors when claude is not on PATH, without spawning it", async () => {
    const { io, calls } = fakeIo({ onPath: {} });
    const f = await runPreflight(io, false);
    expect(f).toHaveLength(1);
    expect(calls).toEqual([]);
  });
  it("reports an old claude", async () => {
    const { io } = fakeIo({ claudeVersion: "2.1.77" });
    expect((await runPreflight(io, false))[0]?.message).toContain("2.1.77");
  });
  it("skips the git check when git is absent", async () => {
    const { io, calls } = fakeIo({ onPath: { claude: ["/bin/claude"] } });
    expect(await runPreflight(io, false)).toEqual([]);
    expect(calls.map((c) => c.command)).toEqual(["claude"]);
  });
  it("checks the sandbox only when Bash is granted", async () => {
    const onPath = { claude: ["/bin/claude"], git: ["/bin/git"] };
    const { io } = fakeIo({ platform: "linux", onPath });
    expect(await runPreflight(io, false)).toEqual([]);
    expect(await runPreflight(io, true)).toHaveLength(1);
  });
});
