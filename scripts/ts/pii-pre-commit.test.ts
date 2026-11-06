import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

const hook = resolve(import.meta.dirname, "../hooks/pre-commit");

// Every value below is invented. alice is deliberately not a placeholder (jdoe, jroe, me, user).
const inRepo = (
  files: Record<string, string>,
  afterStaging: Record<string, string> = {},
): { code: number | null; text: string } => {
  const dir = mkdtempSync(join(tmpdir(), "pii-hook-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(join(dir, name, ".."), { recursive: true });
      writeFileSync(join(dir, name), body);
    }
    execFileSync("git", ["add", "."], { cwd: dir });
    for (const [name, body] of Object.entries(afterStaging)) writeFileSync(join(dir, name), body);
    const r = spawnSync(process.execPath, [hook], { cwd: dir, encoding: "utf8" });
    return { code: r.status, text: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

it("is executable, so git will run it", () => {
  chmodSync(hook, statSync(hook).mode); // fails loudly when the file is missing
  expect(statSync(hook).mode & 0o111).not.toBe(0);
});

it("blocks a commit that stages a home path in an eval, naming file, line and rule only", () => {
  const { code, text } = inRepo({ "plugins/p/evals/c/case.yaml": "fine\nwrote /Users/alice/x\n" });
  expect(code).toBe(1);
  expect(text).toContain("plugins/p/evals/c/case.yaml:2: home-dir");
  expect(text).not.toContain("alice");
});

it("reads the index, so a leak cannot be hidden by cleaning the working copy after staging", () => {
  const file = "plugins/p/evals/c/case.yaml";
  const { code, text } = inRepo({ [file]: "wrote /Users/alice/x\n" }, { [file]: "clean now\n" });
  expect(code).toBe(1);
  expect(text).toContain(`${file}:1: home-dir`);
});

it("lets a commit through when the staged files are clean", () => {
  const { code, text } = inRepo({ "plugins/p/evals/c/case.yaml": "wrote /Users/jdoe/x\n" });
  expect(code).toBe(0);
  expect(text).toContain("no personal data");
});

it("ignores staged files outside the default scope", () => {
  const { code, text } = inRepo({ "docs/notes.md": "wrote /Users/alice/x\n" });
  expect(code).toBe(0);
  expect(text).toContain("no staged files in scope");
});
