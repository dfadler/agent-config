import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MANAGED_BEGIN,
  MANAGED_END,
  parseArgs,
  stripManagedSection,
  teardown,
  USAGE,
} from "./teardown.ts";

const REAL_ROOT = join(import.meta.dirname, "..", "..");

// Hermetic: home and repo are temp dirs; teardown() takes them as arguments.
let sandbox: string;
let home: string;
let repo: string;
let lines: string[];

const claude = (...p: string[]): string => join(home, ".claude", ...p);
const write = (path: string, text: string): void => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};
const isLink = (p: string): boolean => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};
const run = (flags: readonly string[] = []): number => {
  const o = parseArgs(flags);
  if (typeof o === "string" || "bad" in o) throw new Error("bad flags");
  return teardown(o, home, repo, (l) => lines.push(l));
};
const managed = (extra = ""): string =>
  `${MANAGED_BEGIN}\n@CLAUDE.personal.md\n@${repo}/claude/CLAUDE.md\n${MANAGED_END}\n${extra}`;
const installLinks = (): void => {
  write(claude("CLAUDE.md"), managed());
  mkdirSync(claude("commands"), { recursive: true });
  mkdirSync(claude("skills"), { recursive: true });
  symlinkSync(join(repo, "claude/commands/demo.md"), claude("commands/demo.md"));
  symlinkSync(join(repo, "plugins/demo-plugin"), claude("skills/demo-plugin"));
};
const settings = (data: unknown): void => {
  write(claude("settings.json"), JSON.stringify(data));
};
const readSettings = (): unknown => JSON.parse(readFileSync(claude("settings.json"), "utf8"));
const cmd = (script: string): string => `node "${home}/.claude/skills/${script}"`;

beforeEach(() => {
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), "teardown-")));
  home = join(sandbox, "home");
  repo = join(sandbox, "repo");
  lines = [];
  mkdirSync(home, { recursive: true });
  write(join(repo, "claude/CLAUDE.md"), "# global\n");
  write(join(repo, "claude/commands/demo.md"), "# a command\n");
  mkdirSync(join(repo, "plugins/demo-plugin"), { recursive: true });
  write(
    join(repo, "scripts/plugin-hooks.tsv"),
    readFileSync(join(REAL_ROOT, "scripts/plugin-hooks.tsv"), "utf8"),
  );
});
afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("constants", () => {
  it("managed markers match scripts/claude-md-lib.sh", () => {
    const lib = readFileSync(join(REAL_ROOT, "scripts/claude-md-lib.sh"), "utf8");
    expect(lib).toContain(`MANAGED_BEGIN="${MANAGED_BEGIN}"`);
    expect(lib).toContain(`MANAGED_END="${MANAGED_END}"`);
  });
});

describe("parseArgs", () => {
  it("selects everything with no flags and only the named parts otherwise", () => {
    expect(parseArgs([])).toEqual({ commands: true, plugins: true, claudeMd: true });
    expect(parseArgs(["--plugins", "--claude-md"])).toEqual({
      commands: false,
      plugins: true,
      claudeMd: true,
    });
  });
  it("reports help and unknown arguments", () => {
    expect(parseArgs(["--help"])).toBe("help");
    expect(parseArgs(["--nope"])).toEqual({ bad: "--nope" });
  });
});

describe("stripManagedSection", () => {
  it("keeps user text and drops leading blanks and trailing newlines", () => {
    expect(stripManagedSection(managed("\nUser line\n"))).toBe("User line");
  });
});

