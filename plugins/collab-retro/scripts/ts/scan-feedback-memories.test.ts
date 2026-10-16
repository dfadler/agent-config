import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isoLocal, main, USAGE } from "./scan-feedback-memories.ts";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "scan-fb-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const memory = (project: string, name: string, type: string, ...body: string[]): string => {
  const dir = join(home, ".claude", "projects", project, "memory");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.md`);
  writeFileSync(
    file,
    ["---", `name: ${name}`, "description: test memory", "metadata:", `  type: ${type}`, "---", "", ...body, ""].join("\n"),
  );
  return file;
};

const scan = (argv: string[] = []) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(argv, { home, out: (t) => out.push(t), err: (t) => err.push(t) });
  return { code, out: out.join(""), err: err.join("") };
};

describe("scan-feedback-memories", () => {
  it("exits 0 with no output when no project has written memory", () => {
    expect(scan()).toEqual({ code: 0, out: "", err: "" });
  });

  it("lists a feedback memory with mtime, project, name and path", () => {
    const f = memory("proj-a", "some-feedback", "feedback", "The rule.");
    const r = scan();
    expect(r.code).toBe(0);
    const cols = r.out.trimEnd().split("\t");
    expect(cols[0]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/);
    expect(cols.slice(1)).toEqual(["proj-a", "some-feedback", f]);
  });

  it("skips non-feedback types and body-only mentions of feedback", () => {
    memory("proj-a", "fact", "project", "This body quotes a line: type: feedback");
    expect(scan().out).toBe("");
  });

  it("skips a memory already marked as surfaced", () => {
    memory("proj-a", "done", "feedback", "Surfaced as dfadler/agent-config#42 on 2026-01-01.");
    expect(scan().out).toBe("");
  });

  it("lists across projects, newest first", () => {
    const older = memory("proj-a", "older", "feedback", "x");
    const newer = memory("proj-b", "newer", "feedback", "y");
    utimesSync(older, new Date("2026-01-01T00:00:00"), new Date("2026-01-01T00:00:00"));
    utimesSync(newer, new Date("2026-02-01T00:00:00"), new Date("2026-02-01T00:00:00"));
    const lines = scan().out.trimEnd().split("\n");
    expect(lines.map((l) => l.split("\t")[1])).toEqual(["proj-b", "proj-a"]);
  });

  it("ignores .md files outside a memory/ directory", () => {
    const dir = join(home, ".claude", "projects", "p", "notes");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "n.md"), "---\ntype: feedback\n---\n");
    expect(scan().out).toBe("");
  });

  it("--incidents lists records, filtered by class, newest first", () => {
    const dir = join(home, ".claude", "incidents");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "2026-01-01-a.md"), "# a\nclass: stale-pin\n");
    writeFileSync(join(dir, "2026-02-01-b.md"), "# b\nclass: other\n");
    writeFileSync(join(dir, "2026-03-01-c.md"), "# c\nclass: stale-pin\n");
    const all = scan(["--incidents"]).out.trimEnd().split("\n");
    expect(all.map((l) => l.split("\t")[1])).toEqual(["stale-pin", "other", "stale-pin"]);
    const hit = scan(["--incidents", "stale-pin"]).out.trimEnd().split("\n");
    expect(hit.map((l) => l.split("\t")[0])).toEqual(["2026-03-01", "2026-01-01"]);
    expect(scan(["--incidents", "nope"]).out).toBe("");
  });

  it("--incidents with no directory is not an error", () => {
    expect(scan(["--incidents"])).toEqual({ code: 0, out: "", err: "" });
  });

  it("--incidents reports a non-ENOENT read error instead of a clean miss", () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "incidents"), "not a directory");
    const r = scan(["--incidents", "stale-pin"]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/cannot read/);
  });

  it("--incidents skips a directory named like a record", () => {
    const dir = join(home, ".claude", "incidents");
    mkdirSync(join(dir, "2026-04-01-x.md"), { recursive: true });
    writeFileSync(join(dir, "2026-01-01-a.md"), "class: stale-pin\n");
    const r = scan(["--incidents", "stale-pin"]);
    expect(r.code).toBe(0);
    expect(r.out.trimEnd().split("\n")).toHaveLength(1);
  });

  it("-h and --help print usage and exit 0", () => {
    memory("proj-a", "f", "feedback", "x");
    expect(scan(["-h"])).toEqual({ code: 0, out: USAGE, err: "" });
    expect(scan(["--help"]).out).toBe(USAGE);
  });

  it("rejects an unexpected argument with exit 2", () => {
    const r = scan(["bogus"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/unexpected argument: bogus/);
  });

  it("formats local time like date +%Y-%m-%dT%H:%M:%S", () => {
    expect(isoLocal(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe("2026-01-02T03:04:05");
  });

  it("runs as a CLI against HOME", () => {
    memory("proj-a", "cli", "feedback", "x");
    const r = spawnSync(process.execPath, [join(import.meta.dirname, "scan-feedback-memories.ts")], {
      env: { HOME: home, PATH: process.env["PATH"] ?? "" },
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/\tproj-a\tcli\t/);
  });
});
