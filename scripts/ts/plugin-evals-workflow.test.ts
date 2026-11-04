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
      /--tier standard \\\n\s+--max-cost-usd 25 \\\n\s+--jobs 6 \\\n\s+--output-dir/,
    );
  });

  it("ends the wrapper on its own deadline, before the eval job is cancelled (#648)", () => {
    const job = Number(
      /\n {2}eval:[\s\S]*?\n {4}timeout-minutes: (\d+)\n/.exec(workflow)?.[1],
    );
    const wrapped =
      /timeout --signal=INT --kill-after=(\d+)m (\d+)m \\\n\s+node plugins\/eval-authoring\/scripts\/ts\/run-evals\/run-evals\.ts/.exec(
        workflow,
      );
    if (wrapped === null) {
      throw new Error(
        "wrapper call is not wrapped in `timeout --signal=INT --kill-after=Nm Mm node ...run-evals.ts`",
      );
    }
    const grace = Number(wrapped[1]);
    const deadline = Number(wrapped[2]);
    expect(job).toBe(30);
    expect(deadline).toBeGreaterThanOrEqual(20);
    // Room left after the deadline and kill grace for the Check and Upload steps.
    expect(deadline + grace + 5).toBeLessThanOrEqual(job);
  });
});

// The Check results step, run against a fake `node` that logs its argv and exits
// with a chosen code. The step must hand the checker every result file in ONE
// call: the mean-delta floor (#736) needs all cases of the plugin at once.
const checkStep = (
  /- name: Check results\n {8}run: \|\n([\s\S]*?)\n\n {6}- name: Upload results/.exec(
    workflow,
  )?.[1] ?? ""
).replace(/^ {10}/gm, "");

const check = (resultFiles: string[], wrapperExit = "0", checkerRc = 0) => {
  const dir = mkdtempSync(join(tmpdir(), "check-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "node.log");
  writeFileSync(
    join(bin, "node"),
    `#!/bin/bash\necho "$*" >> "${log}"\nexit ${String(checkerRc)}\n`,
    { mode: 0o755 },
  );
  const out = join(dir, "out");
  mkdirSync(out);
  writeFileSync(join(out, "cli-exit"), wrapperExit);
  for (const f of resultFiles) {
    mkdirSync(join(out, f), { recursive: true });
    writeFileSync(join(out, f, "aggregate-result.json"), "{}");
  }
  writeFileSync(log, "");
  const summary = join(dir, "summary.md");
  writeFileSync(summary, "");
  const r = spawnSync("bash", ["-c", checkStep], {
    encoding: "utf8",
    env: {
      ...process.env,
      ["PATH"]: `${bin}:${process.env["PATH"] ?? ""}`,
      ["OUT_DIR"]: out,
      ["GITHUB_STEP_SUMMARY"]: summary,
    },
  });
  return {
    status: r.status,
    out: r.stdout + r.stderr,
    calls: readFileSync(log, "utf8").split("\n").filter((l) => l !== ""),
  };
};

describe("eval job: check results step", () => {
  it("calls the checker once with every result file (C17)", () => {
    const r = check(["a", "b", "c"]);
    expect(r.calls).toHaveLength(1);
    const call = r.calls[0] ?? "";
    expect(call).toContain("--delta-floor 0.14");
    for (const c of ["a", "b", "c"]) {
      expect(call).toContain(`/out/${c}/aggregate-result.json`);
    }
  });

  it("exits with the checker's code", () => {
    expect(check(["a"], "0", 1).status).toBe(1);
    expect(check(["a"], "0", 0).status).toBe(0);
  });

  it("flags an inconclusive checker result (exit 7)", () => {
    const r = check(["a"], "0", 7);
    expect(r.status).toBe(7);
    expect(r.out).toContain("inconclusive");
  });

  it("is inconclusive, without calling the checker, when no result file exists", () => {
    const r = check([]);
    expect(r.status).toBe(7);
    expect(r.calls).toHaveLength(0);
  });

  it("maps a wrapper exit other than 0 or 1 to the checker's invalid-run code", () => {
    expect(check(["a"], "137").calls[0]).toContain("--cli-exit 2");
    expect(check(["a"], "1").calls[0]).toContain("--cli-exit 1");
  });
});

// The Run evals step, run under `bash -e` like the runner's default shell, with a
// fake `node` (the wrapper) and a `timeout` shim (macOS has none). A failing
// wrapper must not end the step before cli-exit is written, or Check is skipped (#906).
const runStep = (
  /- name: Run evals\n {8}env:[\s\S]*?run: \|\n([\s\S]*?)\n\n {6}# No secrets in this step/.exec(
    workflow,
  )?.[1] ?? ""
).replace(/^ {10}/gm, "");

const runEvals = (wrapperExit: number) => {
  const dir = mkdtempSync(join(tmpdir(), "run-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "node"),
    `#!/bin/bash\nexit ${String(wrapperExit)}\n`,
    { mode: 0o755 },
  );
  writeFileSync(join(bin, "timeout"), `#!/bin/bash\nshift 3\nexec "$@"\n`, {
    mode: 0o755,
  });
  const out = join(dir, "out");
  const r = spawnSync("bash", ["-e", "-c", runStep], {
    encoding: "utf8",
    env: {
      ...process.env,
      ["PATH"]: `${bin}:${process.env["PATH"] ?? ""}`,
      ["OUT_DIR"]: out,
      ["PLUGIN"]: "p",
    },
  });
  return {
    status: r.status,
    cliExit: readFileSync(join(out, "cli-exit"), "utf8").trim(),
  };
};

describe("eval job: run evals step", () => {
  it("writes the wrapper's non-zero exit to cli-exit and still succeeds (#906)", () => {
    const r = runEvals(1);
    expect(r.cliExit).toBe("1");
    expect(r.status).toBe(0);
  });

  it("writes 0 when the wrapper passes", () => {
    expect(runEvals(0).cliExit).toBe("0");
  });
});

describe("notify job: failure issue", () => {
  it("fires on a failed or cancelled eval (job timeout), not on success (#889)", () => {
    expect(workflow).toMatch(
      /notify:[\s\S]*if: \$\{\{ always\(\) && \(needs\.plan\.result == 'failure' \|\| needs\.eval\.result == 'failure' \|\| needs\.eval\.result == 'cancelled'\) \}\}/,
    );
  });

  it("uploads results even when the eval job is cancelled by its timeout (#889)", () => {
    expect(workflow).toMatch(
      /- name: Upload results\n\s+(?:#.*\n\s+)*if: \$\{\{ always\(\) \}\}/,
    );
  });

  it("keeps issues: write on the notify job alone", () => {
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
