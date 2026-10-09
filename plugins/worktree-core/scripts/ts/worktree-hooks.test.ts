import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkSymlinks } from "./check-worktree-symlinks-hook.ts";
import { pruneMerged } from "./prune-merged-worktrees-hook.ts";
import { requireWorktree } from "./require-worktree-hook.ts";
import {
  EXIT_BLOCK,
  hookExitCode,
  realCtx,
  type Env,
  type HookCtx,
} from "./worktree-hook-lib.ts";

interface Fake {
  gitDir?: string; // undefined = not a git repo
  settings?: string; // raw settings.json text; undefined = absent
  env?: Env;
  bashOut?: { stdout: string; stderr: string };
}

const makeCtx = (f: Fake) => {
  const out: string[] = [];
  const err: string[] = [];
  const bashCalls: string[][] = [];
  const ctx: HookCtx = {
    env: f.env ?? {},
    git: (args) => {
      if (args[1] === "--git-dir")
        return f.gitDir === undefined
          ? { status: 128, stdout: "" }
          : { status: 0, stdout: `${f.gitDir}\n` };
      return { status: 0, stdout: "/top\n" };
    },
    readFile: (p) => {
      if (p === "/top/.claude/settings.json" && f.settings !== undefined)
        return f.settings;
      throw new Error("ENOENT");
    },
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    script: (script, args) => {
      bashCalls.push([script, ...args]);
      return f.bashOut ?? { stdout: "", stderr: "" };
    },
  };
  return { ctx, out, err, bashCalls };
};

const enforce = (v: string) => JSON.stringify({ worktree: { enforce: v } });

describe("requireWorktree", () => {
  it("allows remote sessions", () => {
    const c = makeCtx({
      gitDir: ".git",
      env: { CLAUDE_CODE_REMOTE: "true", WORKTREE_ENFORCE: "block" },
    });
    expect(requireWorktree(c.ctx)).toBe(0);
  });

  it("allows outside a git repo", () => {
    expect(
      requireWorktree(makeCtx({ env: { WORKTREE_ENFORCE: "block" } }).ctx),
    ).toBe(0);
  });

  it("allows a linked worktree even in block mode", () => {
    const c = makeCtx({
      gitDir: "/p/.git/worktrees/feat",
      env: { WORKTREE_ENFORCE: "block" },
    });
    expect(requireWorktree(c.ctx)).toBe(0);
  });

  it.each<[string, Fake]>([
    ["nothing configured", {}],
    ["settings off", { settings: enforce("off") }],
    ["settings unknown value", { settings: enforce("maybe") }],
    ["malformed settings", { settings: "{not json" }],
    ["settings block but env off", { settings: enforce("block"), env: { WORKTREE_ENFORCE: "no" } }],
    ["unrecognized env value falls through", { env: { WORKTREE_ENFORCE: "1" } }],
  ])("is off: %s", (_n, f) => {
    const c = makeCtx({ gitDir: ".git", ...f });
    expect(requireWorktree(c.ctx)).toBe(0);
    expect(c.out).toEqual([]);
    expect(c.err).toEqual([]);
  });

  it("warns on stdout without blocking (env beats settings)", () => {
    const c = makeCtx({
      gitDir: ".git",
      settings: enforce("block"),
      env: { WORKTREE_ENFORCE: "warn" },
    });
    expect(requireWorktree(c.ctx)).toBe(0);
    expect(c.out.join("")).toMatch(/Warning/);
  });

  it.each<[string, Fake]>([
    ["env", { env: { WORKTREE_ENFORCE: "block" } }],
    ["settings", { settings: enforce("block") }],
  ])("blocks with exit 2 via %s", (_n, f) => {
    const c = makeCtx({ gitDir: ".git", ...f });
    expect(requireWorktree(c.ctx)).toBe(EXIT_BLOCK);
    expect(c.err.join("")).toMatch(/main git checkout/);
    expect(c.out).toEqual([]);
  });
});

