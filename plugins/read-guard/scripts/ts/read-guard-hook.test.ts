import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "./read-guard-hook.ts";

// realpath'd sandbox: <root>/secret (protected), <root>/open, <root>/link -> secret.
// Built at module load because it.each tables below need the paths.
const root = realpathSync(mkdtempSync(join(tmpdir(), "read-guard-")));
const secret = join(root, "secret");
const open = join(root, "open");
const config = join(root, "cfg.json");
mkdirSync(secret);
mkdirSync(open);
writeFileSync(join(secret, "key.txt"), "x");
symlinkSync(secret, join(root, "link"));
writeFileSync(config, JSON.stringify({ directories: [secret] }));

interface Decision {
  hookEventName?: string;
  permissionDecision?: string;
  permissionDecisionReason?: string;
}
const parse = (text: string): Decision | undefined => {
  if (!text) return undefined;
  const v: unknown = JSON.parse(text);
  const o = typeof v === "object" && v !== null ? Object.fromEntries(Object.entries(v)) : {};
  const h: unknown = o["hookSpecificOutput"];
  return typeof h === "object" && h !== null ? Object.fromEntries(Object.entries(h)) : undefined;
};

const call = (
  tool: string,
  tool_input: Record<string, unknown>,
  env: Record<string, string> = {},
  cwd: string = open,
) => {
  const out: string[] = [];
  const code = run({
    env: { READ_GUARD_CONFIG: config, ...env },
    stdin: JSON.stringify({ tool_name: tool, tool_input, cwd }),
    home: root,
    readFile: (p) => {
      try {
        return readFileSync(p, "utf8");
      } catch {
        return undefined;
      }
    },
    out: (t) => out.push(t),
  });
  const text = out.join("");
  const decision = parse(text);
  return { code, decision };
};

describe("read-guard: ask path", () => {
  it.each<[string, Record<string, unknown>]>([
    ["Read", { file_path: `${secret}/key.txt` }],
    ["Read", { file_path: "../secret/key.txt" }], // .. from cwd
    ["Read", { file_path: "../link/key.txt" }], // symlink into protected dir
    ["Read", { file_path: "../secret/not-created-yet.txt" }],
    ["Grep", { pattern: "x", path: "../secret" }],
    ["Grep", { pattern: "x", path: ".." }], // recursive search from a parent
    ["Glob", { pattern: "*.txt", path: "../secret" }],
    ["Glob", { pattern: `${secret}/**/*.txt` }],
    ["Bash", { command: `cat ${secret}/key.txt` }],
    ["Bash", { command: "cat ../secret/key.txt | head" }],
    ["Bash", { command: "cat '../link/key.txt'" }],
    ["Bash", { command: `cd ${secret} && cat key.txt` }],
    ["Bash", { command: `rg --files=${secret}` }],
    ["Bash", { command: "cat ~/secret/key.txt" }], // home is the sandbox root
    ["Bash", { command: `cat ${secret}/k*` }],
  ])("%s %j asks", (tool, input) => {
    const r = call(tool, input);
    expect(r.code).toBe(0);
    expect(r.decision?.hookEventName).toBe("PreToolUse");
    expect(r.decision?.permissionDecision).toBe("ask");
    expect(r.decision?.permissionDecisionReason).toContain(secret);
  });

  it("asks for Bash run from inside a protected cwd", () => {
    expect(call("Bash", { command: "ls" }, {}, secret).decision?.permissionDecision).toBe("ask");
  });
});

describe("read-guard: deny path", () => {
  it("denies when READ_GUARD=deny", () => {
    const r = call("Read", { file_path: `${secret}/key.txt` }, { READ_GUARD: "deny" });
    expect(r.decision?.permissionDecision).toBe("deny");
  });
});

describe("read-guard: allow path (no output)", () => {
  it.each<[string, Record<string, unknown>]>([
    ["Read", { file_path: "a.txt" }],
    ["Read", { file_path: `${root}/secret-not/x` }], // prefix lookalike
    ["Grep", { pattern: "x", path: "." }],
    ["Grep", { pattern: "x" }],
    ["Glob", { pattern: "**/*.ts" }],
    ["Bash", { command: "ls -la && echo hi" }],
    ["Bash", { command: `cat ${open}/a.txt` }],
    ["Edit", { file_path: `${secret}/key.txt` }], // not a covered tool
  ])("%s %j is silent", (tool, input) => {
    expect(call(tool, input)).toEqual({ code: 0, decision: undefined });
  });

  it("is silent when READ_GUARD=off", () => {
    expect(call("Read", { file_path: `${secret}/key.txt` }, { READ_GUARD: "off" }).decision).toBeUndefined();
  });

  it.each(["", "dney", "DENY"])("treats invalid mode %j as ask, never off", (mode) => {
    const r = call("Read", { file_path: `${secret}/key.txt` }, { READ_GUARD: mode });
    expect(r.decision?.permissionDecision).toBe("ask");
  });
});

describe("read-guard: config and input handling", () => {
  it("does nothing when no config file exists", () => {
    const r = call("Read", { file_path: `${secret}/key.txt` }, { READ_GUARD_CONFIG: join(root, "missing.json") });
    expect(r.decision).toBeUndefined();
  });

  it("asks (does not go silent) on an invalid config", () => {
    const bad = join(root, "bad.json");
    writeFileSync(bad, "{ not json");
    const r = call("Read", { file_path: "a.txt" }, { READ_GUARD_CONFIG: bad });
    expect(r.decision?.permissionDecision).toBe("ask");
    writeFileSync(bad, JSON.stringify({ directories: [1] }));
    expect(call("Read", { file_path: "a.txt" }, { READ_GUARD_CONFIG: bad }).decision?.permissionDecision).toBe("ask");
  });

  it("fails open on unparseable stdin", () => {
    const out: string[] = [];
    const code = run({ env: { READ_GUARD_CONFIG: config }, stdin: "nope", home: root, readFile: () => "{}", out: (t) => out.push(t) });
    expect({ code, out }).toEqual({ code: 0, out: [] });
  });
});

describe("entrypoint (spawned)", () => {
  const entry = join(import.meta.dirname, "read-guard-hook.ts");
  it("emits an ask decision on stdout for a protected Read", () => {
    const r = spawnSync(process.execPath, [entry], {
      input: JSON.stringify({ tool_name: "Read", tool_input: { file_path: `${secret}/key.txt` }, cwd: open }),
      encoding: "utf8",
      env: { PATH: "", READ_GUARD_CONFIG: config },
    });
    expect(r.status).toBe(0);
    expect(parse(r.stdout)?.permissionDecision).toBe("ask");
  });
});
