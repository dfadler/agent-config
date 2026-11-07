import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { format, parseReset, parseUsage, probeEnv, rank, run, summarize } from "./pick-account.ts";

// 2026-11-06 16:00 in Chicago (CST, UTC-6).
const NOW = new Date("2026-11-06T22:00:00Z");

const usage = (pct: number, resets: string) =>
  `You are currently using your subscription to power your Claude Code usage\n\n` +
  `Current week (all models): ${String(pct)}% used · resets ${resets}\n` +
  `Current week (Fable): 2% used · resets ${resets}\n\nWhat's contributing...\n`;

describe("parseUsage", () => {
  it("reads every window line and ignores the rest", () => {
    const w = parseUsage(usage(76, "Nov 8 at 6pm (America/Chicago)"));
    expect(w.map((x) => [x.label, x.percentUsed])).toEqual([
      ["week (all models)", 76],
      ["week (Fable)", 2],
    ]);
  });
});

describe("parseReset", () => {
  it("handles a dated reset in a named zone", () => {
    expect(parseReset("Nov 8 at 6pm (America/Chicago)", NOW)?.toISOString()).toBe(
      "2026-11-09T00:00:00.000Z",
    );
  });
  it("handles minutes and a time-only reset (today, else tomorrow)", () => {
    expect(parseReset("6:30pm (America/Chicago)", NOW)?.toISOString()).toBe(
      "2026-11-07T00:30:00.000Z",
    );
    expect(parseReset("3pm (America/Chicago)", NOW)?.toISOString()).toBe(
      "2026-11-07T21:00:00.000Z",
    );
  });
  it("keeps the wall-clock hour when tomorrow crosses a DST change", () => {
    // 2027-03-13 16:00 CST; US clocks spring forward the next morning, so 3pm CDT is 20:00Z.
    const before = new Date("2027-03-13T22:00:00Z");
    expect(parseReset("3pm (America/Chicago)", before)?.toISOString()).toBe(
      "2027-03-14T20:00:00.000Z",
    );
  });
  it("rolls a past date into next year", () => {
    expect(parseReset("Jan 2 at 12am (UTC)", NOW)?.toISOString()).toBe("2027-01-02T00:00:00.000Z");
  });
  it("returns null for shapes it does not know", () => {
    expect(parseReset("next Tuesday", NOW)).toBeNull();
    expect(parseReset("Nov 8 at 6pm (Not/AZone)", NOW)).toBeNull();
  });
});

describe("summarize and rank", () => {
  it("ranks the account that resets sooner with budget left first", () => {
    const far = summarize("far", usage(10, "Nov 12 at 6pm (America/Chicago)"), NOW); // 90% over ~146h
    const near = summarize("near", usage(60, "Nov 7 at 6pm (America/Chicago)"), NOW); // 40% over 26h
    expect(near.ratePerHour).toBeGreaterThan(far.ratePerHour ?? 0);
    expect(rank([far, near]).map((a) => a.name)).toEqual(["near", "far"]);
  });
  it("marks logged-out output unavailable and sorts it last", () => {
    const out = summarize("bad", "Total cost: $0.0000\n", NOW);
    expect(out).toMatchObject({ status: "unavailable", budgetLeft: null });
    const ok = summarize("ok", usage(99, "Nov 8 at 6pm (America/Chicago)"), NOW);
    expect(rank([out, ok]).map((a) => a.name)).toEqual(["ok", "bad"]);
  });
  it("keeps an unparsed-reset account above an exhausted one and warns", () => {
    const unparsed = summarize("unparsed", usage(60, "next Tuesday"), NOW);
    const spent = summarize("spent", usage(100, "Nov 8 at 6pm (America/Chicago)"), NOW);
    expect(unparsed).toMatchObject({ status: "ok", hoursToReset: null, ratePerHour: null });
    const ranked = rank([spent, unparsed]);
    expect(ranked.map((a) => a.name)).toEqual(["unparsed", "spent"]);
    expect(format(ranked)).toMatch(/note: reset time for unparsed was not recognized/);
  });
  it("treats a reset time already in the past as inconclusive, not as the top rank", () => {
    // 2pm today in Chicago, but it is 4pm: stale output, so the true window is unknown.
    const stale = summarize("stale", usage(60, "Nov 6 at 2pm (America/Chicago)"), NOW);
    expect(stale).toMatchObject({ status: "ok", hoursToReset: null, ratePerHour: null, budgetLeft: 40 });
    const steady = summarize("steady", usage(60, "Nov 12 at 6pm (America/Chicago)"), NOW);
    expect(rank([stale, steady]).map((a) => a.name)).toEqual(["steady", "stale"]);
    expect(format(rank([stale, steady]))).toMatch(
      /note: reset time for stale was not recognized or is in the past/,
    );
  });
  it("gives an exhausted account a zero rate", () => {
    expect(summarize("x", usage(100, "Nov 8 at 6pm (America/Chicago)"), NOW).ratePerHour).toBe(0);
  });
});

