import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AmbiguousPrimaryWorkflowError,
  buildCollectSummary,
  collect,
  CollectFatalError,
  detectPrimaryWorkflow,
  getWorkflowEvents,
  main,
  type CollectDeps,
} from "./collect.ts";
import type { Gh } from "./gh.ts";
import { fakeIo, readObj } from "./test-io.ts";

const NOW = new Date("2025-03-31T12:00:00Z");
const CI = { id: 12345, name: "CI", path: ".github/workflows/ci.yml" };
const RUN = {
  id: 99001,
  run_started_at: "2024-01-01T10:00:00Z",
  updated_at: "2024-01-01T10:10:00Z",
  conclusion: "success",
  created_at: "2024-01-01T10:00:00Z",
};

interface FakeOpts {
  workflows?: object[];
  events?: string[];
  runs?: object;
  fail?: boolean;
}

/** URL-routed fake of every `gh api` call the collector makes (most specific first). */
const fakeGh = (o: FakeOpts = {}): { gh: Gh; urls: string[] } => {
  const urls: string[] = [];
  const gh: Gh = (args) => {
    const url = args[0] ?? "";
    urls.push(url);
    if (o.fail === true) throw new Error("gh api failed: simulated");
    if (url.endsWith("/actions/workflows") && args.includes("--jq")) return JSON.stringify(o.workflows ?? [CI]);
    if (url.includes("/actions/runs/") && url.includes("/jobs")) return '{"jobs":[]}';
    if (url.includes("per_page=100") && url.includes("/runs")) {
      // Secondary-workflow timing asks for the same URL with a --jq projection.
      return args.includes("--jq") ? "[]" : JSON.stringify(o.runs ?? { workflow_runs: [RUN] });
    }
    if (url.includes("per_page=10")) return JSON.stringify(o.events ?? ["push"]);
    if (url.includes("per_page=1&")) return "42\n";
    return "Secondary\n";
  };
  return { gh, urls };
};

const mkDeps = (gh: Gh): { deps: CollectDeps; log: () => string } => {
  const log: string[] = [];
  return { deps: { gh, now: () => NOW, log: (s) => log.push(s) }, log: () => log.join("") };
};

const outDir = (): string => join(mkdtempSync(join(tmpdir(), "collect-")), "outputs");

describe("detectPrimaryWorkflow", () => {
  const wfs = [{ id: 1, name: "CI" }, { id: 2, name: "Deploy" }];

  it("picks the single push/pull_request workflow", () => {
    const gh: Gh = (a) => (a[0]?.includes("/workflows/1/") === true ? '["push"]' : '["schedule"]');
    const r = detectPrimaryWorkflow(wfs, "o/r", gh);
    expect(r).toMatchObject({ workflow: wfs[0], ambiguous: false, warning: null });
  });

  it("is ambiguous when several match", () => {
    const r = detectPrimaryWorkflow(wfs, "o/r", () => '["pull_request"]');
    expect(r).toMatchObject({ workflow: null, ambiguous: true, candidates: wfs });
  });

  it("falls back to the first workflow with a warning", () => {
    const r = detectPrimaryWorkflow([{ id: 99, name: "OnlySchedule" }], "o/r", () => '["schedule"]');
    expect(r.workflow).toEqual({ id: 99, name: "OnlySchedule" });
    expect(r.warning).toContain("defaulting to first active workflow: OnlySchedule (id=99)");
  });

  it("reports no active workflows", () => {
    expect(detectPrimaryWorkflow([], "o/r", () => "[]")).toMatchObject({
      workflow: null,
      ambiguous: false,
      warning: "No active workflows found.",
    });
  });
});

describe("getWorkflowEvents", () => {
  it("returns the distinct events, tolerating empty output", () => {
    expect(getWorkflowEvents("o/r", 1, () => '["push","pull_request"]')).toEqual(new Set(["push", "pull_request"]));
    expect(getWorkflowEvents("o/r", 1, () => "")).toEqual(new Set());
    expect(getWorkflowEvents("o/r", 1, () => '{"not":"a list"}')).toEqual(new Set());
  });

  it("swallows errors", () => {
    expect(
      getWorkflowEvents("o/r", 1, () => {
        throw new Error("boom");
      }),
    ).toEqual(new Set());
    expect(getWorkflowEvents("o/r", 1, () => "not json")).toEqual(new Set());
  });
});

