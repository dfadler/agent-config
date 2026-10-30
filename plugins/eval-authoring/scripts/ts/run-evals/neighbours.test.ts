import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT_CONFIG, EXIT_OK, EXIT_USAGE } from "./exit-codes.ts";
import { main, parseArgs } from "./run-evals.ts";
import { fakeIo, makePlugin, resultJsonFor, spawned, type FakeIoOptions } from "./test-support.ts";

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

  it("exits 3 before any copy, also under --dry-run, when a trigger case cannot be staged", async () => {
    for (const extra of [[], ["--dry-run"]]) {
      const s = staged({}, CASES, "t2");
      expect(await s.go(extra)).toBe(EXIT_CONFIG);
      expect(s.err.join("")).toContain("case 't2' has no readable case.yaml");
      expect(cliCalls(s.calls)).toHaveLength(0);
      expect(s.copies).toEqual([]);
      expect(s.removed).toEqual([]);
    }
  });

  it("refuses a case with its own plugins: list under --dry-run too, naming it", async () => {
    const s = staged();
    // The suite is parsed from the real files, so the case's own plugins: line goes there.
    const own = join(s.root, "evals", "t1", "case.yaml");
    writeFileSync(own, `${readFileSync(own, "utf8")}plugins: ["../.."]\n`);
    expect(await s.go(["--dry-run"])).toBe(EXIT_CONFIG);
    expect(s.err.join("")).toContain("case 't1' already has its own plugins: list");
    expect(s.copies).toEqual([]);
  });

  it("refuses a neighbour that is a symlink out of plugins/", async () => {
    const s = staged();
    const linked = { ...s.io, realpath: (p: string) => (p.endsWith("/sib") ? "/elsewhere/sib" : p) };
    expect(await main([s.root, "--neighbours", "sib"], { io: linked, pluginsDir: s.pluginsDir })).toBe(EXIT_USAGE);
    expect(s.err.join("")).toContain("no symlink out");
    expect(s.copies).toEqual([]);
  });

  it("removes the staged copy when a run throws, and unregisters the interrupt handler", async () => {
    const s = staged({
      onCli: () => {
        throw new Error("boom");
      },
    });
    await expect(s.go()).rejects.toThrow("boom");
    expect(s.removed).toEqual([TEMP]);
    expect(s.interrupts).toEqual([]);
  });

  it("removes the staged copy on Ctrl-C", async () => {
    const holder: { fake?: ReturnType<typeof staged>; registered: number; removedAtInterrupt: readonly string[] } = {
      registered: 0,
      removedAtInterrupt: [],
    };
    const s = staged({
      onCli: (args) => {
        const fake = holder.fake;
        // Only the first invocation: a real signal ends the process, so it cannot fire twice.
        if (holder.registered > 0) return { result: resultJsonFor([caseOf(args)], { costUsd: 0.1 }) };
        holder.registered = fake?.interrupts.length ?? 0;
        fake?.interrupts.forEach((f) => {
          f();
        });
        holder.removedAtInterrupt = [...(fake?.removed ?? [])];
        return { result: resultJsonFor([caseOf(args)], { costUsd: 0.1 }) };
      },
    });
    holder.fake = s;
    await s.go();
    // The signal handler was registered during the run and removed the copy before the run ended.
    expect(holder.registered).toBe(1);
    expect(holder.removedAtInterrupt).toEqual([TEMP]);
    expect(s.interrupts).toEqual([]);
  });

  it("removes the temp dir and rethrows when copying throws midway", async () => {
    const s = staged();
    const broken = {
      ...s.io,
      copyDir: () => {
        throw new Error("disk full");
      },
    };
    await expect(main([s.root, "--neighbours", "sib"], { io: broken, pluginsDir: s.pluginsDir })).rejects.toThrow("disk full");
    expect(s.removed).toEqual([TEMP]);
  });

  it("forces --ablation none whatever the tier, and the summary has no without or delta column", async () => {
    for (const tier of ["quick", "standard", "thorough"]) {
      const s = staged({}, [
        { name: "t1", tags: ["trigger", "quick"] },
        { name: "plain" },
      ]);
      expect(await s.go(["--tier", tier])).toBe(EXIT_OK);
      const args = cliCalls(s.calls)[0]?.args ?? [];
      expect(args.slice(args.indexOf("--ablation"), args.indexOf("--ablation") + 2)).toEqual(["--ablation", "none"]);
      expect(s.out.join("")).toContain("| case | score | exit |");
      expect(s.out.join("")).not.toContain("| without |");
      expect(JSON.parse([...s.written.values()].find((t) => t.includes("scoringNote")) ?? "{}")).toMatchObject({ ablation: "none" });
    }
  });

  describe("with --changed", () => {
    const gitOf = (paths: readonly string[]) => (args: readonly string[]) =>
      args.includes("merge-base")
        ? spawned({ stdout: "abc\n" })
        : args.includes("diff")
          ? spawned({ stdout: paths.map((p) => `${p}\0`).join("") })
          : args.includes("--version")
            ? spawned({ stdout: "git version 2.39.3\n" })
            : spawned();

    it("exits 0 with a message when no changed case is a trigger case", async () => {
      const s = staged({ onGit: gitOf(["evals/plain/case.yaml"]) });
      expect(await s.go(["--changed=base"])).toBe(EXIT_OK);
      expect(cliCalls(s.calls)).toHaveLength(0);
      expect(s.copies).toEqual([]);
      expect(s.out.join("")).toContain("no trigger case among the changed cases (plain)");
    });

    it("runs just the changed trigger case", async () => {
      const s = staged({ onGit: gitOf(["evals/t2/case.yaml", "evals/plain/case.yaml"]) });
      expect(await s.go(["--changed=base", "--changed-allow-empty"])).toBe(EXIT_OK);
      expect(cliCalls(s.calls).map((c) => caseOf(c.args))).toEqual(["t2"]);
    });

    it("still exits 3 when the suite has no trigger case at all", async () => {
      const s = staged({ onGit: gitOf(["evals/plain/case.yaml"]) }, [{ name: "plain" }]);
      expect(await s.go(["--changed=base"])).toBe(EXIT_CONFIG);
    });
  });

  it("names the right pick source when --case matches nothing", async () => {
    const s = staged();
    expect(await s.go(["--case", "nomatch"])).toBe(EXIT_CONFIG);
    expect(s.err.join("")).toContain("matching --case 'nomatch' among the trigger cases (t1, t2)");
    expect(s.err.join("")).not.toContain("--changed");
  });
});
