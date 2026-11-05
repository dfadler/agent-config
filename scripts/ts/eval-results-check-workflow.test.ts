import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Runs the real "Require an Eval results section" step (#662) from the
// workflow against a fake `gh`, so the heading rule and the error text are
// covered.
const workflow = readFileSync(
  new URL("../../.github/workflows/eval-results-check.yml", import.meta.url),
  "utf8",
);
const body =
  /- name: Require an Eval results section when evals change\n[\s\S]*? {8}run: \|\n([\s\S]*)$/.exec(
    workflow,
  )?.[1] ?? "";
const step = body.replace(/^ {10}/gm, "");

const check = (changedFiles: string[], prBody: string) => {
  const dir = mkdtempSync(join(tmpdir(), "evalres-"));
  // The step pipes `gh api ... --jq` into grep; the fake prints the file list.
  const gh = join(dir, "gh");
  writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' ${changedFiles.map((f) => `'${f}'`).join(" ")}\n`);
  chmodSync(gh, 0o755);
  const r = spawnSync("bash", ["-c", step], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env["PATH"] ?? ""}`,
      ["GITHUB_REPOSITORY"]: "o/r",
      ["PR_NUMBER"]: "1",
      ["PR_BODY"]: prBody,
    },
  });
  return { status: r.status, out: r.stdout };
};

const EVALS = ["plugins/p/evals/c/case.yaml"];

describe("eval-results-check step", () => {
  it("extracts the step body", () => {
    expect(step).toContain("PR_BODY");
  });

  it("ignores a PR that does not touch evals", () => {
    const r = check(["README.md"], "no heading");
    expect(r.status).toBe(0);
    expect(r.out).toContain("nothing to check");
  });

  it.each(["## Eval results", "#### eval RESULTS  ", "# Eval results"])(
    "accepts the heading %j",
    (heading) => {
      expect(check(EVALS, `## Summary\n\n${heading}\n\nlooks fine`).status).toBe(0);
    },
  );

  it.each(["## Evidence", "## Eval results (3 cases)", "Eval results", "x ## Eval results"])(
    "rejects %j and says what to fix",
    (line) => {
      const r = check(EVALS, `## Summary\n\n${line}\n`);
      expect(r.status).toBe(1);
      expect(r.out).toContain("named exactly 'Eval results'");
      expect(r.out).toContain("gh pr edit");
      expect(r.out).toContain("re-running this job reuses the old body");
    },
  );
});
