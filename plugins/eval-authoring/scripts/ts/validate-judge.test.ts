import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main, parseLabels, probeFiles, realIo, type Io } from "./validate-judge.ts";

const LABELS = JSON.stringify([
  { label: "PASS", reply: "good one", split: "dev" },
  { label: "FAIL", reply: "bad one", split: "dev" },
  { label: "FAIL", reply: "bad two", split: "test" },
]);

/** In-memory Io: writes are captured, the case loads from the arguments. */
const memory = (labels: string | undefined = LABELS, good: string | null = "hdr good") => {
  const written = new Map<string, string>();
  const io: Io = {
    readFile: (p) => (p === "labels.json" ? labels : undefined),
    writeFile: (p, t) => void written.set(p, t),
    load: (_plugin, c, g) =>
      c === "alpha" && g === "judge"
        ? { criteria: "PASS: a.\nFAIL: b.\n", good: good ?? undefined, bad: "hdr bad" }
        : `no case named ${c} under p`,
  };
  return { io, written };
};

const ARGS = ["--plugin", "p", "--case", "alpha", "--grader", "judge", "--out", "/o"];

describe("validate-judge", () => {
  it("writes one stub case per label, with the criteria verbatim and a labels file for judge-agreement", () => {
    const { io, written } = memory();
    const o = main([...ARGS, "--labels", "labels.json"], io);
    expect(o.code).toBe(0);
    expect(written.get("/o/evals/judge-02/reply.txt")).toBe("bad one");
    const yaml = written.get("/o/evals/judge-01/case.yaml") ?? "";
    expect(yaml).toContain("    focus:\n      source: file\n      path: reply.txt");
    expect(yaml).toContain("    criteria: |\n      PASS: a.\n      FAIL: b.\n");
    expect(JSON.parse(written.get("/o/labels.json") ?? "[]")).toEqual([
      { case: "judge-01", grader: "judge", arm: "with", run: 1, label: "PASS" },
      { case: "judge-02", grader: "judge", arm: "with", run: 1, label: "FAIL" },
      { case: "judge-03", grader: "judge", arm: "with", run: 1, label: "FAIL" },
    ]);
    expect(o.stdout).toContain("--scaffold");
    expect(o.stdout).toContain("--threshold 0");
    expect(o.stdout).toContain("judge-agreement.ts --labels /o/labels.json /o/results");
  });

  it("copies the reply from a data file, so reply text cannot run as shell", () => {
    const evil = "x'; rm -rf / #\n__EOF__";
    const files = probeFiles("/o", "judge", "c", [
      { label: "PASS", reply: evil },
      { label: "FAIL", reply: "b" },
    ]);
    expect(files.get("evals/judge-01/reply.txt")).toBe(evil);
    expect(files.get("evals/judge-01/fixture.sh")).toBe("#!/bin/bash\ncp '/o/evals/judge-01/reply.txt' reply.txt\n");
    expect(files.get("evals/judge-01/case.yaml")).not.toContain("rm -rf");
    // A path with a quote in it stays one shell word.
    expect(probeFiles("/it's", "j", "c", [{ label: "PASS", reply: "a" }]).get("evals/judge-01/fixture.sh")).toContain(
      "cp '/it'\\''s/evals/judge-01/reply.txt' reply.txt",
    );
  });

  it("uses the case's good-reply and bad-reply header when there is no labels file", () => {
    const { io, written } = memory();
    expect(main(ARGS, io).code).toBe(0);
    expect(written.get("/o/evals/judge-01/reply.txt")).toBe("hdr good");
    expect(written.get("/o/evals/judge-02/reply.txt")).toBe("hdr bad");
    expect(main(ARGS, memory(undefined, null).io).stderr).toContain("lacks # good-reply: or # bad-reply:");
  });

  it("keeps only one split, and refuses a label set that cannot give both rates", () => {
    const { io, written } = memory();
    expect(main([...ARGS, "--labels", "labels.json", "--split", "dev"], io).code).toBe(0);
    expect([...written.keys()].filter((k) => k.endsWith("reply.txt"))).toHaveLength(2);
    const o = main([...ARGS, "--labels", "labels.json", "--split", "test"], memory().io);
    expect(o.code).toBe(1);
    expect(o.stderr).toContain("need at least one PASS and one FAIL label in split test; have 0 PASS of 1");
  });

  it("rejects bad labels, an unknown case and missing flags", () => {
    expect(parseLabels("nope")).toBe("labels must be a JSON array");
    expect(parseLabels('[{"label":"MAYBE","reply":"x"}]')).toContain("label 1 needs");
    expect(parseLabels('[{"label":"PASS","reply":""}]')).toContain("label 1 needs");
    expect(parseLabels('[{"label":"PASS","reply":"x","split":"val"}]')).toContain("label 1 needs");
    expect(main([...ARGS.slice(0, 2), "--case", "zzz", "--grader", "judge", "--out", "/o"], memory().io).code).toBe(1);
    expect(main(["--plugin", "p"], memory().io).code).toBe(2);
    expect(main(["--help"], memory().io).stdout).toContain("Usage: validate-judge.ts");
  });

  describe("against a real case file", () => {
    const dirs: string[] = [];
    afterEach(() => {
      for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    });

    it("reads the llm criteria and header replies from case.yaml and writes the probe to disk", () => {
      const root = mkdtempSync(join(tmpdir(), "validate-judge-"));
      dirs.push(root);
      mkdirSync(join(root, ".claude-plugin"));
      writeFileSync(join(root, ".claude-plugin", "plugin.json"), '{"name":"t","version":"0.0.1"}');
      mkdirSync(join(root, "evals", "alpha"), { recursive: true });
      writeFileSync(
        join(root, "evals", "alpha", "case.yaml"),
        [
          "# good-reply: Fine.",
          "# bad-reply: Broken.",
          'schema_version: "1.1"',
          "name: alpha",
          "execution:",
          "  prompt: hi",
          "graders:",
          "  - name: judge",
          "    type: llm",
          "    criteria: |",
          "      PASS: says fine.",
          "      FAIL: says broken.",
          "",
        ].join("\n"),
      );
      const out = join(root, "probe");
      const o = main(["--plugin", root, "--case", "alpha", "--grader", "judge", "--out", out], realIo);
      expect(o.stderr).toBe("");
      expect(o.code).toBe(0);
      expect(readFileSync(join(out, "evals", "judge-01", "reply.txt"), "utf8")).toBe("Fine.");
      expect(readFileSync(join(out, "evals", "judge-02", "reply.txt"), "utf8")).toBe("Broken.");
      expect(readFileSync(join(out, "evals", "judge-01", "case.yaml"), "utf8")).toContain(
        "      PASS: says fine.\n      FAIL: says broken.\n",
      );
      expect(main(["--plugin", root, "--case", "alpha", "--grader", "nope", "--out", out], realIo).stderr).toContain(
        "no llm grader named nope",
      );
    });
  });
});
