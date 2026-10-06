import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXIT_CONFIG,
  EXIT_DEPENDENCY,
  EXIT_FAILURE,
  EXIT_INTERRUPTED,
  EXIT_OK,
  EXIT_PARTIAL,
  EXIT_USAGE,
} from "./exit-codes.ts";
import { isRepoPlugin, main, parseArgs } from "./run-evals.ts";
import {
  fakeIo,
  makePlugin,
  resultJsonFor,
  spawned,
  type FakeIoOptions,
} from "./test-support.ts";

const GRANTS = `schema_version: "1"
grants:
  a:
    - "Bash(npx *)"
  b:
    - "Bash(npx --yes x *)"
`;

const setup = (opts: FakeIoOptions & { grants?: string | undefined; cases?: { name: string; tags?: string[] }[] } = {}) => {
  const root = makePlugin(opts.cases ?? [{ name: "a" }, { name: "b" }], opts.grants);
  const results = join(root, "evals", "results");
  const fake = fakeIo({
    onPath: { claude: ["/bin/claude"], git: ["/bin/git"] },
    ...opts,
  });
  return { root, results, ...fake };
};

const caseOf = (args: readonly string[]): string =>
  args[args.indexOf("--case") + 1] ?? "";

/** A CLI stub whose result holds exactly the planned case, costing `cost`. */
const okCli =
  (cost = 0.1) =>
  (args: readonly string[]) => ({
    result: resultJsonFor([caseOf(args)], { costUsd: cost }),
  });

const STAMP = "run-2026-01-02T03-04-05-000Z";

const cliCalls = (calls: readonly { command: string; args: readonly string[] }[]) =>
  calls.filter((c) => c.command === "claude" && c.args[0] === "plugin");

describe("parseArgs", () => {
  it("answers -h and --help before validating anything else", () => {
    expect(parseArgs(["--bogus", "-h"])).toEqual({ kind: "help" });
    expect(parseArgs(["--help"])).toEqual({ kind: "help" });
  });
  it("rejects bad input", () => {
    const msg = (a: string[]) => {
      const p = parseArgs(a);
      return p.kind === "error" ? p.message : "";
    };
    expect(msg([])).toContain("missing");
    expect(msg(["p", "q"])).toContain("extra");
    expect(msg(["p", "--tier"])).toContain("needs a value");
    expect(msg(["p", "--tier", "huge"])).toContain("unknown tier");
    expect(msg(["p", "--nope"])).toContain("unknown option");
  });
  it("defaults to the standard tier", () => {
    const p = parseArgs(["p"]);
    expect(p.kind === "options" && p.options.tier.name).toBe("standard");
  });
});

