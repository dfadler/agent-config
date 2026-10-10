import { describe, expect, it } from "vitest";
import { EXIT_OK, EXIT_PARTIAL, EXIT_USAGE } from "./exit-codes.ts";
import { main, parseArgs } from "./run-evals.ts";
import { caseMatcher } from "./plan.ts";
import { fakeIo, makePlugin, spawned, type FakeIoOptions } from "./test-support.ts";
import {
  BLOCK_END,
  BLOCK_START,
  caseRow,
  quoteSafe,
  redact,
  renderBlock,
  withBlock,
} from "./summary.ts";

const FAKE_TOKEN = `ghp_${"a1B2c3D4e5".repeat(3)}`;

/** A recorded two-arm result: one with-arm run whose grader `g` failed, replying with a token. */
const failing = (name: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    schemaVersion: 1,
    partial: false,
    costUsd: 0.25,
    cases: [
      {
        name,
        aggregates: { score: 0.5, scoreWithout: 0.25, delta: 0.25 },
        arms: {
          with: [
            {
              score: 0.5,
              error: null,
              lastMessage: `here it is: token=${FAKE_TOKEN} and more ${"x ".repeat(400)}`,
              graders: [
                { name: "g", passed: false, explanation: "reply lacked 'hi'" },
                { name: "ok", passed: true },
              ],
              ...extra,
            },
          ],
          without: [{ score: 0.25, error: null }],
        },
      },
    ],
  });

const caseOf = (args: readonly string[]): string =>
  args[args.indexOf("--case") + 1] ?? "";

const setup = (opts: FakeIoOptions = {}) => {
  const root = makePlugin([{ name: "alpha" }, { name: "beta" }, { name: "alpine" }]);
  return { root, ...fakeIo({ onCli: (args) => ({ result: failing(caseOf(args)) }), ...opts }) };
};

const deps = (s: { io: ReturnType<typeof fakeIo>["io"] }) => ({ io: s.io, pluginsDir: "/p" });
const ghCalls = (calls: readonly { command: string; args: readonly string[] }[]) =>
  calls.filter((c) => c.command === "gh");

describe("redact and quoteSafe", () => {
  it("redacts token-like strings and keeps the key name", () => {
    expect(redact(`token=${FAKE_TOKEN}`)).toBe("token=[REDACTED]");
    expect(redact("Authorization: Bearer abcdefgh12345678")).not.toContain("abcdefgh12345678");
    expect(redact(`sk-${"z9".repeat(12)}`)).toBe("[REDACTED]");
    expect(redact("AKIAABCDEFGHIJKLMNOP")).toBe("[REDACTED]");
    expect(redact("a plain sentence")).toBe("a plain sentence");
  });
  it("truncates, flattens, and cannot fake a block marker or close a code span", () => {
    const q = quoteSafe(`a\n\nb \`c\` <!-- run-evals:end -->${"y ".repeat(300)}`, 50);
    expect(q).toContain("(truncated)");
    expect(q).not.toContain("\n");
    expect(q).not.toContain("`");
    expect(quoteSafe("<!-- run-evals:end -->")).not.toContain(BLOCK_END);
  });
});

describe("caseRow", () => {
  it("reads the arms, delta and failed graders of the plugin arm", () => {
    const row = caseRow("alpha", failing("alpha"));
    expect(row).toMatchObject({ with: 0.5, without: 0.25, delta: 0.25 });
    expect(row?.failed).toHaveLength(1);
    expect(row?.failed[0]).toMatchObject({ run: 1, grader: "g", explanation: "reply lacked 'hi'" });
  });
  it("is undefined for unreadable text or a different case", () => {
    expect(caseRow("alpha", "not json")).toBeUndefined();
    expect(caseRow("other", failing("alpha"))).toBeUndefined();
    expect(caseRow("alpha", undefined)).toBeUndefined();
  });
});

describe("withBlock", () => {
  const block = renderBlock("NEW");
  it("appends when there is no block, and replaces in place when there is", () => {
    expect(withBlock("body", block)).toBe(`body\n\n${block}\n`);
    const once = withBlock("before\n", renderBlock("OLD"));
    const twice = withBlock(`${once}\nafter`, block);
    expect(twice).toContain("NEW");
    expect(twice).not.toContain("OLD");
    expect(twice.split(BLOCK_START)).toHaveLength(2);
    expect(twice.endsWith("after")).toBe(true);
  });
});

describe("--case", () => {
  it("matches names and globs exactly, treating regex characters literally", () => {
    expect(caseMatcher("alpha").test("alpha")).toBe(true);
    expect(caseMatcher("alpha").test("alpha2")).toBe(false);
    expect(caseMatcher("al*").test("alpine")).toBe(true);
    expect(caseMatcher("a?pha").test("alpha")).toBe(true);
    expect(caseMatcher("a.pha").test("alpha")).toBe(false);
  });
  it("plans only the matching cases, one invocation each", async () => {
    const s = setup();
    expect(await main([s.root, "--case", "al*"], deps(s))).toBe(EXIT_OK);
    const names = s.calls.filter((c) => c.args[0] === "plugin").map((c) => caseOf(c.args));
    expect(names).toEqual(["alpha", "alpine"]);
  });
  it("exits 3 with nothing run when nothing matches", async () => {
    const s = setup();
    expect(await main([s.root, "--case", "zzz"], deps(s))).toBe(3);
    expect(s.err.join()).toContain("matching --case 'zzz'");
    expect(s.calls).toEqual([]);
  });
  it("shapes --dry-run to the subset and is in --help", async () => {
    const s = setup();
    await main([s.root, "--case", "beta", "--dry-run"], deps(s));
    expect(s.out.filter((l) => l.startsWith("invocation"))).toHaveLength(1);
    const h = setup();
    await main(["--help"], deps(h));
    expect(h.out.join()).toContain("--case <name-or-glob>");
  });
});

