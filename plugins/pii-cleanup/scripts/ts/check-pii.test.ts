import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { main, readStaged, readTracked, stagedFiles } from "./check-pii.ts";

// Every value below is invented. alice/acme are deliberately not the placeholders (jdoe, jroe, me, user)
// that the check allows.
const run = (
  files: Record<string, string>,
  env: Record<string, string | undefined> = {},
  argv: string[] = [],
): { code: number; text: string } => {
  const lines: string[] = [];
  const code = main(
    argv,
    env,
    (s) => lines.push(s),
    () => Object.keys(files),
    (f) => files[f] ?? "",
  );
  return { code, text: lines.join("\n") };
};

const one = (body: string, env: Record<string, string | undefined> = {}) => run({ "a/case.yaml": body }, env);

it.each([
  ["email", "mail alice@acme-corp.com the report", "email"],
  ["unix home", "wrote /Users/alice/code/app/x.ts", "home-dir"],
  ["linux home", "wrote /home/alice/app/x.ts", "home-dir"],
  ["file url", "open file:///Users/alice/app/x.html", "home-dir"],
  ["windows home", "open C:\\Users\\alice\\app\\x.txt", "home-dir"],
  ["project dir", "dir -Users-alice-Development-app", "home-dir"],
])("fails on %s and names the rule, never the value", (_n, body, rule) => {
  const { code, text } = one(`line one\n${body}\n`);
  expect(code).toBe(1);
  expect(text).toContain(`a/case.yaml:2: ${rule}`);
  expect(text).not.toContain("alice");
  expect(text).not.toContain("acme");
});

it.each([
  "path /Users/me/code and /Users/jdoe/x and /home/user/y",
  "${CLAUDE_PLUGIN_ROOT}/scripts/x.ts",
  "#!/usr/bin/env bash",
  "/usr/bin /tmp/w/article.txt /etc/shadow /notes/team /srv/reports/",
  "mail user@example.com, a@b.test, x@host.invalid, y@mail.example.org",
  "mail jroe@widgetco-mail.com",
  "npx --yes figlet@1.7.0 hello and pkg@1.2.3-beta.4",
  "clone git@github.com:acme/widgets.git",
  "~/.claude/settings.json",
  "dir -Users-me-web and -Users-jdoe-app",
  "file:///Users/jdoe/x and C:\\Users\\me\\x",
  "open C:\\Users\\me to see the folder",
  "why-it-didn.t:\\s*\\**\\s*scope",
  "key: aw15_description_without_trigger-and-a-very-long-slug-name-here-2",
])("passes %s", (body) => {
  const { code, text } = one(`${body}\n`);
  expect(code).toBe(0);
  expect(text).toContain("no personal data");
});

it("still flags a real owner when prose follows a Windows home path", () => {
  const { code, text } = one("open C:\\Users\\alice to see the folder\n");
  expect(code).toBe(1);
  expect(text).toContain("a/case.yaml:1: home-dir");
});

it("takes a Windows owner with a space through the next separator, so `user jane` is not the placeholder `user`", () => {
  const { code, text } = one("wrote C:\\Users\\user jane\\Documents\\x.txt\n");
  expect(code).toBe(1);
  expect(text).toContain("a/case.yaml:1: home-dir");
  expect(text).not.toContain("jane");
  // `me smith` starts with the placeholder `me` but is a different owner.
  const second = one("wrote C:\\Users\\me smith\\doc.txt\n");
  expect(second.code).toBe(1);
  expect(second.text).not.toContain("smith");
});

