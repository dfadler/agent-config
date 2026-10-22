import { describe, expect, it } from "vitest";
import { run, slugOf } from "./protected-remote-hook.ts";

// `gh api user` -> "me"; `gh repo view` -> repoView; `git remote get-url` -> remoteUrl.
const call = (
  command: string,
  o: { repoView?: string; remoteUrl?: string; env?: Record<string, string> } = {},
) => {
  const out: string[] = [];
  const code = run({
    env: o.env ?? {},
    stdin: JSON.stringify({ cwd: "/r", tool_input: { command } }),
    run: (_c, cmd, args) => {
      if (cmd === "gh" && args[0] === "api") return { status: 0, stdout: "me\n" };
      if (cmd === "gh") return { status: 0, stdout: `${o.repoView ?? "me/x"}\n` };
      return { status: 0, stdout: `${o.remoteUrl ?? "git@github.com:me/x.git"}\n` };
    },
    out: (t) => out.push(t),
  });
  return { code, out: out.join("") };
};

describe("protected-remote hook", () => {
  it("asks on gh pr create against a non-owned (upstream) repo", () => {
    const r = call("gh pr create --title t", { repoView: "upstream/x" });
    expect(r.code).toBe(0);
    expect(r.out).toContain('"permissionDecision":"ask"');
  });
  it("asks on --repo to another owner, even when the default is owned", () => {
    expect(call("gh issue comment 3 -R upstream/x -b hi").out).toContain('"ask"');
  });
  it("asks on git push to a non-owned remote, including chained", () => {
    const r = call("git add . && git push upstream main", {
      remoteUrl: "https://github.com/upstream/x.git",
    });
    expect(r.out).toContain('"ask"');
  });
  it("is silent for owned repos, other commands, the override and listed owners", () => {
    expect(call("gh pr create").out).toBe("");
    expect(call("git push origin main").out).toBe("");
    expect(call("gh pr view 1", { repoView: "upstream/x" }).out).toBe("");
    expect(
      call("gh pr create", { repoView: "upstream/x", env: { GH_PUBLISH_GUARD: "off" } }).out,
    ).toBe("");
    expect(
      call("gh pr create", { repoView: "Acme/x", env: { GH_PUBLISH_OWNERS: "acme" } }).out,
    ).toBe("");
  });
  it("parses remote URLs", () => {
    expect(slugOf("git@github.com:a/b.git")).toBe("a/b");
    expect(slugOf("https://github.com/a/b")).toBe("a/b");
  });
});
