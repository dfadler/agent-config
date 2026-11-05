import { expect, it } from "vitest";
import { main } from "./check-pii.ts";

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
  "why-it-didn.t:\\s*\\**\\s*scope",
  "key: aw15_description_without_trigger-and-a-very-long-slug-name-here-2",
])("passes %s", (body) => {
  const { code, text } = one(`${body}\n`);
  expect(code).toBe(0);
  expect(text).toContain("no personal data");
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

it("prints usage for -h and exits 0", () => {
  const { code, text } = run({}, {}, ["-h"]);
  expect(code).toBe(0);
  expect(text).toContain("Usage:");
});
