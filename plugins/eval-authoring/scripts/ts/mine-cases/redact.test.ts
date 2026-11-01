import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { findLeaks, main, redact, transcriptTurns } from "./redact.ts";

// Invented transcript: every value below is fake. The jroe values are deliberately NOT the
// reserved placeholders (jdoe, example.com) that --check allows.
const EMAIL = "jroe@widgetco-mail.com";
const UNIX = "/Users/jroe/code/widget";
const HOME = "~/.config/widget";
const WIN = "C:\\Users\\jroe\\widget";
const GH = "ghp_" + "a1b2c3d4e5f6g7h8i9j0k1l2";
const SK = "sk-" + "test0123456789abcdefgh";
const AWS = "AKIA" + "ABCDEFGHIJKLMNOP";
const BEARER = "Bearer abcdef123456";
const ASSIGN = "api_key=hunter2hunter2";
const HEX = "0123456789abcdef0123456789abcdef";
const PROJDIR = "-Users-jroe-Development-widget";
const LEAKS = [EMAIL, UNIX, HOME, WIN, GH, SK, AWS, BEARER, ASSIGN, HEX, PROJDIR, "Acme Corp"];

const jsonl = (...objs: unknown[]): string => objs.map((o) => JSON.stringify(o)).join("\n");

const FIXTURE = jsonl(
  { type: "summary", summary: "ignored" },
  { type: "user", message: { role: "user", content: `Mail ${EMAIL} the report from ${UNIX}` } },
  {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: `Reading ${HOME} and ${WIN} for Acme\n  Corp.` },
        {
          type: "tool_use",
          name: "Bash",
          input: { command: `curl -H "Authorization: ${BEARER}" -d ${GH} ${SK} && type ${WIN}\\secret.txt` },
        },
      ],
    },
  },
  {
    type: "user",
    message: {
      role: "user",
      content: [
        // The array form of a tool result, the common one in real transcripts.
        { type: "tool_result", content: [{ type: "text", text: `${UNIX}/a.ts\n${WIN}\\w` }] },
        { type: "tool_result", content: `${AWS} ${ASSIGN} ${HEX} ${PROJDIR}` },
        { type: "text", text: "<system-reminder>Run as jroe on widgetco</system-reminder>hello" },
      ],
    },
  },
);

it("the fixture really holds every kind of leak", () => {
  expect(findLeaks(LEAKS.join("\n"), ["Acme Corp"]).sort()).toEqual(
    [
      "abs-path",
      "bearer",
      "deny:Acme Corp",
      "email",
      "home-path",
      "long-id",
      "project-dir",
      "secret-assignment",
      "token",
      "windows-path",
    ].sort(),
  );
});

it("a draft built from the fixture transcript keeps no email, path, token or deny term", () => {
  const turns = transcriptTurns(FIXTURE, { deny: ["Acme Corp"] });
  expect(turns).toHaveLength(3);
  const draft = turns.join("\n");
  expect(findLeaks(draft, ["Acme Corp", "widgetco"])).toEqual([]);
  for (const leak of LEAKS) expect(draft).not.toContain(leak);
  expect(draft).not.toContain("jroe");
  expect(draft).toContain("Bash"); // the structure survives, only the values go
  expect(draft).toContain("hello"); // text outside a system-reminder stays
});

it("redacts paths and secrets inside array-form tool results and tool inputs", () => {
  const turn = transcriptTurns(
    jsonl({
      type: "user",
      message: {
        content: [
          { type: "tool_result", content: [{ type: "text", text: `${UNIX}/a.ts\n${WIN}\\w` }] },
          { type: "tool_use", name: "Bash", input: { command: `type ${WIN}\\secret.txt`, password: "hunter2hunter2" } },
        ],
      },
    }),
  ).join("");
  expect(turn).not.toContain("jroe");
  expect(turn).not.toContain("hunter2");
  expect(turn).not.toContain("\\\\"); // no doubled backslashes from JSON escaping
});

