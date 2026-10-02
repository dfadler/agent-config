import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkGrantCaseNames,
  grantSet,
  grantsForCase,
  readGrantsFile,
} from "./grants.ts";
import { parseAllowedTool } from "./tools.ts";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eval-authoring-grants-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const write = (text: string): string => {
  const p = join(root, "grants.yaml");
  writeFileSync(p, text);
  return p;
};

const GOOD = [
  'schema_version: "1"',
  "grants:",
  "  asks-first:",
  '    - "Bash(npx *)"',
  "  runs:",
  '    - "Bash(npx --yes cowsay@latest *)"',
  "    - WebFetch",
  "  none: []",
  "",
].join("\n");

describe("readGrantsFile", () => {
  it("reads the documented format", () => {
    const g = readGrantsFile(write(GOOD));
    expect(g.issues).toEqual([]);
    expect(g.entries.map((e) => e.caseName)).toEqual([
      "asks-first",
      "runs",
      "none",
    ]);
    expect(
      grantsForCase(g, "runs").map((t) => [t.tool, t.specifier, t.loc.line]),
    ).toEqual([
      ["Bash", "npx --yes cowsay@latest *", 6],
      ["WebFetch", undefined, 7],
    ]);
    expect(grantsForCase(g, "none")).toEqual([]);
    expect(grantsForCase(g, "missing")).toEqual([]);
    expect(g.entries[0]?.caseNameLoc.line).toBe(3);
  });

  it("treats a missing file as no grants", () => {
    expect(readGrantsFile(join(root, "nope.yaml"))).toEqual({
      file: undefined,
      entries: [],
      issues: [],
    });
  });

  it("reports an unreadable file", () => {
    mkdirSync(join(root, "dir.yaml"));
    const g = readGrantsFile(join(root, "dir.yaml"));
    expect(g.issues[0]?.kind).toBe("unreadable-file");
  });

  it("reports YAML syntax errors", () => {
    expect(readGrantsFile(write("grants: [")).issues[0]?.kind).toBe(
      "yaml-syntax",
    );
  });

  it.each([
    ["non-mapping root", "- a\n", "wrong-type", "must be a mapping"],
    ["empty file", "", "wrong-type", "must be a mapping"],
    [
      "unknown top-level key",
      'schema_version: "1"\ngrants: {}\ngrant: {}\n',
      "wrong-type",
      "unknown top-level key 'grant'",
    ],
    [
      "missing schema_version",
      "grants: {}\n",
      "unsupported-schema",
      "missing schema_version",
    ],
    [
      "wrong schema_version",
      'schema_version: "2"\ngrants: {}\n',
      "unsupported-schema",
      "unsupported schema_version",
    ],
    [
      "unquoted number version",
      "schema_version: 2\ngrants: {}\n",
      "unsupported-schema",
      "unsupported schema_version",
    ],
    [
      "missing grants",
      'schema_version: "1"\n',
      "wrong-type",
      "missing 'grants'",
    ],
    [
      "grants not a mapping",
      'schema_version: "1"\ngrants: [a]\n',
      "wrong-type",
      "'grants' must be a mapping",
    ],
    [
      "case value not a list",
      'schema_version: "1"\ngrants:\n  c: Bash\n',
      "wrong-type",
      "must be a list",
    ],
    [
      "entry not a string",
      'schema_version: "1"\ngrants:\n  c:\n    - 5\n',
      "wrong-type",
      "must be a string",
    ],
    [
      "empty entry",
      'schema_version: "1"\ngrants:\n  c:\n    - ""\n',
      "wrong-type",
      "invalid grant entry ''",
    ],
    [
      "tool outside the five",
      'schema_version: "1"\ngrants:\n  c:\n    - Read\n',
      "wrong-type",
      "invalid grant entry 'Read'",
    ],
    [
      "empty specifier",
      'schema_version: "1"\ngrants:\n  c:\n    - "Bash()"\n',
      "wrong-type",
      "invalid grant entry 'Bash()'",
    ],
    [
      "duplicate entry",
      'schema_version: "1"\ngrants:\n  c:\n    - Bash\n    - Bash\n',
      "wrong-type",
      "duplicate grant entry 'Bash'",
    ],
  ])("rejects %s", (_name, text, kind, message) => {
    const issues = readGrantsFile(write(text)).issues;
    expect(issues.map((i) => i.kind)).toContain(kind);
    expect(issues.map((i) => i.message).join("\n")).toContain(message);
  });

  it("keeps one copy of a duplicate entry", () => {
    const g = readGrantsFile(
      write('schema_version: "1"\ngrants:\n  c:\n    - Bash\n    - Bash\n'),
    );
    expect(grantsForCase(g, "c")).toHaveLength(1);
  });
});

describe("checkGrantCaseNames", () => {
  it("flags entries naming a case that does not exist", () => {
    const g = readGrantsFile(write(GOOD));
    const checked = checkGrantCaseNames(g, ["asks-first", "none"]);
    expect(checked.issues).toHaveLength(1);
    expect(checked.issues[0]?.message).toContain("'runs'");
    expect(checked.issues[0]?.loc.line).toBe(5);
    expect(checkGrantCaseNames(g, ["asks-first", "runs", "none"])).toBe(g);
  });
});

describe("grantSet", () => {
  it("is sorted and de-duplicated; empty without an entry", () => {
    const g = readGrantsFile(
      write(
        'schema_version: "1"\ngrants:\n  c:\n    - WebFetch\n    - Bash\n    - "Bash(a *)"\n',
      ),
    );
    expect(grantSet(g, "c")).toEqual(["Bash", "Bash(a *)", "WebFetch"]);
    expect(grantSet(g, "other")).toEqual([]);
  });
});

describe("parseAllowedTool", () => {
  const loc = { file: "f", line: 1 };
  it("splits the tool from its specifier", () => {
    expect(parseAllowedTool("Bash(npx *)", loc)).toMatchObject({
      tool: "Bash",
      specifier: "npx *",
    });
    expect(parseAllowedTool("Read", loc)).toMatchObject({
      tool: "Read",
      specifier: undefined,
    });
    expect(parseAllowedTool("Bash()", loc).specifier).toBe("");
    expect(parseAllowedTool("WebFetch(domain:a.com)", loc).specifier).toBe(
      "domain:a.com",
    );
  });
});