it("buildCollectSummary has the contract fields", () => {
  expect(
    buildCollectSummary({ repo: "o/r", workflowId: 1, workflowName: "CI", p50RunId: 9, p50DurationMin: 4.5, runCount: 100, now: NOW }),
  ).toEqual({
    repo: "o/r",
    primary_workflow_id: 1,
    primary_workflow_name: "CI",
    p50_run_id: 9,
    p50_duration_min: 4.5,
    run_count_30d: 100,
    collected_at: "2025-03-31T12:00:00Z",
  });
});

describe("collect", () => {
  it("writes every output file with the contract content", () => {
    const dir = outDir();
    const { gh, urls } = fakeGh();
    const { deps, log } = mkDeps(gh);
    const result = collect({ repo: "o/r", outputDir: dir, workflowId: 12345, deps });

    expect(result).toEqual({ repo: "o/r", workflowId: 12345, workflowName: "CI", p50RunId: 99001, runCount: 42 });
    for (const f of [
      "workflows.json",
      "run_count_primary.txt",
      "runs.json",
      "p50_run.txt",
      "jobs.json",
      "failure_check.json",
      "workflow_stats.txt",
      "collect_summary.json",
      "collect_timing.json",
    ]) {
      expect(existsSync(join(dir, f)), f).toBe(true);
    }
    expect(readFileSync(join(dir, "p50_run.txt"), "utf8")).toBe("99001  10.0m  2024-01-01T10:00:00Z\n");
    expect(readFileSync(join(dir, "run_count_primary.txt"), "utf8")).toBe("42\n");
    expect(readFileSync(join(dir, "workflow_stats.txt"), "utf8")).toBe("no secondary workflows\n");
    expect(readObj(join(dir, "failure_check.json"))).toMatchObject({ chronic: false, failure_rate: 0 });
    expect(readObj(join(dir, "collect_summary.json"))).toMatchObject({ primary_workflow_name: "CI", p50_run_id: 99001, run_count_30d: 42 });
    expect(readObj(join(dir, "collect_timing.json"))).toMatchObject({ duration_seconds: 0 });
    expect(urls).toContain("repos/o/r/actions/workflows/12345/runs?per_page=1&created=>=2025-03-01T12:00:00Z");
    expect(urls.some((u) => u.includes("/events"))).toBe(false);
    expect(log()).toContain("Step 8: writing collect_summary.json");
  });

  it("fetches stats for the other workflows", () => {
    const dir = outDir();
    const { gh } = fakeGh({ workflows: [CI, { id: 777, name: "Deploy" }] });
    collect({ repo: "o/r", outputDir: dir, workflowId: 12345, deps: mkDeps(gh).deps });
    const stats = readFileSync(join(dir, "workflow_stats.txt"), "utf8");
    expect(stats).toContain("WF_ID");
    expect(stats).toContain("777");
  });

  it("detects the primary workflow when no id is given", () => {
    const dir = outDir();
    const r = collect({ repo: "o/r", outputDir: dir, workflowId: null, deps: mkDeps(fakeGh().gh).deps });
    expect(r.workflowId).toBe(12345);
  });

  it("logs the fallback warning when detection defaults to the first workflow", () => {
    const m = mkDeps(fakeGh({ events: ["schedule"] }).gh);
    collect({ repo: "o/r", outputDir: outDir(), workflowId: null, deps: m.deps });
    expect(m.log()).toContain("defaulting to first active workflow");
  });

  it("writes workflow_candidates.json and throws when ambiguous", () => {
    const dir = outDir();
    const two = [{ id: 1, name: "CI" }, { id: 2, name: "Build" }];
    expect(() => collect({ repo: "o/r", outputDir: dir, workflowId: null, deps: mkDeps(fakeGh({ workflows: two }).gh).deps })).toThrow(
      AmbiguousPrimaryWorkflowError,
    );
    expect(JSON.parse(readFileSync(join(dir, "workflow_candidates.json"), "utf8"))).toEqual(two);
    expect(existsSync(join(dir, "runs.json"))).toBe(false);
  });

  it("is fatal with no active workflows", () => {
    expect(() =>
      collect({ repo: "o/r", outputDir: outDir(), workflowId: null, deps: mkDeps(fakeGh({ workflows: [] }).gh).deps }),
    ).toThrow(CollectFatalError);
  });

  it("is fatal when there is no successful run", () => {
    const gh = fakeGh({ runs: { workflow_runs: [{ id: 1, conclusion: "failure" }] } }).gh;
    expect(() => collect({ repo: "o/r", outputDir: outDir(), workflowId: 12345, deps: mkDeps(gh).deps })).toThrow(
      /No successful runs/,
    );
  });

  it("wraps a gh failure as a fatal error", () => {
    expect(() => collect({ repo: "o/r", outputDir: outDir(), workflowId: 12345, deps: mkDeps(fakeGh({ fail: true }).gh).deps })).toThrow(
      CollectFatalError,
    );
  });

  it("reports malformed workflow JSON as a fatal error, not a SyntaxError", () => {
    const base = fakeGh().gh;
    const gh: Gh = (a) => (a.some((x) => x.endsWith("/actions/workflows")) ? "{not json" : base(a));
    expect(() => collect({ repo: "o/r", outputDir: outDir(), workflowId: 12345, deps: mkDeps(gh).deps })).toThrow(/Invalid JSON in workflows/);
  });

  it("is fatal on a non-numeric run count", () => {
    const base = fakeGh().gh;
    const gh: Gh = (a) => (a.includes(".total_count") ? "lots\n" : base(a));
    expect(() => collect({ repo: "o/r", outputDir: outDir(), workflowId: 12345, deps: mkDeps(gh).deps })).toThrow(/unexpected run count/);
  });
});

