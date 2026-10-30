import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { main, type Io } from "./save-baseline.ts";

const fixture = (rel: string): string =>
  readFileSync(new URL(`./fixtures/baseline-run/${rel}`, import.meta.url), "utf8");

/** In-memory Io seeded with the fixture run directory under `run/`. */
const memory = (extra: Record<string, string> = {}) => {
  const files = new Map<string, string>([
    ["run/01-alpha/aggregate-result.json", fixture("01-alpha/aggregate-result.json")],
    ["run/02-beta/aggregate-result.json", fixture("02-beta/aggregate-result.json")],
    ["run/run-evals-summary.json", fixture("run-evals-summary.json")],
    ...Object.entries(extra),
  ]);
  const io: Io = {
    readFile: (p) => files.get(p),
    findResults: (p) =>
      files.has(p) ? [p] : [...files.keys()].filter((k) => k.startsWith(`${p}/`) && k.endsWith("aggregate-result.json")).sort(),
    exists: (p) => files.has(p),
    writeFile: (p, t) => void files.set(p, t),
    now: () => new Date("2030-01-01T00:00:00Z"),
  };
  return { io, files };
};

describe("save-baseline", () => {
  it("merges a run directory into one compact per-plugin baseline", () => {
    const { io, files } = memory();
    const out = main(["run"], io);
    expect(out.code).toBe(0);
    expect(JSON.parse(files.get("docs/eval-baselines/demo-plugin.json") ?? "null")).toEqual({
      plugin: "demo-plugin",
      date: "2026-10-30",
      pluginVersion: "1.2.3",
      tier: "standard",
      model: "claude-sonnet-5-5",
      judgeModel: "claude-sonnet-5-5",
      // Means of diagnose()'s per-case values, which it rounds to three places.
      meanWithScore: 0.9165,
      meanWithoutScore: 0.25,
      meanDelta: 0.6665,
      passK: 0.5,
      cases: [
        { name: "alpha", with: 1, without: 0, delta: 1 },
        { name: "beta", with: 0.833, without: 0.5, delta: 0.333 },
      ],
    });
  });

  it("without a wrapper summary, needs --plugin when several plugins are loaded; --tier and --out apply", () => {
    const { io, files } = memory();
    files.delete("run/run-evals-summary.json");
    const file = "run/01-alpha/aggregate-result.json";
    const ambiguous = main(["--tier", "quick", "--out", "x/b.json", file], io);
    expect(ambiguous.code).toBe(1);
    expect(ambiguous.stderr).toContain("--plugin");
    expect(main(["--plugin", "demo-plugin", "--tier", "quick", "--out", "x/b.json", file], io).code).toBe(0);
    expect(JSON.parse(files.get("x/b.json") ?? "null")).toMatchObject({ plugin: "demo-plugin", tier: "quick" });
  });

  it("refuses to overwrite unless --force", () => {
    const { io, files } = memory({ "docs/eval-baselines/demo-plugin.json": "old" });
    const refused = main(["run"], io);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("--force");
    expect(files.get("docs/eval-baselines/demo-plugin.json")).toBe("old");
    expect(main(["--force", "run"], io).code).toBe(0);
    expect(files.get("docs/eval-baselines/demo-plugin.json")).not.toBe("old");
  });

  it("refuses a partial run and writes nothing", () => {
    const partial = fixture("01-alpha/aggregate-result.json").replace('"partial": false', '"partial": true');
    const { io, files } = memory({ "run/01-alpha/aggregate-result.json": partial });
    const out = main(["run"], io);
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("partial: true");
    expect(files.has("docs/eval-baselines/demo-plugin.json")).toBe(false);
  });

  it("refuses a run with an errored arm", () => {
    const errored = fixture("01-alpha/aggregate-result.json").replace('"error": null', '"error": "usage limit"');
    const { io } = memory({ "run/01-alpha/aggregate-result.json": errored });
    expect(main(["run"], io).stderr).toContain("errored runs in alpha");
  });

  it("refuses results from different plugin versions", () => {
    const other = fixture("02-beta/aggregate-result.json").replaceAll("1.2.3", "2.0.0");
    const { io } = memory({ "run/02-beta/aggregate-result.json": other });
    expect(main(["run"], io).stderr).toContain("disagree");
  });

  it("refuses an unsafe plugin name instead of writing outside the baselines directory", () => {
    const evil = fixture("01-alpha/aggregate-result.json").replaceAll("demo-plugin", "../evil");
    const { io, files } = memory();
    files.delete("run/02-beta/aggregate-result.json");
    files.set("run/01-alpha/aggregate-result.json", evil);
    files.set("run/run-evals-summary.json", '{"tier":"standard","plugin":"../evil"}');
    const out = main(["run"], io);
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("not a safe file name");
  });

  it("has --help, a usage error for no path, and an error for a missing path", () => {
    const { io } = memory();
    const help = main(["--help"], io);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Usage: save-baseline.ts");
    expect(main([], io).code).toBe(2);
    expect(main(["--bogus", "run"], io).code).toBe(2);
    expect(main(["nowhere"], io).code).toBe(1);
  });
});