it.each([
  "DB_PASSWORD=hunter2hunter2",
  "GH_TOKEN=abcd1234efgh",
  "OPENAI_API_KEY=xyzw12345678",
  '{"password":"hunter2hunter2"}',
  "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
])("secret assignment %s is flagged and redacted", (s) => {
  expect(findLeaks(s)).toContain("secret-assignment");
  expect(findLeaks(redact(s))).toEqual([]);
  expect(redact(s)).not.toMatch(/hunter2|abcd1234|xyzw1234|wJalr/);
});

it("redact does not eat ordinary prose, urls or kebab-case names", () => {
  const s = "and/or see https://github.com/dfadler/agent-config and mine-cases-fires-on-natural-phrasing";
  expect(redact(s)).toBe(s);
});

it("--check allows the reserved placeholders drafts use, and still flags anything else", () => {
  const placeholders = "mail jdoe@example.com from /Users/jdoe/code/widget or C:\\Users\\jdoe\\w or /home/user/x/y";
  expect(findLeaks(placeholders)).toEqual([]);
  expect(findLeaks(`${EMAIL} ${UNIX}`).sort()).toEqual(["abs-path", "email"]);
});

it("a deny term still matches when the text wraps it across lines", () => {
  expect(findLeaks("Acme\n   Corp", ["Acme Corp"])).toEqual(["deny:Acme Corp"]);
  expect(redact("Acme\n   Corp", ["Acme Corp"])).toBe("<redacted>");
});

it("stays fast on long single lines", () => {
  const started = Date.now();
  const blobs = ["a-".repeat(30_000), "a".repeat(60_000), "x@".repeat(30_000)];
  for (const blob of blobs) {
    findLeaks(blob);
    transcriptTurns(jsonl({ type: "user", message: { content: blob } }));
    transcriptTurns(jsonl({ type: "user", message: { content: [{ type: "text", text: blob }] } }));
  }
  expect(Date.now() - started).toBeLessThan(3000); // quadratic input took 8 to 23 s per blob
});

it("--check exits 1 on a leaky draft and 0 on a clean one", () => {
  const dir = mkdtempSync(join(tmpdir(), "redact-"));
  const bad = join(dir, "bad.yaml");
  const good = join(dir, "good.yaml");
  writeFileSync(bad, `prompt: mail ${EMAIL}\n`);
  writeFileSync(good, "prompt: mail <email> or jdoe@example.com\n");
  const out: string[] = [];
  expect(main(["--check", good], (s) => out.push(s), [])).toBe(0);
  expect(main(["--check", bad], (s) => out.push(s), [])).toBe(1);
  expect(out.join("\n")).toContain("bad.yaml: leaks email");
});

it("--check applies the default deny terms it is given", () => {
  const dir = mkdtempSync(join(tmpdir(), "redact-"));
  const f = join(dir, "f.yaml");
  writeFileSync(f, "prompt: ask Gordon\n");
  expect(main(["--check", f], () => undefined, ["Gordon"])).toBe(1);
  expect(main(["--check", f], () => undefined, [])).toBe(0);
});

it("transcript prints an untrusted-data banner and the redacted turns", () => {
  const dir = mkdtempSync(join(tmpdir(), "redact-"));
  const f = join(dir, "t.jsonl");
  writeFileSync(f, FIXTURE);
  const out: string[] = [];
  expect(main(["transcript", f, "--deny", "Acme Corp"], (s) => out.push(s), [])).toBe(0);
  expect(out[0]).toMatch(/^UNTRUSTED DATA/);
  expect(findLeaks(out.join("\n"), ["Acme Corp"])).toEqual([]);
});

it.each([
  [["--check", "--deny"]],
  [["--check", "--deny", "  ", "x"]],
  [["transcript", "x", "--max-turns", "abc"]],
  [["transcript", "x", "--max-turns", "0"]],
  [["transcript", "x", "--max-turns"]],
])("bad flag values %j exit 2 instead of failing open", (argv) => {
  const out: string[] = [];
  expect(main(argv, (s) => out.push(s), [])).toBe(2);
  expect(out.join("\n")).toMatch(/needs a/);
});