describe("CLAUDE.md", () => {
  it("strips the managed section and restores a non-empty CLAUDE.personal.md", () => {
    write(claude("CLAUDE.md"), managed());
    write(claude("CLAUDE.personal.md"), "personal content\n");
    expect(run()).toBe(0);
    expect(readFileSync(claude("CLAUDE.md"), "utf8")).toBe("personal content\n");
    expect(existsSync(claude("CLAUDE.personal.md"))).toBe(false);
    expect(lines).toContain(`Removed empty ${claude("CLAUDE.md")}`);
  });

  it("preserves user additions below the managed section", () => {
    write(claude("CLAUDE.md"), managed("\nUser-added: custom\n"));
    run();
    expect(readFileSync(claude("CLAUDE.md"), "utf8")).toBe("User-added: custom\n");
    expect(lines.join("\n")).toContain("Removed managed section");
  });

  it("removes an empty placeholder only when the setup-managed sidecar exists", () => {
    write(claude("CLAUDE.md"), managed());
    write(claude("CLAUDE.personal.md"), "");
    write(claude("CLAUDE.personal.md.setup-managed"), "");
    run();
    expect(existsSync(claude("CLAUDE.md"))).toBe(false);
    expect(existsSync(claude("CLAUDE.personal.md"))).toBe(false);
    expect(existsSync(claude("CLAUDE.personal.md.setup-managed"))).toBe(false);
  });

  it("leaves a user-owned empty CLAUDE.personal.md untouched", () => {
    write(claude("CLAUDE.md"), managed());
    write(claude("CLAUDE.personal.md"), "");
    run();
    expect(existsSync(claude("CLAUDE.personal.md"))).toBe(true);
  });

  it("leaves a CLAUDE.md with no managed section alone", () => {
    write(claude("CLAUDE.md"), "standalone config\n");
    run();
    expect(readFileSync(claude("CLAUDE.md"), "utf8")).toBe("standalone config\n");
  });

  it("legacy: removes the repo symlink and restores CLAUDE.personal.md", () => {
    mkdirSync(claude(), { recursive: true });
    symlinkSync(join(repo, "claude/CLAUDE.md"), claude("CLAUDE.md"));
    write(claude("CLAUDE.personal.md"), "personal content\n");
    run();
    expect(isLink(claude("CLAUDE.md"))).toBe(false);
    expect(readFileSync(claude("CLAUDE.md"), "utf8")).toBe("personal content\n");
  });

  it("legacy: leaves a CLAUDE.md symlink pointing elsewhere", () => {
    mkdirSync(claude(), { recursive: true });
    write(join(sandbox, "elsewhere.md"), "x");
    symlinkSync(join(sandbox, "elsewhere.md"), claude("CLAUDE.md"));
    run();
    expect(isLink(claude("CLAUDE.md"))).toBe(true);
  });
});

describe("symlinks", () => {
  it("removes command and plugin links into the repo, but not foreign ones", () => {
    installLinks();
    mkdirSync(join(sandbox, "other"));
    symlinkSync(join(sandbox, "other"), claude("skills/someone-elses"));
    run();
    expect(isLink(claude("commands/demo.md"))).toBe(false);
    expect(isLink(claude("skills/demo-plugin"))).toBe(false);
    expect(readlinkSync(claude("skills/someone-elses"))).toBe(join(sandbox, "other"));
  });

  it("removes a dangling link into plugins/ and a relative link into the repo", () => {
    installLinks();
    symlinkSync(join(repo, "plugins/gone"), claude("skills/gone"));
    rmSync(claude("commands/demo.md"));
    symlinkSync("../../../repo/claude/commands/demo.md", claude("commands/demo.md"));
    run();
    expect(isLink(claude("skills/gone"))).toBe(false);
    expect(isLink(claude("commands/demo.md"))).toBe(false);
  });

  it("is idempotent: a second run reports nothing but Done.", () => {
    installLinks();
    write(claude("CLAUDE.personal.md"), "personal\n");
    run();
    lines = [];
    run();
    expect(lines).toEqual(["Done."]);
  });
});

