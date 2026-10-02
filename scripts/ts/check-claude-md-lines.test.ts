import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  checkLines,
  countLines,
  main,
  parseMaxLines,
  USAGE,
} from "./check-claude-md-lines.ts";
import { cliError, EXIT_FAILURE, EXIT_USAGE } from "./lib/exit-codes.ts";
import { err, ok } from "./lib/result.ts";

const SCRIPT = join(import.meta.dirname, "check-claude-md-lines.ts");
const REPO_ROOT = join(import.meta.dirname, "..", "..");

const lines = (n: number): string =>
  Array.from({ length: n }, (_, i) => `line ${String(i)}\n`).join("");

/** `main` with an in-memory filesystem of one file. */
const run = (argv: readonly string[], files: Record<string, string> = {}) =>
  main(argv, {}, {
    readFile: (p) => {
      const text = files[p];
      return text === undefined ? err(cliError(EXIT_FAILURE, `cannot read ${p}`)) : ok(text);
    },
  });

describe("countLines", () => {
  it("counts newline characters, like wc -l", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("a\nb")).toBe(1);
  });

  it("property: n terminated lines count as n", () => {
    fc.assert(
      fc.property(fc.nat(500), (n) => {
        expect(countLines(lines(n))).toBe(n);
      }),
    );
  });
});

describe("parseMaxLines", () => {
  it("accepts digits only", () => {
    expect(parseMaxLines("20")).toBe(20);
    expect(parseMaxLines("0")).toBe(0);
    expect(parseMaxLines("-5")).toBeUndefined();
    expect(parseMaxLines("$(CLAUDE_MD_MAX_LINES)")).toBeUndefined();
    expect(parseMaxLines("")).toBeUndefined();
    expect(parseMaxLines("1.5")).toBeUndefined();
    expect(parseMaxLines("12\n3")).toBeUndefined();
  });
});

describe("checkLines", () => {
  it("property: passes exactly when lines <= max", () => {
    fc.assert(
      fc.property(fc.nat(1000), fc.nat(1000), (n, max) => {
        expect(checkLines("f", n, max, String(max)).tag).toBe(n <= max ? "ok" : "err");
      }),
    );
  });
});

describe("main", () => {
  it("passes when the file is under the ceiling", () => {
    expect(run(["f.md", "20"], { "f.md": lines(10) })).toEqual(
      ok("✓ f.md is 10 lines (ceiling: 20)\n"),
    );
  });

  it("passes when the file exactly equals the ceiling", () => {
    expect(run(["f.md", "20"], { "f.md": lines(20) }).tag).toBe("ok");
  });

  it("fails with EXIT_FAILURE when the file is over the ceiling", () => {
    const r = run(["f.md", "20"], { "f.md": lines(21) });
    expect(r.tag).toBe("err");
    if (r.tag === "err") {
      expect(r.error.code).toBe(EXIT_FAILURE);
      expect(r.error.message).toContain("f.md is 21 lines, over the 20-line ceiling");
    }
  });

  it("fails with EXIT_USAGE when the file does not exist", () => {
    const r = run(["absent.md", "20"]);
    expect(r).toEqual(err(cliError(EXIT_USAGE, "::error::file not found: absent.md")));
  });

  it("fails with EXIT_USAGE and a usage line when max-lines is missing", () => {
    const r = run(["f.md"], { "f.md": lines(10) });
    expect(r.tag).toBe("err");
    if (r.tag === "err") {
      expect(r.error.code).toBe(EXIT_USAGE);
      expect(r.error.message).toContain("usage:");
      expect(r.error.message).toContain(USAGE);
    }
  });

  it("fails with EXIT_USAGE when there are no arguments at all", () => {
    const r = run([]);
    expect(r.tag === "err" && r.error.code).toBe(EXIT_USAGE);
  });

  it.each(["$(CLAUDE_MD_MAX_LINES)", "-5", "abc", ""])(
    "fails with EXIT_USAGE when max-lines is %j",
    (bad) => {
      const r = run(["f.md", bad], { "f.md": lines(10) });
      expect(r.tag === "err" && r.error.code).toBe(EXIT_USAGE);
      expect(r.tag === "err" && r.error.message).toContain(
        `max-lines value is not a non-negative integer: '${bad}'`,
      );
    },
  );

  it("checks the file before max-lines, as the shell script did", () => {
    const r = run(["absent.md", "nope"]);
    expect(r.tag === "err" && r.error.message).toContain("file not found");
  });

  it.each(["-h", "--help"])("%s prints usage and succeeds, even alone", (flag) => {
    expect(run([flag])).toEqual(ok(USAGE));
    expect(USAGE).toContain("Usage: check-claude-md-lines");
  });
});

describe("end to end (spawns node)", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-md-lines-"));
  const fixture = join(dir, "CLAUDE.md");
  const exec = (...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

  it("exit 0 and a stdout line under the ceiling", () => {
    writeFileSync(fixture, lines(10));
    const r = exec(fixture, "20");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`✓ ${fixture} is 10 lines (ceiling: 20)\n`);
  });

  it("exit 1 with the message on stderr over the ceiling", () => {
    writeFileSync(fixture, lines(21));
    const r = exec(fixture, "20");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("is 21 lines, over the 20-line ceiling");
    expect(r.stdout).toBe("");
  });

  it("exit 2 for a missing file", () => {
    const r = exec(join(dir, "absent.md"), "20");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("file not found");
  });

  it("exit 2 for a missing max-lines", () => {
    writeFileSync(fixture, lines(1));
    const r = exec(fixture);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("usage:");
  });

  it("exit 2 for a non-numeric max-lines", () => {
    writeFileSync(fixture, lines(1));
    const r = exec(fixture, "$(CLAUDE_MD_MAX_LINES)");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("max-lines value is not a non-negative integer");
  });

  it("-h and --help exit 0 with usage on stdout", () => {
    for (const flag of ["-h", "--help"]) {
      const r = exec(flag);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("Usage: check-claude-md-lines");
    }
  });

  it("the repo's own claude/CLAUDE.md satisfies the Makefile's ceiling", () => {
    // Read the ceiling from the Makefile so a bump there cannot leave this
    // test checking a stale value.
    const makefile = readFileSync(join(REPO_ROOT, "Makefile"), "utf8");
    const max = /^CLAUDE_MD_MAX_LINES\s*:=\s*([0-9]+)/m.exec(makefile)?.[1];
    expect(max).toBeDefined();
    const r = exec(join(REPO_ROOT, "claude", "CLAUDE.md"), max ?? "0");
    expect(r.status).toBe(0);
  });
});