describe("probeEnv", () => {
  const base = {
    PATH: "/usr/bin",
    HOME: "/home/u",
    ANTHROPIC_API_KEY: "k",
    ANTHROPIC_AUTH_TOKEN: "t",
    ANTHROPIC_BASE_URL: "https://proxy.invalid",
    CLAUDE_CODE_OAUTH_TOKEN: "o",
    CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDE_CODE_USE_VERTEX: "1",
    CLAUDE_CODE_USE_FOUNDRY: "1",
    GITHUB_TOKEN: "g",
    SOME_API_KEY: "s",
    CLAUDE_CONFIG_DIR: "/other",
  };
  it("drops every credential and provider override so the dir's own login decides", () => {
    const env = probeEnv(base, "/acct/a");
    for (const k of Object.keys(base))
      if (k !== "PATH" && k !== "HOME" && k !== "CLAUDE_CONFIG_DIR") expect(env).not.toHaveProperty(k);
    expect(env).toMatchObject({ PATH: "/usr/bin", HOME: "/home/u", CLAUDE_CONFIG_DIR: "/acct/a" });
  });
  it("unsets CLAUDE_CONFIG_DIR for the default account and expands a leading ~", () => {
    expect(probeEnv(base, null)).not.toHaveProperty("CLAUDE_CONFIG_DIR");
    expect(probeEnv(base, "~/.claude_personal")["CLAUDE_CONFIG_DIR"]).toBe(
      `${homedir()}/.claude_personal`,
    );
  });
});

describe("run", () => {
  const deps = (probe: (dir: string | null) => string) => {
    const out: string[] = [];
    return { d: { now: NOW, probe, out: (t: string) => out.push(t) }, out };
  };
  it("passes each account's dir to the probe and prints a ranking", () => {
    const seen: (string | null)[] = [];
    const { d, out } = deps((dir) => {
      seen.push(dir);
      return dir === null
        ? usage(76, "Nov 8 at 6pm (America/Chicago)")
        : usage(5, "Nov 20 at 6pm (America/Chicago)"); // 95% over ~338h = 0.28%/h, below work's 0.48%/h
    });
    expect(run(["work=default", "personal=~/.claude_personal"], d)).toBe(0);
    expect(seen).toEqual([null, "~/.claude_personal"]);
    expect(out.join("")).toMatch(/^1\. work: 24% left/);
  });
  it("exits 1 when no account is readable and 2 on bad args", () => {
    expect(run(["a=default"], deps(() => "nope").d)).toBe(1);
    expect(run([], deps(() => "").d)).toBe(2);
    expect(run(["no-equals"], deps(() => "").d)).toBe(2);
  });
  it("marks an unparsed reset in --json as ok with hoursToReset null", () => {
    const { d, out } = deps(() => usage(60, "next Tuesday"));
    run(["--json", "a=default"], d);
    expect(JSON.parse(out.join(""))).toMatchObject([
      { name: "a", status: "ok", hoursToReset: null, budgetLeft: 40 },
    ]);
  });
  it("emits JSON with --json", () => {
    const { d, out } = deps(() => usage(50, "Nov 8 at 6pm (America/Chicago)"));
    run(["--json", "a=default"], d);
    expect(JSON.parse(out.join(""))).toMatchObject([{ name: "a", budgetLeft: 50 }]);
  });
});