describe("hookExitCode (fail-closed)", () => {
  it("guard exits 2 when the body throws", () => {
    const errs: string[] = [];
    const code = hookExitCode(
      "guard",
      () => {
        throw new Error("boom");
      },
      (t) => errs.push(t),
    );
    expect(code).toBe(2);
    expect(errs.join("")).toMatch(/boom/);
  });

  it("guard exits 2 when requireWorktree itself hits a throwing dependency", () => {
    const { ctx } = makeCtx({ gitDir: ".git", env: {} });
    const broken: HookCtx = {
      ...ctx,
      git: () => {
        throw new Error("spawn exploded");
      },
    };
    expect(hookExitCode("guard", () => requireWorktree(broken), () => {})).toBe(2);
  });

  it("informational hook fails open (0) on a throw, including a non-Error", () => {
    expect(
      hookExitCode(
        "informational",
        () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw "str";
        },
        () => {},
      ),
    ).toBe(0);
  });

  it("passes the body's own code through", () => {
    expect(hookExitCode("guard", () => 2, () => {})).toBe(2);
    expect(hookExitCode("guard", () => 0, () => {})).toBe(0);
  });
});

const symlinkSettings = (v: string) =>
  JSON.stringify({ worktree: { symlinkCheck: v } });

describe("checkSymlinks", () => {
  // The script path must exist for the hook to run it; any real file works
  // because ctx.bash is faked.
  const script = import.meta.filename;

  it("is off by default and in remote sessions", () => {
    const a = makeCtx({});
    expect(checkSymlinks(a.ctx, script)).toBe(0);
    const b = makeCtx({ env: { CLAUDE_CODE_REMOTE: "true", WORKTREE_SYMLINK_CHECK: "on" } });
    expect(checkSymlinks(b.ctx, script)).toBe(0);
    expect(a.bashCalls).toEqual([]);
    expect(b.bashCalls).toEqual([]);
  });

  it.each(["1", "true", "yes", "on"])("env %s opts in and runs --fix", (v) => {
    const c = makeCtx({ env: { WORKTREE_SYMLINK_CHECK: v } });
    checkSymlinks(c.ctx, script);
    expect(c.bashCalls).toEqual([[script, "--fix"]]);
  });

  it.each(["0", "false", "no", "off"])("env %s opts out even if settings say on", (v) => {
    const c = makeCtx({ env: { WORKTREE_SYMLINK_CHECK: v }, settings: symlinkSettings("on") });
    checkSymlinks(c.ctx, script);
    expect(c.bashCalls).toEqual([]);
  });

  it("settings on runs; settings without the key does not", () => {
    const on = makeCtx({ settings: symlinkSettings("on") });
    checkSymlinks(on.ctx, script);
    expect(on.bashCalls.length).toBe(1);
    const none = makeCtx({ settings: "{}" });
    checkSymlinks(none.ctx, script);
    expect(none.bashCalls).toEqual([]);
  });

  it("does nothing when the verify script is missing", () => {
    const c = makeCtx({ env: { WORKTREE_SYMLINK_CHECK: "on" } });
    expect(checkSymlinks(c.ctx, "/nonexistent/verify.sh")).toBe(0);
    expect(c.bashCalls).toEqual([]);
  });

  it("stays silent when verify prints nothing, prefixes output otherwise", () => {
    const quiet = makeCtx({ env: { WORKTREE_SYMLINK_CHECK: "on" } });
    checkSymlinks(quiet.ctx, script);
    expect(quiet.out).toEqual([]);
    const loud = makeCtx({
      env: { WORKTREE_SYMLINK_CHECK: "on" },
      bashOut: { stdout: "stale link\n", stderr: "could not relink\n" },
    });
    expect(checkSymlinks(loud.ctx, script)).toBe(0);
    expect(loud.out.join("")).toBe("🔗 stale link\ncould not relink\n");
  });
});