describe("--max-cost-usd", () => {
  const err = (v: string[]): string => {
    const p = parseArgs(["p", ...v]);
    return p.kind === "error" ? p.message : "";
  };
  it("rejects zero, negative, NaN, empty, text, infinity and non-decimal forms", () => {
    for (const bad of ["0", "0.0", "-1", "NaN", "", "abc", "Infinity", "1e3", "0x10", "1,5"]) {
      expect(err(["--max-cost-usd", bad])).toContain("positive finite number");
    }
  });
  it("accepts positive decimals", () => {
    for (const [text, n] of [["2", 2], ["0.5", 0.5], [".5", 0.5], ["10.", 10]] as const) {
      const p = parseArgs(["p", "--max-cost-usd", text]);
      expect(p.kind === "options" && p.options.maxCostUsd).toBe(n);
    }
  });
  it("is absent by default", () => {
    const p = parseArgs(["p"]);
    expect(p.kind === "options" && p.options.maxCostUsd).toBeUndefined();
  });
  it("needs a value", () => {
    expect(err(["--max-cost-usd"])).toContain("needs a value");
  });
  it("is documented in --help with its per-invocation semantics", async () => {
    const { io, out } = setup();
    await main(["-h"], { io, pluginsDir: "/p" });
    const help = out.join("");
    expect(help).toContain("--max-cost-usd <usd>");
    expect(help).toContain("remaining budget");
    expect(help).toContain("no default ceiling");
    expect(help).not.toContain("--json-file");
    expect(help).not.toContain("--report <path>");
  });

  const costs = (calls: ReturnType<typeof cliCalls>): (string | undefined)[] =>
    calls.map((c) => c.args[c.args.indexOf("--max-cost-usd") + 1]);

  it("exits with the usage code and runs nothing on a bad value", async () => {
    const s = setup({ grants: GRANTS });
    expect(await main([s.root, "--max-cost-usd", "0"], { io: s.io, pluginsDir: "/p" })).toBe(EXIT_USAGE);
    expect(s.err.join()).toContain("positive finite number");
    expect(s.calls).toEqual([]);
  });
  it("gives the first invocation the override and later ones what is left", async () => {
    const s = setup({ grants: GRANTS, onCli: okCli(1.25) });
    await main([s.root, "--max-cost-usd", "4.5"], { io: s.io, pluginsDir: "/p" });
    expect(costs(cliCalls(s.calls))).toEqual(["4.5", "3.25"]);
  });
  it("keeps each tier's ceiling when the option is absent", async () => {
    const expected = { quick: "1", standard: "5", thorough: "15" };
    for (const [tier, cost] of Object.entries(expected)) {
      const s = setup({ grants: GRANTS, onCli: okCli(0), cases: [{ name: "a", tags: ["quick"] }, { name: "b", tags: ["quick"] }] });
      await main([s.root, "--tier", tier], { io: s.io, pluginsDir: "/p" });
      expect(costs(cliCalls(s.calls))).toEqual([cost, cost]);
    }
  });
  it("overrides the quick tier's $1 ceiling and keeps its tag and ablation", async () => {
    const s = setup({ cases: [{ name: "a", tags: ["quick"] }] });
    await main([s.root, "--tier", "quick", "--max-cost-usd", "3"], { io: s.io, pluginsDir: "/p" });
    const args = cliCalls(s.calls)[0]?.args.join(" ") ?? "";
    expect(args).toContain("--max-cost-usd 3");
    expect(args).toContain("--tag quick");
    expect(args).toContain("--ablation none");
  });
  it("shows in --dry-run output, and the tier value otherwise", async () => {
    const s = setup({ grants: GRANTS });
    await main([s.root, "--dry-run", "--max-cost-usd", "7"], { io: s.io, pluginsDir: "/p" });
    const lines = (o: string[]) => o.filter((l) => l.startsWith("invocation"));
    expect(lines(s.out).every((l) => l.includes("--max-cost-usd 7"))).toBe(true);
    const d = setup({ grants: GRANTS });
    await main([d.root, "--dry-run"], { io: d.io, pluginsDir: "/p" });
    expect(lines(d.out).every((l) => l.includes("--max-cost-usd 5"))).toBe(true);
  });
});

describe("isRepoPlugin", () => {
  it("accepts only direct children of the plugins directory", () => {
    const id = (p: string): string => p;
    expect(isRepoPlugin("/r/plugins/x", "/r/plugins", id)).toBe(true);
    expect(isRepoPlugin("/r/plugins/x/y", "/r/plugins", id)).toBe(false);
    expect(isRepoPlugin("/elsewhere/x", "/r/plugins", id)).toBe(false);
  });
});

