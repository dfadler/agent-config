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
