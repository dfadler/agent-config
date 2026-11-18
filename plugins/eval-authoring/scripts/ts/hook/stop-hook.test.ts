import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findGaps, markerPath, reasonFor, runStopHook } from "./stop-hook.ts";

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
      { plugin: "plugins/p", changed: ["skills/s/SKILL.md"], baseline: "run-1", weak: [] },
    ]);
  });

  it("is quiet when an eval file changed too", () => {
    const top = repoWithPlugin();
    expect(
      findGaps(top, ["plugins/p/skills/s/SKILL.md", "plugins/p/evals/c/prompt.md"]),
    ).toEqual([]);
  });

  describe("changed cases that cannot fail", () => {
    const quietCheck = `    type: tool_used
    tool: Skill
    input_match: 's'
    min: 0
    max: 0
    arm: both`;
    const regexCheck = `    type: regex
    target: last_message
    pattern: 'gh issue view'
    match: contains
    arm: both`;
    const caseYaml = (name: string, tags: string, header: string, grader: string): string =>
      `${header}schema_version: "1.1"
name: ${name}
description: >
  A fixture case. expected_outcome: PASS when the reply is right; FAIL when it is wrong.
tags: [${tags}]
execution:
  prompt: |
    Which command prints issue 42?
  max_turns: 4
graders:
  - name: g
${grader}
`;
    const withCase = (name: string, tags: string, header: string, grader: string): string => {
      const top = repoWithPlugin();
      mkdirSync(join(top, "plugins/p/evals", name), { recursive: true });
      writeFileSync(join(top, "plugins/p/evals", name, "case.yaml"), caseYaml(name, tags, header, grader));
      return top;
    };
    const files = (name: string): string[] => ["plugins/p/skills/s/SKILL.md", `plugins/p/evals/${name}/case.yaml`];

    it("flags a changed case whose only grader passes without the plugin, with the reason", () => {
      const top = withCase("weak", "t", "", quietCheck);
      expect(findGaps(top, files("weak"))[0]?.weak).toEqual([
        "weak: every grader passes without the plugin or is cued by the prompt text",
      ]);
    });

    it("is quiet when a regex grader fails the case's own bad reply", () => {
      const top = withCase("strong", "t", "# bad-reply: no command here\n", regexCheck);
      expect(findGaps(top, files("strong"))).toEqual([]);
    });

    it("is quiet for a labelled smoke case", () => {
      const top = withCase("held", "smoke", "", quietCheck);
      expect(findGaps(top, files("held"))).toEqual([]);
    });

    it("does not judge a case that did not change", () => {
      const top = withCase("weak", "t", "", quietCheck);
      expect(findGaps(top, ["plugins/p/skills/s/SKILL.md", "plugins/p/evals/other/case.yaml"])).toEqual([]);
    });
  });

  it("is quiet for a plugin with no eval directory", () => {
    const top = mkdtempSync(join(tmpdir(), "stop-hook-"));
    dirs.push(top);
    touch(top, "plugins/q/.claude-plugin/plugin.json");
    expect(findGaps(top, ["plugins/q/skills/s/SKILL.md"])).toEqual([]);
  });

  describe("baseline", () => {
    const summary = (top: string, run: string, body: Record<string, unknown>): void => {
      mkdirSync(join(top, "plugins/p/evals/results", run), { recursive: true });
      writeFileSync(join(top, "plugins/p/evals/results", run, "run-evals-summary.json"), JSON.stringify(body));
    };
    const baseline = (top: string): string | undefined =>
      findGaps(top, ["plugins/p/skills/s/SKILL.md"])[0]?.baseline;

    it("skips a newer subset, plugin-arm-only (quick, neighbours, trigger-boundary), unfinished or untrustworthy (exit 7, missing result) run and names the case count", () => {
      const top = repoWithPlugin();
      const ran = { resultDir: "r" };
      // Exit 1 is a below-threshold result: a valid before score, so it stays eligible.
      summary(top, "run-2", { ablation: "cli-default", subset: null, unstarted: [], exit: 1, invocations: [ran, ran, ran] });
      summary(top, "run-8", { ablation: "cli-default", subset: null, unstarted: [], exit: 7, invocations: [ran, ran] });
      summary(top, "run-9", { ablation: "cli-default", subset: null, unstarted: [], exit: 1, invocations: [ran, {}] });
      summary(top, "run-3", { ablation: "cli-default", subset: "subset: 1 of 3 standard cases, --changed since base", invocations: [{}] });
      summary(top, "run-4", { ablation: "none", neighbours: ["n"], invocations: [{}] });
      summary(top, "run-5", { ablation: "none", triggerBoundary: { fires: 0 }, invocations: [{}] });
      summary(top, "run-6", { ablation: "none", subset: null, invocations: [{}] });
      summary(top, "run-7", { ablation: "cli-default", subset: null, unstarted: ["c3"], invocations: [{}, {}] });
      expect(baseline(top)).toBe("run-2 (3 cases)");
    });

    it("says none recorded when every run is a subset", () => {
      const top = mkdtempSync(join(tmpdir(), "stop-hook-"));
      dirs.push(top);
      touch(top, "plugins/p/.claude-plugin/plugin.json");
      summary(top, "run-1", { subset: "subset: 1 of 3", invocations: [{}] });
      expect(baseline(top)).toBeUndefined();
    });

    it("fails open on an unreadable summary", () => {
      const top = repoWithPlugin();
      touch(top, "plugins/p/evals/results/run-9/run-evals-summary.json");
      expect(baseline(top)).toBe("run-9");
    });
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

  const ids: string[] = [];
  const sid = (): string => {
    const id = `t${String(process.pid)}-${String(ids.length)}-${String(Date.now())}`;
    ids.push(id);
    return id;
  };
  afterEach(() => {
    for (const id of ids.splice(0)) rmSync(markerPath(id) ?? "", { force: true });
  });
  const stop = (top: string, session_id: string): string =>
    runStopHook(JSON.stringify({ cwd: top, session_id }));

  it("blocks a committed skill change on the first stop of a session", () => {
    expect(stop(branchWithCommittedSkillChange(), sid())).toContain('"decision":"block"');
  });

  it("does not block the second stop of the same session", () => {
    const top = branchWithCommittedSkillChange();
    const id = sid();
    stop(top, id);
    expect(stop(top, id)).toBe("");
  });

  it("blocks again for a different session", () => {
    const top = branchWithCommittedSkillChange();
    stop(top, sid());
    expect(stop(top, sid())).toContain('"decision":"block"');
  });

  it("blocks an uncommitted skill change", () => {
    const top = repoWithPlugin();
    git(top, "init", "-q", "-b", "main");
    git(top, "add", "-A");
    git(top, "commit", "-q", "-m", "base");
    touch(top, "plugins/p/skills/s/SKILL.md");
    expect(stop(top, sid())).toContain('"decision":"block"');
  });

  it("falls back to @{upstream} when neither origin/main nor main exists (#753)", () => {
    const top = repoWithPlugin();
    git(top, "init", "-q", "-b", "trunk");
    git(top, "add", "-A");
    git(top, "commit", "-q", "-m", "base");
    git(top, "checkout", "-q", "-b", "feature");
    git(top, "branch", "--set-upstream-to=trunk");
    touch(top, "plugins/p/skills/s/SKILL.md");
    git(top, "add", "-A");
    git(top, "commit", "-q", "-m", "skill");
    expect(stop(top, sid())).toContain('"decision":"block"');
  });

  it("diffs against the remote's default branch when it is not called main", () => {
    const top = repoWithPlugin();
    git(top, "init", "-q", "-b", "work");
    git(top, "add", "-A");
    git(top, "commit", "-q", "-m", "base");
    git(top, "update-ref", "refs/remotes/origin/trunk", "HEAD");
    git(top, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk");
    git(top, "checkout", "-q", "-b", "feature");
    touch(top, "plugins/p/skills/s/SKILL.md");
    git(top, "add", "-A");
    git(top, "commit", "-q", "-m", "skill");
    expect(stop(top, sid())).toContain('"decision":"block"');
  });

  it("writes no marker for an unsafe session_id", () => {
    expect(markerPath("../escape")).toBeUndefined();
    expect(markerPath("a/b")).toBeUndefined();
    const top = branchWithCommittedSkillChange();
    expect(stop(top, "../escape")).toContain('"decision":"block"');
    expect(stop(top, "../escape")).toContain('"decision":"block"');
    expect(existsSync(join(tmpdir(), "..", "escape"))).toBe(false);
  });
});

describe("reasonFor", () => {
  it("mentions baseline, author-cases and the escape hatch", () => {
    const text = reasonFor([{ plugin: "plugins/p", changed: ["skills/s/SKILL.md"], baseline: undefined, weak: ["c: every grader passes"] }]);
    expect(text).toContain("none recorded yet");
    expect(text).toContain("c: every grader passes");
    expect(text).toContain("author-cases");
    expect(text).toContain("do not apply");
  });
});