describe("main", () => {
  it("prints help and exits 0 without touching anything", async () => {
    const { io, out, calls } = setup();
    expect(await main(["--help"], { io, pluginsDir: "/p" })).toBe(EXIT_OK);
    expect(out.join()).toContain("Usage:");
    expect(out.join()).toContain("Exit codes:");
    expect(calls).toEqual([]);
  });

  it("exits with the usage code on a bad call", async () => {
    const { io } = setup();
    expect(await main([], { io, pluginsDir: "/p" })).toBe(EXIT_USAGE);
  });

  it("runs each case under exactly its own grants", async () => {
    const s = setup({ grants: GRANTS, onCli: okCli() });
    const code = await main([s.root], { io: s.io, pluginsDir: dirname(s.root) });
    expect(code).toBe(EXIT_OK);
    const runs = cliCalls(s.calls);
    expect(runs).toHaveLength(2);
    const [first, second] = runs.map((r) => r.args.join(" "));
    expect(first).toContain("--case a");
    expect(first).toContain("--allow-tools Bash(npx *)");
    expect(first).not.toContain("--yes");
    expect(second).toContain("--case b");
    expect(second).toContain("--allow-tools Bash(npx --yes x *)");
    expect(second).not.toContain("--case a");
    expect(first).toContain("--trust-plugin");
    expect(first).not.toContain("--scaffold");
  });

  it("passes when the CLI exits 0 and the results are clean, and records the mode", async () => {
    const s = setup({
      cases: [{ name: "a", tags: ["quick"] }],
      // The CLI may write into a timestamp subdirectory of --output-dir.
      onCli: (args) => ({ ...okCli()(args), resultSubdir: "2026-01-01" }),
    });
    const code = await main([s.root, "--tier", "quick"], { io: s.io, pluginsDir: "/p" });
    expect(code).toBe(EXIT_OK);
    const written = [...s.written.entries()][0];
    expect(written?.[0]).toBe(join(s.results, STAMP, "run-evals-summary.json"));
    const summary: unknown = JSON.parse(written?.[1] ?? "{}");
    expect(summary).toMatchObject({ ablation: "none", tier: "quick", spentUsd: 0.1, unstarted: [] });
    expect(written?.[1]).toContain("ablation none: plugin arm only");
  });

  it("quick tier with no quick-tagged case fails clearly and runs nothing", async () => {
    const s = setup();
    expect(await main([s.root, "--tier", "quick"], { io: s.io, pluginsDir: "/p" })).toBe(EXIT_CONFIG);
    expect(s.calls).toEqual([]);
    expect(s.err.join()).toContain("no cases tagged 'quick'");
  });

  it("fails on a config problem before any spawn", async () => {
    const s = setup({ grants: 'schema_version: "1"\ngrants:\n  ghost:\n    - "Bash"\n' });
    expect(await main([s.root], { io: s.io, pluginsDir: "/p" })).toBe(EXIT_CONFIG);
    expect(s.calls).toEqual([]);
  });

  it("stops on a preflight error, naming it, without running the CLI", async () => {
    const s = setup({ claudeVersion: "2.1.100" });
    expect(await main([s.root], { io: s.io, pluginsDir: "/p" })).toBe(EXIT_DEPENDENCY);
    expect(s.err.join()).toContain("2.1.100");
    expect(cliCalls(s.calls)).toEqual([]);
  });

  it("warns on a shadowed claude but still runs", async () => {
    const s = setup({
      cases: [{ name: "a" }],
      onPath: { claude: ["/a/claude", "/b/claude"], git: ["/bin/git"] },
    });
    await main([s.root], { io: s.io, pluginsDir: "/p" });
    expect(s.err.join()).toContain("preflight warning");
    expect(cliCalls(s.calls)).toHaveLength(1);
  });

  it("does not pass --trust-plugin for a plugin outside the repo's plugins directory", async () => {
    const s = setup({ cases: [{ name: "a" }] });
    await main([s.root], { io: s.io, pluginsDir: "/somewhere/else" });
    expect(cliCalls(s.calls)[0]?.args).not.toContain("--trust-plugin");
  });

  it("maps CLI 2 to partial and an interrupt to 130, running no later group", async () => {
    const partial = setup({
      grants: GRANTS,
      onCli: (args) => ({ ...okCli()(args), spawn: spawned({ status: 2 }) }),
    });
    expect(await main([partial.root], { io: partial.io, pluginsDir: "/p" })).toBe(EXIT_PARTIAL);
    expect(cliCalls(partial.calls)).toHaveLength(2);

    const stopped = setup({
      grants: GRANTS,
      onCli: (args) => ({ ...okCli()(args), spawn: spawned({ status: 130 }) }),
    });
    expect(await main([stopped.root], { io: stopped.io, pluginsDir: "/p" })).toBe(EXIT_INTERRUPTED);
    expect(cliCalls(stopped.calls)).toHaveLength(1);
  });

  it("fails on CLI exit 1 and treats early access as a skip when asked", async () => {
    const failed = setup({ cases: [{ name: "a" }], cliResult: spawned({ status: 1 }) });
    expect(await main([failed.root], { io: failed.io, pluginsDir: "/p" })).toBe(EXIT_FAILURE);

    const early = spawned({ status: 1, stderr: "plugin eval is currently in early access\n" });
    const asked = setup({ cases: [{ name: "a" }], cliResult: early });
    expect(await main([asked.root, "--skip-unavailable"], { io: asked.io, pluginsDir: "/p" })).toBe(EXIT_OK);
    const not = setup({ cases: [{ name: "a" }], cliResult: early });
    expect(await main([not.root], { io: not.io, pluginsDir: "/p" })).toBe(EXIT_DEPENDENCY);
  });

  it("surfaces the CLI's preflight warning as an error", async () => {
    const s = setup({
      cases: [{ name: "a" }],
      cliResult: spawned({ status: 0, stderr: "x cannot pass with the granted tools\n" }),
    });
    expect(await main([s.root], { io: s.io, pluginsDir: "/p" })).toBe(EXIT_CONFIG);
  });

  it("reports a claude that cannot start", async () => {
    const s = setup({ cases: [{ name: "a" }], cliResult: spawned({ status: null, error: "ENOENT" }) });
    expect(await main([s.root], { io: s.io, pluginsDir: "/p" })).toBe(EXIT_DEPENDENCY);
  });

  it("tees the CLI's output to the terminal", async () => {
    const s = setup({
      cases: [{ name: "a" }],
      cliResult: spawned({ status: 1, stdout: "TABLE", stderr: "PROGRESS" }),
    });
    await main([s.root], { io: s.io, pluginsDir: "/p" });
    expect(s.out).toContain("TABLE");
    expect(s.err).toContain("PROGRESS");
  });

  it("--dry-run prints the commands and runs nothing", async () => {
    const s = setup({ grants: GRANTS });
    expect(await main([s.root, "--dry-run"], { io: s.io, pluginsDir: "/p" })).toBe(EXIT_OK);
    expect(s.calls).toEqual([]);
    expect(s.out.join("")).toContain('"Bash(npx *)"');
    expect(s.out.filter((l) => l.startsWith("invocation"))).toHaveLength(2);
  });

  it("gives each invocation its own output directory under one run directory", async () => {
    const s = setup({ grants: GRANTS, onCli: okCli() });
    await main([s.root, "--output-dir", "/out"], { io: s.io, pluginsDir: "/p" });
    const dirs = cliCalls(s.calls).map((c) => c.args[c.args.indexOf("--output-dir") + 1]);
    expect(dirs).toEqual([`/out/${STAMP}/01-a`, `/out/${STAMP}/02-b`]);
  });

  it("rejects the removed --json-file and --report options with the usage code", async () => {
    for (const flag of ["--json-file", "--report"]) {
      const s = setup();
      expect(await main([s.root, flag, "x"], { io: s.io, pluginsDir: "/p" })).toBe(EXIT_USAGE);
      expect(s.calls).toEqual([]);
    }
  });
});

