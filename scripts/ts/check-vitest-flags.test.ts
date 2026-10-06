import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeMain, nodeFlagEnv, type FlagEnv } from "./check-vitest-flags.ts";
import { cliError, EXIT_DEPENDENCY } from "./lib/exit-codes.ts";
import { err, ok } from "./lib/result.ts";

const HELP = "  --maxWorkers <n>   workers\n  --repeats <n>   repeat\n";

const env = (help: FlagEnv["helpText"] = () => ok(HELP)): FlagEnv => ({
  helpText: help,
  defaultFiles: () => ["doc.md"],
});

const files =
  (m: Record<string, string>) =>
  (path: string) => {
    const text = m[path];
    return text === undefined ? err(cliError(1, `cannot read ${path}`)) : ok(text);
  };

describe("check-vitest-flags", () => {
  it("passes when every documented flag is in the help", () => {
    const r = makeMain(env())(["a.md"], {}, { readFile: files({ "a.md": "use --maxWorkers=2 and --repeats" }) });
    expect(r.tag).toBe("ok");
  });

  it("fails naming the file and the flag the help lacks", () => {
    const r = makeMain(env())(
      ["a.md"],
      {},
      { readFile: files({ "a.md": "use --poolOptions.threads.maxThreads=2" }) },
    );
    expect(r).toMatchObject({ tag: "err", error: { code: 1 } });
    expect(r.tag === "err" && r.error.message).toContain("a.md: --poolOptions.threads.maxThreads");
  });

  it("scans the default files when none are given", () => {
    const r = makeMain(env())([], {}, { readFile: files({ "doc.md": "--gone" }) });
    expect(r.tag === "err" && r.error.message).toContain("doc.md: --gone");
  });

  it("surfaces a failure to run vitest --help", () => {
    const r = makeMain(env(() => err(cliError(EXIT_DEPENDENCY, "no vitest"))))(["a.md"], {}, { readFile: files({ "a.md": "" }) });
    expect(r).toMatchObject({ tag: "err", error: { code: EXIT_DEPENDENCY } });
  });

  it("surfaces an unreadable file", () => {
    const r = makeMain(env())(["missing.md"], {}, { readFile: files({}) });
    expect(r.tag).toBe("err");
  });

  it("prints usage for --help without running vitest", () => {
    const r = makeMain(env(() => { throw new Error("must not run"); }))(["--help"], {}, { readFile: files({}) });
    expect(r.tag === "ok" && r.value).toContain("Usage: check-vitest-flags.ts");
  });
});

describe("against the real repo (pinned vitest)", () => {
  it("exits 0: every documented flag exists in the installed vitest", () => {
    const script = join(import.meta.dirname, "check-vitest-flags.ts");
    const r = spawnSync(process.execPath, [script], {
      cwd: join(import.meta.dirname, "..", ".."),
      encoding: "utf8",
    });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("default files include each plugin skill, the rule and docs/testing.md", () => {
    const defaults = nodeFlagEnv.defaultFiles();
    expect(defaults).toContain("plugins/vitest/skills/flaky-tests/SKILL.md");
    expect(defaults).toContain(".claude/rules/vitest.md");
    expect(defaults).toContain("docs/testing.md");
  });
});