it("reads a staged file whose name looks like an index stage prefix", () => {
  const dir = mkdtempSync(join(tmpdir(), "pii-stage0-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    writeFileSync(join(dir, "0:a.yaml"), "wrote /Users/alice/x\n");
    execFileSync("git", ["add", "--", "0:a.yaml"], { cwd: dir });
    expect(readStaged("0:a.yaml", dir)).toContain("/Users/alice/x");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("reports each file and line once per rule", () => {
  const { code, text } = run({
    "a/one.yaml": "/Users/alice/a and /Users/alice/b\nok\n/home/bob/c\n",
    "a/two.yaml": "fine\n",
  });
  expect(code).toBe(1);
  expect(text.match(/one\.yaml:1: home-dir/g)).toHaveLength(1);
  expect(text).toContain("one.yaml:3: home-dir");
  expect(text).not.toContain("two.yaml");
  expect(text).toContain("2 hits in 1 file");
});

it("fails on a deny term from the environment and prints only its position", () => {
  const { code, text } = one("the Globex deal\nfine\n", { PII_DENY_TERMS: "Initech\n Globex  Corp \nGlobex" });
  expect(code).toBe(1);
  expect(text).toContain("a/case.yaml:1: deny[3]");
  expect(text).not.toMatch(/globex/i);
});

it("matches a multi-word deny term across any whitespace", () => {
  const { code, text } = one("Globex\n  Corp\n", { PII_DENY_TERMS: "globex corp" });
  expect(code).toBe(1);
  expect(text).toContain("deny[1]");
});

it("passes and says so when no deny terms are set", () => {
  for (const env of [{}, { PII_DENY_TERMS: "" }, { PII_DENY_TERMS: " \n\n " }]) {
    const { code, text } = one("the Globex deal\n", env);
    expect(code).toBe(0);
    expect(text).toContain("PII_DENY_TERMS is not set");
  }
});

it("counts the deny terms it used without listing them", () => {
  const { code, text } = one("fine\n", { PII_DENY_TERMS: "Initech\nGlobex" });
  expect(code).toBe(0);
  expect(text).toContain("2 deny terms");
  expect(text).not.toMatch(/initech|globex/i);
});

it("says on a hit and on a clean run that git history is not scanned or changed", () => {
  for (const body of ["fine\n", "wrote /Users/alice/x\n"]) {
    expect(one(body).text).toContain("git history is not scanned or changed");
  }
});

it("fails closed when no file matches, so a broken pathspec cannot pass", () => {
  const { code, text } = run({});
  expect(code).toBe(2);
  expect(text).toContain("no files matched");
});

it("resolves the default pathspec from the repository root, so a subdirectory cwd still matches", () => {
  const seen: string[][] = [];
  main([], {}, () => undefined, (specs) => (seen.push([...specs]), ["a/case.yaml"]), () => "fine\n");
  expect(seen[0]?.[0]).toMatch(/^:\(top,glob\)/);
});

it("reports an unreadable tracked file as an incomplete scan and still scans the rest", () => {
  const read = (f: string): string => {
    if (f === "gone.yaml") throw new Error("ENOENT");
    return "wrote /Users/alice/x\n";
  };
  const run2 = (files: string[]): { code: number; text: string } => {
    const lines: string[] = [];
    const code = main([], {}, (s) => lines.push(s), () => files, read);
    return { code, text: lines.join("\n") };
  };
  const both = run2(["gone.yaml", "a/hit.yaml"]);
  expect(both.code).toBe(1);
  expect(both.text).toContain("gone.yaml: unreadable");
  expect(both.text).toContain("a/hit.yaml:1: home-dir");
  expect(both.text).toContain("scan incomplete");
  const only = run2(["gone.yaml"]);
  expect(only.code).toBe(1);
  expect(only.text).not.toContain("✓");
});

it("scans a tracked symlink's own text, never the file it points to", () => {
  const dir = mkdtempSync(join(tmpdir(), "pii-link-"));
  try {
    const target = join(dir, "target.txt");
    writeFileSync(target, "TARGET-CONTENT wrote /Users/bob/x\n");
    const link = join(dir, "link");
    symlinkSync(target, link);
    const dangling = join(dir, "dangling");
    symlinkSync("/Users/alice/missing", dangling);
    expect(readTracked(link)).toBe(target);
    expect(readTracked(link)).not.toContain("TARGET-CONTENT");
    expect(readTracked(dangling)).toBe("/Users/alice/missing");
    expect(readTracked(target)).toContain("TARGET-CONTENT");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("--staged passes quietly when nothing in scope is staged, and does not hand the flag to git as a pathspec", () => {
  const seen: string[][] = [];
  const lines: string[] = [];
  const code = main(["--staged"], {}, (s) => lines.push(s), (specs) => (seen.push([...specs]), []));
  expect(code).toBe(0);
  expect(lines.join("\n")).toContain("no staged files in scope");
  expect(seen[0]).toHaveLength(1);
  expect(seen[0]?.[0]).toMatch(/^:\(top,glob\)/);
});

it("--staged scans what is staged, not the working copy", () => {
  const dir = mkdtempSync(join(tmpdir(), "pii-staged-"));
  const git = (...args: string[]): string => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  try {
    git("init", "-q");
    mkdirSync(join(dir, "plugins/p/evals/c"), { recursive: true });
    const file = "plugins/p/evals/c/case.yaml";
    writeFileSync(join(dir, file), "wrote /Users/alice/x\n");
    writeFileSync(join(dir, "plugins/p/evals/c/unstaged.yaml"), "wrote /Users/bob/x\n");
    writeFileSync(join(dir, "README.md"), "wrote /Users/carol/x\n");
    git("add", file, "README.md");
    writeFileSync(join(dir, file), "clean now\n"); // edited after staging: the staged blob still holds the leak
    const specs = [":(top,glob)plugins/*/evals/**"];
    expect(stagedFiles(specs, dir)).toEqual([file]);
    expect(readStaged(file, dir)).toContain("/Users/alice/x");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("prints usage for -h and exits 0", () => {
  const { code, text } = run({}, {}, ["-h"]);
  expect(code).toBe(0);
  expect(text).toContain("Usage:");
});