describe("main", () => {
  const run = (argv: string[], gh = fakeGh().gh) => {
    const io = fakeIo();
    return { code: main(argv, io.io, mkDeps(gh).deps), out: io.out(), err: io.err() };
  };

  it("exits 0 with a COLLECT OK line", () => {
    const r = run(["--repo", "o/r", "--output-dir", outDir(), "--workflow-id", "12345"]);
    expect(r.code).toBe(0);
    expect(r.out).toBe("COLLECT OK: o/r  primary=CI id=12345  p50_run=99001  runs_30d=42\n");
  });

  it("exits 2 when the primary workflow is ambiguous", () => {
    const two = [{ id: 1, name: "CI" }, { id: 2, name: "Build" }];
    expect(run(["--repo", "o/r", "--output-dir", outDir()], fakeGh({ workflows: two }).gh).code).toBe(2);
  });

  it("exits 1 when gh fails", () => {
    const r = run(["--repo", "o/r", "--output-dir", outDir(), "--workflow-id", "1"], fakeGh({ fail: true }).gh);
    expect(r.code).toBe(1);
    expect(r.err).toContain("simulated");
  });

  it.each([
    [[]],
    [["--repo", "o/r"]],
    [["--output-dir", "x"]],
    [["--repo", "o/r", "--output-dir", "x", "--workflow-id", "abc"]],
    [["--bogus"]],
  ])("exits 1 (never 2) on bad usage %j", (argv) => {
    expect(run(argv).code).toBe(1);
  });

  it("prints help", () => {
    const r = run(["--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Usage:");
  });
});

describe("CLI against a gh PATH shim", () => {
  const SCRIPT = join(import.meta.dirname, "collect.ts");

  const setup = (shim: string) => {
    const root = mkdtempSync(join(tmpdir(), "collect-cli-"));
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "gh"), shim);
    chmodSync(join(bin, "gh"), 0o755);
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [SCRIPT, ...args], {
        encoding: "utf8",
        env: { PATH: `${bin}:${dirname(process.execPath)}` },
      });
    return { root, run };
  };

  const OK_SHIM = `#!/bin/sh
case "$2" in
  */actions/workflows) echo '[{"id":12345,"name":"CI","path":"ci.yml"}]' ;;
  */jobs*) echo '{"jobs":[]}' ;;
  *per_page=100*) echo '{"workflow_runs":[{"id":99001,"run_started_at":"2024-01-01T10:00:00Z","updated_at":"2024-01-01T10:10:00Z","conclusion":"success","created_at":"2024-01-01T10:00:00Z"}]}' ;;
  *per_page=1*) echo 42 ;;
  *) echo "unexpected: $*" >&2; exit 3 ;;
esac
`;

  it("runs end to end with real child processes", () => {
    const { root, run } = setup(OK_SHIM);
    const r = run("--repo", "o/r", "--output-dir", join(root, "out"), "--workflow-id", "12345");
    expect(r.stderr).toContain("[collect] Step 1");
    expect(r.stdout).toContain("COLLECT OK");
    expect(r.status).toBe(0);
    expect(existsSync(join(root, "out", "collect_summary.json"))).toBe(true);
  });

  it("exits 1 when gh fails", () => {
    const { root, run } = setup('#!/bin/sh\necho "API error" >&2\nexit 1\n');
    const r = run("--repo", "o/r", "--output-dir", join(root, "out"), "--workflow-id", "12345");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("API error");
  });
});