describe("selective flags", () => {
  it("--commands leaves plugins and CLAUDE.md alone", () => {
    installLinks();
    run(["--commands"]);
    expect(isLink(claude("commands/demo.md"))).toBe(false);
    expect(isLink(claude("skills/demo-plugin"))).toBe(true);
    expect(readFileSync(claude("CLAUDE.md"), "utf8")).toContain(MANAGED_BEGIN);
  });

  it("--plugins unlinks plugins and deregisters hooks only", () => {
    installLinks();
    settings({
      hooks: { PreToolUse: [{ matcher: "Edit|Write", hooks: [{ type: "command", command: cmd("worktree-core/scripts/ts/require-worktree-hook.ts") }] }] },
    });
    run(["--plugins"]);
    expect(isLink(claude("skills/demo-plugin"))).toBe(false);
    expect(isLink(claude("commands/demo.md"))).toBe(true);
    expect(readFileSync(claude("CLAUDE.md"), "utf8")).toContain(MANAGED_BEGIN);
    expect(readSettings()).toEqual({ hooks: {} });
  });

  it("--claude-md leaves symlinks alone", () => {
    installLinks();
    write(claude("CLAUDE.personal.md"), "personal content\n");
    run(["--claude-md"]);
    expect(readFileSync(claude("CLAUDE.md"), "utf8")).toBe("personal content\n");
    expect(isLink(claude("commands/demo.md"))).toBe(true);
    expect(isLink(claude("skills/demo-plugin"))).toBe(true);
  });
});

describe("hook deregistration", () => {
  const entry = (command: string, matcher?: string): unknown => ({
    ...(matcher === undefined ? {} : { matcher }),
    hooks: [{ type: "command", command }],
  });

  it("removes every current hook-table command and the retired .sh paths", () => {
    settings({
      hooks: {
        PreToolUse: [entry(cmd("worktree-core/scripts/ts/require-worktree-hook.ts"), "Edit|Write")],
        SessionStart: [
          { hooks: [
            { type: "command", command: cmd("worktree-core/scripts/ts/check-worktree-symlinks-hook.ts") },
            { type: "command", command: cmd("worktree-core/scripts/ts/prune-merged-worktrees-hook.ts") },
          ] },
        ],
        Stop: [entry(`${home}/.claude/skills/memory-hygiene/hooks/scripts/memory-hygiene-stop-hook.sh`)],
      },
    });
    run();
    expect(readSettings()).toEqual({ hooks: {} });
  });

  it("keeps foreign hooks and entries, and the event's position", () => {
    const foreign = entry("rtk hook claude", "Bash");
    settings({
      model: "x",
      hooks: {
        PreToolUse: [foreign, entry(cmd("worktree-core/scripts/ts/require-worktree-hook.ts"), "Edit|Write")],
        Notification: [entry("notify")],
      },
    });
    run();
    expect(readSettings()).toEqual({
      model: "x",
      hooks: { PreToolUse: [foreign], Notification: [entry("notify")] },
    });
  });

  it("does not rewrite settings.json when nothing matches", () => {
    write(claude("settings.json"), '{"a":1}');
    run();
    expect(readFileSync(claude("settings.json"), "utf8")).toBe('{"a":1}');
  });

  it("is a no-op without a settings.json, and fails (exit 1) on invalid JSON", () => {
    expect(run()).toBe(0);
    write(claude("settings.json"), "{not json");
    expect(run()).toBe(1);
    expect(readFileSync(claude("settings.json"), "utf8")).toBe("{not json");
  });
});

describe("./teardown.sh end to end (spawns the shim)", () => {
  const sh = (args: readonly string[], env: Record<string, string> = {}) =>
    spawnSync("bash", [join(REAL_ROOT, "teardown.sh"), ...args], {
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "", HOME: home, ...env },
    });

  it("--help prints usage and touches nothing", () => {
    const r = sh(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(USAGE);
    expect(existsSync(claude())).toBe(false);
  });

  it("an unknown argument exits 2 and touches nothing", () => {
    const r = sh(["--nope"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Unknown argument: --nope");
    expect(existsSync(claude())).toBe(false);
  });

  it("exits 4 with a message when node is not on PATH", () => {
    const bash = spawnSync("bash", ["-c", "command -v bash"], { encoding: "utf8" }).stdout.trim();
    // A PATH holding only dirname (which the shim needs) and no node.
    const bin = join(sandbox, "bin");
    mkdirSync(bin);
    symlinkSync("/usr/bin/dirname", join(bin, "dirname"));
    const r = spawnSync(bash, [join(REAL_ROOT, "teardown.sh")], {
      encoding: "utf8",
      env: { PATH: bin, HOME: home },
    });
    expect(r.status).toBe(4);
    expect(r.stderr).toContain("Node 22.18 or newer is required");
  });
});