describe("printed summary", () => {
  it("prints the table, cost, command and a redacted, truncated failing reply", async () => {
    const s = setup();
    await main([s.root, "--case", "beta"], deps(s));
    const text = s.out.join("");
    expect(text).toContain("## Eval results");
    expect(text).toContain("| beta | 0.50 | 0.25 | 0.25 | 0 |");
    expect(text).toContain("tier `standard`");
    expect(text).toContain("Cost $0.2500");
    expect(text).toMatch(/run-evals\.ts \S+ --case beta/);
    expect(text).toContain("grader `g`: reply lacked");
    expect(text).toContain("token=[REDACTED]");
    expect(text).not.toContain(FAKE_TOKEN);
    expect(text).toContain("(truncated)");
    expect(text).not.toContain(BLOCK_START);
  });
  it("lists unstarted cases and marks a case with no readable result", async () => {
    const s = setup({
      onCli: (args, n) => ({
        result: n === 1 ? "garbage" : failing(caseOf(args)),
        spawn: spawned(),
      }),
    });
    // Ceiling 0.15: the unreadable first result is charged its $0.05 share,
    // the second costs 0.25, and the third is never started.
    await main([s.root, "--max-cost-usd", "0.15"], deps(s));
    const text = s.out.join("");
    expect(text).toContain("(no readable result)");
    expect(text).toMatch(/\| beta \| not run \|/);
  });
});

describe("--pr", () => {
  const prSetup = (over: FakeIoOptions = {}) =>
    setup({
      onGh: (a) =>
        a[1] === "view" ? spawned({ stdout: "Original body\n" }) : spawned(),
      ...over,
    });
  const argv = (s: { root: string }, extra: string[] = []) => [
    s.root,
    "--case",
    "beta",
    "--pr",
    "7",
    ...extra,
  ];

  it("rejects bad values, --dry-run and a lone --yes, before anything runs", () => {
    for (const bad of [["--pr", "x"], ["--pr", "0"], ["--pr", "7", "--dry-run"], ["--yes"]]) {
      const p = parseArgs(["plug", ...bad]);
      expect(p.kind).toBe("error");
    }
    const s = prSetup();
    return main(argv(s, ["--dry-run"]), deps(s)).then((code) => {
      expect(code).toBe(EXIT_USAGE);
      expect(s.calls).toEqual([]);
    });
  });
  it("does nothing on gh without --pr", async () => {
    const s = prSetup({ confirm: true });
    await main([s.root, "--case", "beta"], deps(s));
    expect(ghCalls(s.calls)).toEqual([]);
    expect(s.questions).toEqual([]);
  });
  it("prints the exact block, asks, and does not edit when declined", async () => {
    const s = prSetup({ confirm: false });
    expect(await main(argv(s), deps(s))).toBe(EXIT_OK);
    expect(s.out.join("")).toContain(BLOCK_START);
    expect(s.out.join("")).toContain("Tool-generated by run-evals.ts");
    expect(s.questions).toHaveLength(1);
    expect(ghCalls(s.calls).map((c) => c.args[1])).toEqual(["view"]);
  });
  it("edits with the block when confirmed, keeping the rest of the body", async () => {
    const s = prSetup({ confirm: true });
    await main(argv(s), deps(s));
    const edit = ghCalls(s.calls).find((c) => c.args[1] === "edit");
    expect(edit?.args.slice(0, 3)).toEqual(["pr", "edit", "7"]);
    const body = edit?.args[4] ?? "";
    expect(body.startsWith("Original body")).toBe(true);
    expect(body).toContain(BLOCK_START);
    expect(body).toContain(BLOCK_END);
    expect(body).not.toContain(FAKE_TOKEN);
  });
  it("--yes skips the question but still prints the block first", async () => {
    const s = prSetup();
    await main(argv(s, ["--yes"]), deps(s));
    expect(s.questions).toEqual([]);
    expect(ghCalls(s.calls).map((c) => c.args[1])).toEqual(["view", "edit"]);
    expect(s.out.join("")).toContain(BLOCK_START);
  });
  it("replaces an existing block on a re-run", async () => {
    const old = `Intro\n${renderBlock("STALE")}\nOutro`;
    const s = prSetup({
      confirm: true,
      onGh: (a) => (a[1] === "view" ? spawned({ stdout: `${old}\n` }) : spawned()),
    });
    await main(argv(s), deps(s));
    const body = ghCalls(s.calls).find((c) => c.args[1] === "edit")?.args[4] ?? "";
    expect(body).not.toContain("STALE");
    expect(body.startsWith("Intro\n")).toBe(true);
    expect(body.endsWith("Outro")).toBe(true);
  });
  it("reports a failed edit as exit 4 and a failed read without editing", async () => {
    const s = prSetup({
      confirm: true,
      onGh: (a) => (a[1] === "view" ? spawned() : spawned({ status: 1 })),
    });
    expect(await main(argv(s), deps(s))).toBe(4);
    const r = prSetup({ confirm: true, onGh: () => spawned({ status: 1 }) });
    expect(await main(argv(r), deps(r))).toBe(4);
    expect(ghCalls(r.calls).map((c) => c.args[1])).toEqual(["view"]);
  });
  it("keeps the worse run exit code when publishing succeeds", async () => {
    const s = prSetup({ confirm: true, onCli: () => ({ result: "garbage" }) });
    expect(await main(argv(s), deps(s))).toBe(EXIT_PARTIAL);
  });
});