describe("one invocation per case", () => {
  const names = ["c1", "c2", "c3"];
  const three = () => names.map((name) => ({ name }));
  const run = (s: ReturnType<typeof setup>, extra: string[] = []) =>
    main([s.root, ...extra], { io: s.io, pluginsDir: "/p" });

  it("runs a group of several cases as one invocation each, each with exactly one --case", async () => {
    const s = setup({ cases: three(), onCli: okCli() });
    expect(await run(s)).toBe(EXIT_OK);
    const runs = cliCalls(s.calls);
    expect(runs.map((r) => r.args.filter((a) => a === "--case").length)).toEqual([1, 1, 1]);
    expect(runs.map((r) => caseOf(r.args))).toEqual(names);
  });

  it("exits 7 and names the skipped cases when a result holds fewer cases than planned", async () => {
    // The stub mimics the CLI keeping only the last case it was asked for.
    const s = setup({
      cases: three(),
      onCli: () => ({ result: resultJsonFor(["c3"]) }),
    });
    expect(await run(s)).toBe(EXIT_PARTIAL);
    const err = s.err.join("");
    expect(err).toContain("skipped case: 'c1' did not run");
    expect(err).toContain("skipped case: 'c2' did not run");
    expect(err).not.toContain("skipped case: 'c3'");
  });

  it("exits 7 when a result holds no cases at all", async () => {
    const s = setup({
      cases: [{ name: "c1" }],
      onCli: () => ({ result: resultJsonFor([]) }),
    });
    expect(await run(s)).toBe(EXIT_PARTIAL);
    expect(s.err.join("")).toContain("skipped case: 'c1' did not run (result has no cases)");
  });

  it("exits 7 on a CLI exit 0 whose result names a different case, and on extra cases", async () => {
    const other = setup({
      cases: [{ name: "c1" }],
      onCli: () => ({ result: resultJsonFor(["zzz"]) }),
    });
    expect(await run(other)).toBe(EXIT_PARTIAL);
    expect(other.err.join("")).toContain("'c1' did not run (result has zzz)");
    const extra = setup({
      cases: [{ name: "c1" }],
      onCli: () => ({ result: resultJsonFor(["c1", "c2"]) }),
    });
    expect(await run(extra)).toBe(EXIT_PARTIAL);
    expect(extra.err.join("")).toContain("unplanned case(s) ran: c2");
  });

  it("exits 7 on a CLI exit 0 with an unreadable result", async () => {
    const missing = setup({ cases: [{ name: "c1" }] });
    expect(await run(missing)).toBe(EXIT_PARTIAL);
    const garbled = setup({ cases: [{ name: "c1" }], onCli: () => ({ result: "{not json" }) });
    expect(await run(garbled)).toBe(EXIT_PARTIAL);
  });

  it("leaves a below-threshold CLI exit 1 as exit 1", async () => {
    const s = setup({
      cases: [{ name: "c1" }],
      onCli: (args) => ({ ...okCli()(args), spawn: spawned({ status: 1 }) }),
    });
    expect(await run(s)).toBe(EXIT_FAILURE);
  });

  describe("cumulative cost ceiling", () => {
    const budgets = (s: ReturnType<typeof setup>) =>
      cliCalls(s.calls).map((c) => c.args[c.args.indexOf("--max-cost-usd") + 1]);

    it("passes each invocation the budget left after earlier results, rounded to 4 decimals", async () => {
      const costs = [0.33333, 0.2, 0.1];
      const s = setup({
        cases: three(),
        onCli: (args, n) => ({ result: resultJsonFor([caseOf(args)], { costUsd: costs[n - 1] }) }),
      });
      await run(s, ["--max-cost-usd", "1"]);
      expect(budgets(s)).toEqual(["1", "0.6667", "0.4667"]);
    });

    it("stops launching once nothing is left, lists the unstarted cases, and exits 7", async () => {
      const s = setup({ cases: three(), onCli: okCli(0.6) });
      expect(await run(s, ["--max-cost-usd", "1"])).toBe(EXIT_PARTIAL);
      expect(budgets(s)).toEqual(["1", "0.4"]);
      expect(cliCalls(s.calls)).toHaveLength(2);
      expect(s.err.join("")).toContain("not run: c3");
      const summary: unknown = JSON.parse([...s.written.values()][0] ?? "{}");
      expect(summary).toMatchObject({ unstarted: ["c3"], ceilingUsd: 1, spentUsd: 1.2 });
    });

    it("charges the full allotment when costUsd is missing or the result unreadable", async () => {
      const noCost = setup({
        cases: three(),
        onCli: (args) => ({ result: resultJsonFor([caseOf(args)], { costUsd: undefined }) }),
      });
      expect(await run(noCost, ["--max-cost-usd", "2"])).toBe(EXIT_PARTIAL);
      expect(cliCalls(noCost.calls)).toHaveLength(1);
      expect(noCost.err.join("")).toContain("no readable costUsd");
      const none = setup({ cases: three() });
      await run(none);
      expect(cliCalls(none.calls)).toHaveLength(1);
    });

    it("uses the tier's ceiling when there is no override", async () => {
      const s = setup({ cases: three(), onCli: okCli(0) });
      await run(s);
      expect(budgets(s)).toEqual(["5", "5", "5"]);
    });
  });

  it("stops later invocations on an interrupt", async () => {
    for (const status of [130, 143]) {
      const s = setup({
        cases: three(),
        onCli: (args) => ({ ...okCli()(args), spawn: spawned({ status }) }),
      });
      expect(await run(s)).toBe(status);
      expect(cliCalls(s.calls)).toHaveLength(1);
    }
  });

  it("--dry-run prints one numbered line per case and a budget note", async () => {
    const s = setup({ cases: three() });
    expect(await run(s, ["--dry-run"])).toBe(EXIT_OK);
    const lines = s.out.filter((l) => l.startsWith("invocation"));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^invocation 1\/3: claude plugin eval .* --case c1 /);
    expect(lines[2]).toMatch(/^invocation 3\/3: .* --case c3 /);
    expect(s.out.join("")).toContain("only the budget left");
    expect(s.calls).toEqual([]);
  });
});
