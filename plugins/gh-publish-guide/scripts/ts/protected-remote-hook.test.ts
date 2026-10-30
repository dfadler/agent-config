import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkCommand,
  ownerOf,
  runHook,
  type Run,
} from "./protected-remote-hook.ts";

const urls: Record<string, string> = {
  origin: "git@github.com:me/fork.git",
  upstream: "https://github.com/them/proj.git",
};
const run: Run = (cmd, args) => {
  if (cmd === "git") {
    if (args.includes("@{push}")) {
      return args.includes("/cfg") ? { status: 0, stdout: "upstream/main\n" } : { status: 1, stdout: "" };
    }
    return { status: 0, stdout: urls[args.at(-1) ?? ""] ?? "" };
  }
  // gh repo view: the parent for pr create, the user's own repo otherwise
  return {
    status: 0,
    stdout: args.join(" ").includes(".parent") ? "them" : "me",
  };
};

describe("ownerOf", () => {
  it("parses ssh and https", () => {
    expect(ownerOf("git@github.com:me/fork.git")).toBe("me");
    expect(ownerOf("https://github.com/them/proj")).toBe("them");
  });
});

describe("checkCommand", () => {
  it("asks for pr create in a fork (targets the parent)", () => {
    expect(checkCommand("gh pr create --fill", run, {})).toMatch(/'them'/);
  });
  it("asks for --repo on a foreign owner, allows own", () => {
    expect(checkCommand("gh issue create -R them/proj", run, {})).toMatch(
      /'them'/,
    );
    expect(
      checkCommand("gh issue create --repo me/fork", run, {}),
    ).toBeUndefined();
  });
  it("asks for a push to upstream, allows origin", () => {
    expect(checkCommand("git push upstream main", run, {})).toMatch(/'them'/);
    expect(checkCommand("git push -u origin main", run, {})).toBeUndefined();
    expect(checkCommand("git push", run, {})).toBeUndefined();
  });
  it("follows --repo, -C and a configured push target", () => {
    expect(checkCommand("git push --repo=upstream main", run, {})).toMatch(/'them'/);
    expect(checkCommand("git push --repo upstream", run, {})).toMatch(/'them'/);
    expect(checkCommand("git -C /cfg push", run, {})).toMatch(/'them'/);
  });
  it("sees a chained command", () => {
    expect(checkCommand("git status && git push upstream x", run, {})).toMatch(
      /'them'/,
    );
  });
  it("honors the allowlist and the override", () => {
    const c = "git push upstream main";
    expect(
      checkCommand(c, run, { GH_PROTECTED_REMOTE_ALLOW: "them" }),
    ).toBeUndefined();
    expect(
      checkCommand(c, run, { GH_PROTECTED_REMOTE_OVERRIDE: "1" }),
    ).toBeUndefined();
  });
  it("ignores other commands", () => {
    expect(checkCommand("gh pr view 1", run, {})).toBeUndefined();
  });
});

describe("runHook", () => {
  it("emits an ask decision and fails open on junk", () => {
    const raw = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "git push upstream" },
    });
    expect(JSON.parse(runHook(raw, run, {}))).toMatchObject({
      hookSpecificOutput: { permissionDecision: "ask" },
    });
    expect(runHook("not json", run, {})).toBe("");
  });

  it("runs its lookups in the event's cwd", () => {
    const cwds = new Set<string | undefined>();
    const spy: Run = (cmd, args, cwd) => {
      cwds.add(cwd);
      return run(cmd, args, cwd);
    };
    const raw = JSON.stringify({
      tool_name: "Bash",
      cwd: "/some/repo",
      tool_input: { command: "git push upstream" },
    });
    runHook(raw, spy, {});
    expect([...cwds]).toEqual(["/some/repo"]);
  });
});

describe("entrypoint (spawned)", () => {
  const entry = join(import.meta.dirname, "protected-remote-hook.ts");
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "pr-hook-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });
  // The hook process runs outside any repo; the origin owner must come from the event's cwd.
  const hook = (input: string) =>
    spawnSync(process.execPath, [entry], {
      input,
      cwd: tmp,
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "", HOME: tmp },
    });

  it("asks for gh pr create --repo on an owner other than origin's", () => {
    const repo = join(tmp, "repo");
    spawnSync("git", ["init", "-q", repo]);
    spawnSync("git", ["-C", repo, "remote", "add", "origin", "git@github.com:me/fork.git"]);
    const r = hook(
      JSON.stringify({ tool_name: "Bash", cwd: repo, tool_input: { command: "gh pr create --repo them/x --fill" } }),
    );
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ hookSpecificOutput: { permissionDecision: "ask" } });
    expect(r.stdout).toMatch(/'them'/);
    expect(r.stdout).toContain("(me)");
  });

  it("fails open on garbage stdin", () => {
    expect(hook("not json")).toMatchObject({ status: 0, stdout: "" });
  });
});
