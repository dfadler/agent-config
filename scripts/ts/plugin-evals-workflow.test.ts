import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Runs the real "Report plugins without evals" step (#648) from the workflow
// against a fixture plugins/ tree, so editing the step's logic is covered.
const workflow = readFileSync(
  new URL("../../.github/workflows/plugin-evals.yml", import.meta.url),
  "utf8",
);
const body =
  /- name: Report plugins without evals\n {8}run: \|\n([\s\S]*?)\n {6}- id: list/.exec(
    workflow,
  )?.[1] ?? "";
const step = body.replace(/^ {10}/gm, "");

const report = (layout: string[]) => {
  const dir = mkdtempSync(join(tmpdir(), "evals-"));
  mkdirSync(join(dir, "plugins"));
  for (const p of layout) {
    mkdirSync(join(dir, "plugins", ...p.split("/")), { recursive: true });
  }
  const summary = join(dir, "summary.md");
  writeFileSync(summary, "");
  const r = spawnSync("bash", ["-c", step], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, ["GITHUB_STEP_SUMMARY"]: summary },
  });
  return {
    status: r.status,
    out: r.stdout,
    summary: readFileSync(summary, "utf8"),
  };
};

describe("plan job: plugins without evals", () => {
  it("warns about plugins with skills or agents but no evals/", () => {
    const r = report([
      "a/skills",
      "b/agents",
      "c/skills",
      "c/evals",
      "d/hooks",
    ]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("::warning::");
    expect(r.summary).toContain("a b");
    expect(r.summary).not.toMatch(/\bc\b|\bd\b/);
  });

  it("says all is well when every such plugin has evals/", () => {
    const r = report(["c/skills", "c/evals"]);
    expect(r.out).not.toContain("::warning::");
    expect(r.summary).toContain("Every plugin");
  });
});

// The notify job's step (#738), run against a fake `gh` that logs its argv.
const notifyStep = (
  /- name: Open or update failure issue\n {8}env:[\s\S]*?run: \|\n([\s\S]*)$/.exec(
    workflow,
  )?.[1] ?? ""
).replace(/^ {10}/gm, "");

const notify = (existing: string) => {
  const dir = mkdtempSync(join(tmpdir(), "notify-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "gh.log");
  writeFileSync(
    join(bin, "gh"),
    `#!/bin/bash\necho "$1 $2" >> "${log}"\n[ "$1 $2" = "issue list" ] && echo "${existing}"\nexit 0\n`,
    { mode: 0o755 },
  );
  const r = spawnSync("bash", ["-c", notifyStep], {
    encoding: "utf8",
    env: {
      ...process.env,
      ["PATH"]: `${bin}:${process.env["PATH"] ?? ""}`,
      ["GITHUB_REPOSITORY"]: "o/r",
      ["RUN_URL"]: "https://x/run/1",
    },
  });
  return { status: r.status, calls: readFileSync(log, "utf8") };
};

describe("eval job: cost ceiling", () => {
  it("passes the wrapper a $25 ceiling on the standard tier (#648)", () => {
    expect(workflow).toMatch(
      /--tier standard \\\n\s+--max-cost-usd 25 \\\n\s+--output-dir/,
    );
  });

  it("gives the eval job 90 minutes so a full run is not cut off (#648)", () => {
    expect(workflow).toMatch(/\n {2}eval:[\s\S]*?\n {4}timeout-minutes: 90\n/);
  });
});

describe("notify job: failure issue", () => {
  it("runs only on failure, with issues: write on that job alone", () => {
    expect(workflow).toMatch(/notify:[\s\S]*if: \$\{\{ failure\(\) \}\}/);
    expect(workflow.match(/^ +issues: write$/gm)).toHaveLength(1);
  });

  it("creates an issue when none is open", () => {
    const r = notify("");
    expect(r.status).toBe(0);
    expect(r.calls).toContain("issue create");
  });

  it("comments on the open issue instead of duplicating", () => {
    const r = notify("42");
    expect(r.calls).toContain("issue comment");
    expect(r.calls).not.toContain("issue create");
  });
});
