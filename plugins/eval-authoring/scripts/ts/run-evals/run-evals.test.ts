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
  resultJson,
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

  it("runs one run per grant group, each with exactly its own grants", async () => {
    const s = setup({ grants: GRANTS, cliResult: spawned({ status: 0 }) });
    const code = await main([s.root], { io: s.io, pluginsDir: dirname(s.root) });
    expect(code).toBe(EXIT_FAILURE); // exit 0 but no result file to trust
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
    const s = setup({ cases: [{ name: "a", tags: ["quick"] }] });
    const dir = join(s.results, "2026-01-01");
    const io2 = fakeIo({
      dirs: { [s.results]: [] },
      files: { [join(dir, "aggregate-result.json")]: resultJson() },
    });
    // The run "creates" the timestamp directory: list it only after the spawn.
    let spawnedYet = false;
    const io = {
      ...io2.io,
      spawn: async (...a: Parameters<typeof io2.io.spawn>) => {
        const r = await io2.io.spawn(...a);
        if (a[0] === "claude" && a[1][0] === "plugin") spawnedYet = true;
        return r;
      },
      listDir: (p: string) => (spawnedYet && p === s.results ? ["2026-01-01"] : []),
      cwd: "/",
    };
    const code = await main([s.root, "--tier", "quick"], { io, pluginsDir: "/p" });
    expect(code).toBe(EXIT_OK);
    const written = [...io2.written.entries()][0];
    expect(written?.[0]).toBe(join(s.results, "run-evals-summary.json"));
    const summary: unknown = JSON.parse(written?.[1] ?? "{}");
    expect(summary).toMatchObject({ ablation: "none", tier: "quick" });
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
    const partial = setup({ grants: GRANTS, cliResult: spawned({ status: 2 }) });
    expect(await main([partial.root], { io: partial.io, pluginsDir: "/p" })).toBe(EXIT_PARTIAL);
    expect(cliCalls(partial.calls)).toHaveLength(2);

    const stopped = setup({ grants: GRANTS, cliResult: spawned({ status: 130 }) });
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
    expect(s.out).toHaveLength(2);
  });

  it("gives each group its own output directory when --output-dir is set", async () => {
    const s = setup({ grants: GRANTS });
    const s2 = s;
    await main([s2.root, "--output-dir", "/out"], { io: s2.io, pluginsDir: "/p" });
    const dirs = cliCalls(s2.calls).map((c) => c.args[c.args.indexOf("--output-dir") + 1]);
    expect(dirs).toEqual(["/out/group-1", "/out/group-2"]);
  });
});
