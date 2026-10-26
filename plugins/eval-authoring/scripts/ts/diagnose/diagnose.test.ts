import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE, main, USAGE } from "./diagnose.ts";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const io = (files: Readonly<Record<string, string>>) => ({
  readFile: (p: string): string | undefined => files[p],
});


describe("main", () => {
  it("prints usage for -h and --help, before any other validation", () => {
    for (const flag of ["-h", "--help"]) {
      expect(main([flag, "--format", "xml"], io({}))).toEqual({
        code: EXIT_OK,
        stdout: USAGE,
        stderr: "",
      });
    }
  });

  it("prints text verdicts for a recorded one-run result", () => {
    const out = main(["r.json"], io({ "r.json": fixture("two-cases-one-run.json") }));
    expect(out.code).toBe(EXIT_OK);
    expect(out.stdout).toContain("example-asks-first: discriminates");
    expect(out.stdout).toContain(
      "example-runs-with-permission: no-discrimination",
    );
  });

  // Trimmed copy of a real `claude plugin eval` llm-graded result. Real, but
  // every judge sample is unanimous (PASS PASS PASS / FAIL FAIL FAIL): no real split.
  it("reads a real llm-graded result: judgeVotes parsed, no split finding", () => {
    const raw = fixture("real-llm-graded-result.json");
    const out = main(["--format", "json", "r.json"], io({ "r.json": raw }));
    expect(out.code).toBe(EXIT_OK);
    const d: unknown = JSON.parse(out.stdout);
    expect(d).toMatchObject({
      cases: [{ verdict: "discriminates", delta: 0.667 }],
    });
    expect(out.stdout).not.toContain("split-judge-votes");
    expect(raw).toContain('"judgeVotes": [');
  });

  it("prints JSON verdicts for a recorded three-run result", () => {
    const out = main(
      ["--format", "json", "r.json"],
      io({ "r.json": fixture("two-cases-three-runs.json") }),
    );
    expect(out.code).toBe(EXIT_OK);
    const d: unknown = JSON.parse(out.stdout);
    expect(d).toMatchObject({
      partial: false,
      cases: [
        {
          name: "example-asks-first",
          verdict: "discriminates",
          delta: 0.25,
          findings: [{ kind: "split-judge-votes" }],
        },
        {
          name: "example-runs-with-permission",
          verdict: "no-discrimination",
        },
      ],
    });
  });

  it("handles a partial document and a one-arm case", () => {
    const doc = JSON.stringify({
      schemaVersion: 1,
      partial: true,
      partialReason: "cost ceiling",
      cases: [
        { name: "one-arm", arms: { with: [{ score: 1 }] }, aggregates: {} },
      ],
    });
    const out = main(["r.json"], io({ "r.json": doc }));
    expect(out.code).toBe(EXIT_OK);
    expect(out.stdout).toContain("PARTIAL result: cost ceiling");
    expect(out.stdout).toContain("one-arm: no-delta-signal");
    expect(out.stdout).toContain("delta: no delta signal");
  });

  it("exits 1 on an unsupported or unparsable result", () => {
    const out = main(["r.json"], io({ "r.json": "{}" }));
    expect(out.code).toBe(EXIT_FAILURE);
    expect(out.stderr).toContain("r.json: unsupported schemaVersion");
  });

  it.each([
    ["no path", []],
    ["two paths", ["a.json", "b.json"]],
    ["a bad format", ["--format", "xml", "a.json"]],
    ["a missing format value", ["a.json", "--format"]],
    ["an unknown flag", ["--nope"]],
    ["a missing file", ["missing.json"]],
  ])("exits 2 for %s", (_label, argv) => {
    const out = main(argv, io({ "a.json": "{}" }));
    expect(out.code).toBe(EXIT_USAGE);
    expect(out.stdout).toBe("");
    expect(out.stderr).toContain("Usage:");
  });
});
