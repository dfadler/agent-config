import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT_CONFIG, EXIT_OK, EXIT_USAGE } from "./exit-codes.ts";
import { main, parseArgs } from "./run-evals.ts";
import { fakeIo, makePlugin, resultJsonFor, type FakeIoOptions } from "./test-support.ts";

const caseOf = (args: readonly string[]): string => args[args.indexOf("--case") + 1] ?? "";
const cliCalls = (calls: readonly { command: string; args: readonly string[] }[]) =>
  calls.filter((c) => c.command === "claude" && c.args[0] === "plugin");

const CASES = [
  { name: "t1", tags: ["trigger"] },
  { name: "t2", tags: ["trigger"] },
  { name: "plain" },
];
const TEMP = "/tmp/run-evals-neighbours-X1";

/** A plugin under a plugins dir that also holds the neighbour `sib`; the fake fs serves each case.yaml. */
const staged = (over: FakeIoOptions = {}, cases = CASES, unreadable?: string) => {
  const root = makePlugin(cases);
  const pluginsDir = dirname(root);
  const files: Record<string, string> = {
    [join(pluginsDir, "sib", ".claude-plugin", "plugin.json")]: '{"name":"sib"}',
    ...Object.fromEntries(
      cases.filter((c) => c.name !== unreadable).map((c) => {
        const p = join(root, "evals", c.name, "case.yaml");
        return [p, readFileSync(p, "utf8")] as const;
      }),
    ),
  };
  const fake = fakeIo({
    onCli: (args) => ({ result: resultJsonFor([caseOf(args)], { costUsd: 0.1 }) }),
    ...over,
    files: { ...files, ...over.files },
  });
  const stagedRoot = join(TEMP, root.split("/").pop() ?? "");
  const go = (extra: string[] = [], dir = pluginsDir) =>
    main([root, "--neighbours", "sib", ...extra], { io: fake.io, pluginsDir: dir });
  return { root, pluginsDir, stagedRoot, go, ...fake };
};

describe("--neighbours (trigger-set mode)", () => {
  it("parses a name list and refuses a bad one", () => {
    expect(parseArgs(["p", "--neighbours", "a,b"])).toMatchObject({
      kind: "options",
      options: { neighbours: ["a", "b"] },
    });
    expect(parseArgs(["p"])).toMatchObject({ options: { neighbours: undefined } });
    expect(parseArgs(["p", "--neighbours", "a,,b"])).toMatchObject({ kind: "error" });
    expect(parseArgs(["p", "--neighbours"])).toMatchObject({ kind: "error" });
  });

  it("runs only the trigger cases against a staged, trusted copy that loads the neighbour, and says so", async () => {
    const s = staged();
    expect(await s.go()).toBe(EXIT_OK);
    const calls = cliCalls(s.calls);
    expect(calls.map((c) => caseOf(c.args))).toEqual(["t1", "t2"]);
    expect(calls.every((c) => c.args[2] === s.stagedRoot)).toBe(true);
    expect(calls.every((c) => c.args.includes("--trust-plugin"))).toBe(true);
    expect(s.copies.map((c) => [c.src, c.dest])).toEqual([
      [s.root, s.stagedRoot],
      [join(s.pluginsDir, "sib"), join(s.stagedRoot, "neighbours", "sib")],
    ]);
    const t1 = s.written.get(join(s.stagedRoot, "evals", "t1", "case.yaml")) ?? "";
    expect(t1).toContain('plugins: ["../..","../../neighbours/sib"]');
    expect(s.written.has(join(s.stagedRoot, "evals", "plain", "case.yaml"))).toBe(false);
    expect(s.removed).toEqual([TEMP]);
    const out = s.out.join("");
    expect(out).toContain("### Trigger set");
    expect(out).toContain("`sib`");
  });

  it("keeps the staged copy with --keep-temp", async () => {
    const s = staged();
    await s.go(["--keep-temp"]);
    expect(s.removed).toEqual([]);
    expect(s.err.join("")).toContain("kept the staged copy at");
  });

  it("--dry-run stages nothing and describes the copy", async () => {
    const s = staged();
    expect(await s.go(["--dry-run"])).toBe(EXIT_OK);
    expect(s.copies).toEqual([]);
    expect(s.out.filter((l) => l.startsWith("invocation"))).toHaveLength(2);
    expect(s.out.join("")).toContain("--neighbours sib: a real run runs these cases against a temp copy");
  });

  it("refuses a neighbour that is not a plugin, or a plugin outside plugins/, before any run", async () => {
    const s = staged({ files: { "/elsewhere/sib/.claude-plugin/plugin.json": "{}" } });
    expect(await main([s.root, "--neighbours", "nope"], { io: s.io, pluginsDir: s.pluginsDir })).toBe(EXIT_USAGE);
    expect(s.err.join("")).toContain("'nope' is not a plugin");
    expect(await s.go([], "/elsewhere")).toBe(EXIT_USAGE);
    expect(s.err.join("")).toContain("only this repo's plugins can be staged and trusted");
    expect(cliCalls(s.calls)).toHaveLength(0);
    expect(s.copies).toEqual([]);
  });

  it("exits 3 when the suite has no trigger case", async () => {
    const s = staged({}, [{ name: "plain" }]);
    expect(await s.go()).toBe(EXIT_CONFIG);
    expect(cliCalls(s.calls)).toHaveLength(0);
  });

  it("exits 3, runs nothing and removes the copy when a trigger case cannot be staged", async () => {
    const s = staged({}, CASES, "t2");
    expect(await s.go()).toBe(EXIT_CONFIG);
    expect(s.err.join("")).toContain("case 't2' has no readable case.yaml");
    expect(cliCalls(s.calls)).toHaveLength(0);
    expect(s.removed).toEqual([TEMP]);
  });
});
