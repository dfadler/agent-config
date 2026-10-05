import { describe, expect, it } from "vitest";
import {
  allowToolsArgs,
  buildCliArgs,
  hasGlobMeta,
  type RunSpec,
} from "./command.ts";
import { DEFAULT_JUDGE_MODEL, DEFAULT_MODEL, TIERS } from "./tiers.ts";

const reporting = {
  jsonFile: undefined,
  reportFile: undefined,
  outputDir: undefined,
  publishReport: false,
  keepTemp: false,
};

const spec = (over: Partial<RunSpec> = {}): RunSpec => ({
  target: "plugins/p",
  tier: TIERS.standard,
  cases: ["a", "b"],
  grants: [],
  model: undefined,
  judgeModel: undefined,
  maxCostUsd: undefined,
  evalDir: undefined,
  trustPlugin: false,
  reporting,
  ...over,
});

describe("allowToolsArgs", () => {
  const entries = ["Bash(npx *)", "Write(a,b)"];
  it("repeats the flag per entry", () => {
    expect(allowToolsArgs(entries, "repeated")).toEqual([
      "--allow-tools",
      "Bash(npx *)",
      "--allow-tools",
      "Write(a,b)",
    ]);
  });
  it("passes one flag with one token per entry in variadic shape", () => {
    expect(allowToolsArgs(entries, "variadic")).toEqual([
      "--allow-tools",
      "Bash(npx *)",
      "Write(a,b)",
    ]);
  });
  it("never joins entries with a comma", () => {
    expect(allowToolsArgs(entries).join("|")).not.toContain("Bash(npx *),");
  });
  it("emits nothing for no grants", () => {
    expect(allowToolsArgs([])).toEqual([]);
  });
});

describe("buildCliArgs", () => {
  it("puts the target first, before every option", () => {
    const args = buildCliArgs(
      spec({ grants: ["Bash(npx *)"], tier: TIERS.quick }),
    );
    expect(args.slice(0, 3)).toEqual(["plugin", "eval", "plugins/p"]);
    const target = args.indexOf("plugins/p");
    for (const flag of ["--allow-tools", "--tag", "--case"]) {
      expect(args.indexOf(flag)).toBeGreaterThan(target);
    }
  });

  it("puts --json last, after the target", () => {
    const args = buildCliArgs(
      spec({ reporting: { ...reporting, jsonFile: "out.json" } }),
    );
    expect(args.slice(-2)).toEqual(["--json", "out.json"]);
  });

  it("sets threshold, runs, cost ceiling and pinned models explicitly", () => {
    const args = buildCliArgs(spec());
    const at = (flag: string): string | undefined =>
      args[args.indexOf(flag) + 1];
    expect(at("--threshold")).toBe("1");
    expect(at("--runs")).toBe("3");
    expect(at("--max-cost-usd")).toBe("5");
    expect(at("--model")).toBe(DEFAULT_MODEL);
    expect(at("--judge-model")).toBe(DEFAULT_JUDGE_MODEL);
  });

  it("uses the tier's cost ceiling unless overridden, for each tier", () => {
    const at = (s: RunSpec): string | undefined => {
      const a = buildCliArgs(s);
      return a[a.indexOf("--max-cost-usd") + 1];
    };
    expect(at(spec({ tier: TIERS.quick }))).toBe("1");
    expect(at(spec({ tier: TIERS.standard }))).toBe("5");
    expect(at(spec({ tier: TIERS.thorough }))).toBe("15");
    for (const tier of Object.values(TIERS)) {
      expect(at(spec({ tier, maxCostUsd: 2.5 }))).toBe("2.5");
    }
  });

  it("lets the caller override the models", () => {
    const args = buildCliArgs(spec({ model: "m", judgeModel: "j" }));
    expect(args).toContain("m");
    expect(args).toContain("j");
  });

  it("quick tier adds --tag quick and --ablation none; standard adds neither", () => {
    const quick = buildCliArgs(spec({ tier: TIERS.quick })).join(" ");
    expect(quick).toContain("--tag quick");
    expect(quick).toContain("--ablation none");
    const standard = buildCliArgs(spec());
    expect(standard).not.toContain("--tag");
    expect(standard).not.toContain("--ablation");
  });

  it("passes --no-publish by default and --publish-report on request", () => {
    expect(buildCliArgs(spec())).toContain("--no-publish");
    const args = buildCliArgs(
      spec({ reporting: { ...reporting, publishReport: true } }),
    );
    expect(args).toContain("--publish-report");
    expect(args).not.toContain("--no-publish");
  });

  it("passes --trust-plugin only when trusted", () => {
    expect(buildCliArgs(spec())).not.toContain("--trust-plugin");
    expect(buildCliArgs(spec({ trustPlugin: true }))).toContain(
      "--trust-plugin",
    );
  });

  it("never passes --scaffold", () => {
    const every = buildCliArgs(
      spec({
        trustPlugin: true,
        grants: ["Bash"],
        reporting: {
          jsonFile: "j",
          reportFile: "r",
          outputDir: "o",
          publishReport: true,
          keepTemp: true,
        },
      }),
    );
    expect(every).not.toContain("--scaffold");
  });

  it("maps the reporting options to the CLI's own flags", () => {
    const args = buildCliArgs(
      spec({
        evalDir: "e",
        reporting: {
          jsonFile: "j.json",
          reportFile: "r.html",
          outputDir: "out",
          publishReport: false,
          keepTemp: true,
        },
      }),
    ).join(" ");
    for (const part of [
      "--keep-temp",
      "--report r.html",
      "--output-dir out",
      "--eval-dir e",
    ]) {
      expect(args).toContain(part);
    }
  });
});

describe("hasGlobMeta", () => {
  it("flags glob characters only", () => {
    expect(hasGlobMeta("fetch-execute-*")).toBe(true);
    expect(hasGlobMeta("fetch-execute-asks-first")).toBe(false);
  });
});