describe("pruneMerged", () => {
  const script = import.meta.filename;
  const prune = (v: unknown) => JSON.stringify({ worktree: { autoPrune: v } });

  it("does nothing when unconfigured or remote", () => {
    const a = makeCtx({});
    pruneMerged(a.ctx, script);
    const b = makeCtx({ env: { CLAUDE_CODE_REMOTE: "true", WORKTREE_AUTO_PRUNE: "on" } });
    pruneMerged(b.ctx, script);
    expect(a.bashCalls).toEqual([]);
    expect(b.bashCalls).toEqual([]);
  });

  it("ignores a non-boolean autoPrune setting", () => {
    const c = makeCtx({ settings: prune("yes") });
    pruneMerged(c.ctx, script);
    expect(c.bashCalls).toEqual([]);
  });

  it.each<[Fake, string]>([
    [{ env: { WORKTREE_AUTO_PRUNE: "1" } }, "--auto"],
    [{ env: { WORKTREE_AUTO_PRUNE: "off" } }, "--hook"],
    [{ settings: prune(true) }, "--auto"],
    [{ settings: prune(false) }, "--hook"],
    [{ settings: prune(true), env: { WORKTREE_AUTO_PRUNE: "0" } }, "--hook"],
  ])("%j maps to %s", (f, flag) => {
    const c = makeCtx(f);
    pruneMerged(c.ctx, script);
    expect(c.bashCalls).toEqual([[script, flag]]);
  });

  it("forwards the script's stdout and skips a missing script", () => {
    const c = makeCtx({ env: { WORKTREE_AUTO_PRUNE: "on" }, bashOut: { stdout: "pruned 2\n", stderr: "x" } });
    expect(pruneMerged(c.ctx, script)).toBe(0);
    expect(c.out.join("")).toBe("pruned 2\n");
    const m = makeCtx({ env: { WORKTREE_AUTO_PRUNE: "on" } });
    pruneMerged(m.ctx, "/nonexistent/prune.sh");
    expect(m.bashCalls).toEqual([]);
  });
});

describe("realCtx", () => {
  it("runs git and bash for real, reporting failure as nonzero", () => {
    const c = realCtx();
    expect(c.git(["--version"]).status).toBe(0);
    expect(c.git(["no-such-subcommand"]).status).not.toBe(0);
    const dir = mkdtempSync(join(tmpdir(), "wt-script-"));
    const js = join(dir, "s.js");
    writeFileSync(
      js,
      'console.log(process.argv[2]); console.error("oops");',
    );
    expect(c.script(js, ["hi"])).toEqual({ stdout: "hi\n", stderr: "oops\n" });
    rmSync(dir, { recursive: true, force: true });
    expect(c.readFile(import.meta.filename)).toMatch(/realCtx/);
  });
});

// End-to-end: the real entrypoints, spawned the way hooks.json spawns them
// (node + .ts path), against real temp git repos.
describe("entrypoints (spawned)", () => {
  const entry = (n: string) => join(import.meta.dirname, `${n}.ts`);
  let tmp: string;
  let main: string;
  let linked: string;
  const git = (cwd: string, ...a: string[]) =>
    spawnSync("git", a, { cwd, encoding: "utf8" });
  const hook = (cwd: string, env: Record<string, string>, name = "require-worktree-hook") =>
    spawnSync(process.execPath, [entry(name)], {
      cwd,
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "", HOME: tmp, ...env },
    });

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "wt-hook-"));
    main = join(tmp, "main");
    linked = join(tmp, "linked");
    mkdirSync(main);
    git(main, "init", "-q", "-b", "main");
    git(main, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "i");
    git(main, "worktree", "add", "-q", "-b", "feat", linked);
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("blocks in the main checkout, allows the linked worktree", () => {
    const blocked = hook(main, { WORKTREE_ENFORCE: "block" });
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toMatch(/main git checkout/);
    expect(hook(linked, { WORKTREE_ENFORCE: "block" }).status).toBe(0);
  });

  it("honours settings.json in the repo", () => {
    mkdirSync(join(main, ".claude"));
    writeFileSync(join(main, ".claude", "settings.json"), enforce("block"));
    expect(hook(main, {}).status).toBe(2);
  });

  it("an unusable git is treated as 'not a repo' and allows", () => {
    const shim = join(tmp, "shim");
    mkdirSync(shim);
    writeFileSync(join(shim, "git"), "garbage");
    chmodSync(join(shim, "git"), 0o755);
    const r = spawnSync(process.execPath, [entry("require-worktree-hook")], {
      cwd: main,
      encoding: "utf8",
      env: { PATH: shim, WORKTREE_ENFORCE: "block" },
    });
    // Parity with the bash hook: a missing git never blocks.
    expect(r.status).toBe(0);
  });

  it("symlink hook exits 0 and stays silent when off", () => {
    const r = hook(main, {}, "check-worktree-symlinks-hook");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("prune hook exits 0 and stays silent when unconfigured", () => {
    const r = hook(main, {}, "prune-merged-worktrees-hook");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});
