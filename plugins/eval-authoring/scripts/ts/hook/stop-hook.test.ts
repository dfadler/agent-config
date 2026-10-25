import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findGaps, reasonFor, runStopHook } from "./stop-hook.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const touch = (root: string, rel: string): void => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), "x\n");
};

const repoWithPlugin = (): string => {
  const top = mkdtempSync(join(tmpdir(), "stop-hook-"));
  dirs.push(top);
  touch(top, "plugins/p/.claude-plugin/plugin.json");
  touch(top, "plugins/p/evals/results/run-1/aggregate-result.json");
  return top;
};

describe("findGaps", () => {
  it("flags a skill change with no eval change and names the baseline", () => {
    const top = repoWithPlugin();
    const gaps = findGaps(top, ["plugins/p/skills/s/SKILL.md"]);
    expect(gaps).toEqual([
      { plugin: "plugins/p", changed: ["skills/s/SKILL.md"], baseline: "run-1" },
    ]);
  });

  it("is quiet when an eval file changed too", () => {
    const top = repoWithPlugin();
    expect(
      findGaps(top, ["plugins/p/skills/s/SKILL.md", "plugins/p/evals/c/prompt.md"]),
    ).toEqual([]);
  });

  it("is quiet for a plugin with no eval directory", () => {
    const top = mkdtempSync(join(tmpdir(), "stop-hook-"));
    dirs.push(top);
    touch(top, "plugins/q/.claude-plugin/plugin.json");
    expect(findGaps(top, ["plugins/q/skills/s/SKILL.md"])).toEqual([]);
  });

  it("ignores files that are not skills or agents", () => {
    const top = repoWithPlugin();
    expect(findGaps(top, ["plugins/p/README.md", "plugins/p/scripts/x.ts"])).toEqual([]);
  });
});

describe("runStopHook", () => {
  it("does not block again on the retry", () => {
    expect(runStopHook(JSON.stringify({ stop_hook_active: true }))).toBe("");
  });

  it("no-ops on malformed input", () => {
    expect(runStopHook("not json")).toBe("");
  });
});

describe("runStopHook in a real repo", () => {
  const git = (cwd: string, ...args: string[]): void => {
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: "ignore" });
  };
  // main has the plugin; a feature branch already committed a skill change with no eval change.
  const branchWithCommittedSkillChange = (): string => {
    const top = repoWithPlugin();
    git(top, "init", "-q", "-b", "main");
    git(top, "add", "-A");
    git(top, "commit", "-q", "-m", "base");
    git(top, "checkout", "-q", "-b", "feature");
    touch(top, "plugins/p/skills/s/SKILL.md");
    git(top, "add", "-A");
    git(top, "commit", "-q", "-m", "skill");
    return top;
  };

  it("stays quiet when the skill change was committed before this session", () => {
    const top = branchWithCommittedSkillChange();
    expect(runStopHook(JSON.stringify({ cwd: top }))).toBe("");
  });

  it("blocks on an uncommitted skill change", () => {
    const top = branchWithCommittedSkillChange();
    writeFileSync(join(top, "plugins/p/skills/s/SKILL.md"), "edited\n");
    expect(runStopHook(JSON.stringify({ cwd: top }))).toContain('"decision":"block"');
  });
});

describe("reasonFor", () => {
  it("mentions baseline, author-cases and the escape hatch", () => {
    const text = reasonFor([{ plugin: "plugins/p", changed: ["skills/s/SKILL.md"], baseline: undefined }]);
    expect(text).toContain("none recorded yet");
    expect(text).toContain("author-cases");
    expect(text).toContain("do not apply");
  });
});
