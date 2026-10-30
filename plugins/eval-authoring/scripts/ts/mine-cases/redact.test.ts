import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { findLeaks, main, redact, transcriptTurns } from "./redact.ts";

// Invented transcript: every value below is fake and obviously so.
const EMAIL = "jdoe@example.com";
const UNIX = "/Users/jdoe/code/widget";
const HOME = "~/.config/widget";
const WIN = "C:\\Users\\jdoe\\widget";
const GH = "ghp_" + "a1b2c3d4e5f6g7h8i9j0k1l2";
const SK = "sk-" + "test0123456789abcdefgh";
const AWS = "AKIA" + "ABCDEFGHIJKLMNOP";
const BEARER = "Bearer abcdef123456";
const ASSIGN = "api_key=hunter2hunter2";
const HEX = "0123456789abcdef0123456789abcdef";
const LEAKS = [EMAIL, UNIX, HOME, WIN, GH, SK, AWS, BEARER, ASSIGN, HEX, "Acme"];
const FIXTURE = [
  { type: "summary", summary: "ignored" },
  { type: "user", message: { role: "user", content: `Mail ${EMAIL} the report from ${UNIX}` } },
  {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: `Reading ${HOME} and ${WIN} for Acme.` },
        { type: "tool_use", name: "Bash", input: { command: `curl -H "Authorization: ${BEARER}" -d ${GH} ${SK}` } },
      ],
    },
  },
  {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", content: `${AWS} ${ASSIGN} ${HEX}` }],
    },
  },
]
  .map((o) => JSON.stringify(o))
  .join("\n");

it("the fixture really holds every kind of leak", () => {
  expect(findLeaks(LEAKS.join("\n"), ["Acme"]).sort()).toEqual(
    [
      "abs-path",
      "bearer",
      "deny:Acme",
      "email",
      "home-path",
      "long-id",
      "secret-assignment",
      "token",
      "windows-path",
    ].sort(),
  );
});

it("a draft built from the fixture transcript keeps no email, path, token or deny term", () => {
  const turns = transcriptTurns(FIXTURE, { deny: ["Acme"] });
  expect(turns).toHaveLength(3);
  const draft = turns.join("\n");
  expect(findLeaks(draft, ["Acme"])).toEqual([]);
  for (const leak of LEAKS) expect(draft).not.toContain(leak);
  expect(draft).toContain("Bash"); // the structure survives, only the values go
});

it("redact does not eat ordinary prose, urls or kebab-case names", () => {
  const s = "and/or see https://github.com/dfadler/agent-config and mine-cases-fires-on-natural-phrasing";
  expect(redact(s)).toBe(s);
});

it("--check exits 1 on a leaky draft and 0 on a clean one", () => {
  const dir = mkdtempSync(join(tmpdir(), "redact-"));
  const bad = join(dir, "bad.yaml");
  const good = join(dir, "good.yaml");
  writeFileSync(bad, "prompt: mail jdoe@example.com\n");
  writeFileSync(good, "prompt: mail <email>\n");
  const out: string[] = [];
  expect(main(["--check", good], (s) => out.push(s))).toBe(0);
  expect(main(["--check", bad], (s) => out.push(s))).toBe(1);
  expect(out.join("\n")).toContain("bad.yaml: leaks email");
});

it("transcript prints an untrusted-data banner and the redacted turns", () => {
  const dir = mkdtempSync(join(tmpdir(), "redact-"));
  const f = join(dir, "t.jsonl");
  writeFileSync(f, FIXTURE);
  const out: string[] = [];
  expect(main(["transcript", f, "--deny", "Acme"], (s) => out.push(s))).toBe(0);
  expect(out[0]).toMatch(/^UNTRUSTED DATA/);
  expect(findLeaks(out.join("\n"), ["Acme"])).toEqual([]);
});
