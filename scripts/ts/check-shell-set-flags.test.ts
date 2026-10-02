import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main, makeMain, nodeShellFs, type ShellFs } from "./check-shell-set-flags.ts";
import { ok } from "./lib/result.ts";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "ts", "check-shell-set-flags.ts");

interface Ran {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const exec = (args: readonly string[], cwd = REPO_ROOT): Ran => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

describe("end to end against a fixture tree", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "set-flags-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const script = (name: string, text: string, mode: number): void => {
    writeFileSync(join(dir, name), text);
    chmodSync(join(dir, name), mode);
  };

  it("passes on a directory with no scripts", () => {
    const r = exec([dir]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("All shell scripts are chmod +x");
  });

  it("passes on a compliant executable script, found in a nested directory", () => {
    mkdirSync(join(dir, "a", "b"), { recursive: true });
    writeFileSync(join(dir, "a", "b", "ok.sh"), "#!/bin/bash\nset -euo pipefail\necho hi\n");
    chmodSync(join(dir, "a", "b", "ok.sh"), 0o755);
    expect(exec([dir]).status).toBe(0);
  });

  it("a shebanged script with no set flags fails with exit 1 and names only that violation", () => {
    script("missing.sh", "#!/bin/bash\n\necho hi\n", 0o755);
    const r = exec([dir]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("missing.sh");
    expect(r.stderr).not.toContain("not marked executable");
  });

  it("a no-shebang file without the marker fails on set flags only", () => {
    script("lib.sh", "# a library\nhelper() { echo hi; }\n", 0o644);
    const r = exec([dir]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("lib.sh");
    expect(r.stderr).toContain("Missing 'set -uo pipefail'");
    expect(r.stderr).not.toContain("not marked executable");
  });

  it("the sourced-only marker exempts a non-executable file with no set flags", () => {
    script("lib.sh", "#!/bin/bash\n# sourced-only\nhelper() { echo hi; }\n", 0o644);
    const r = exec([dir]);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain("not marked executable");
  });

  it("reports every offender, not just the first", () => {
    script("one.sh", "#!/bin/bash\necho a\n", 0o755);
    script("two.sh", "#!/bin/bash\necho b\n", 0o755);
    const r = exec([dir]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("one.sh");
    expect(r.stderr).toContain("two.sh");
  });

  it("a shebanged script that is not executable fails on the exec bit only", () => {
    script("not-exec.sh", "#!/bin/bash\nset -uo pipefail\necho hi\n", 0o644);
    const r = exec([dir]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("not marked executable");
    expect(r.stderr).toContain("not-exec.sh");
    expect(r.stderr).not.toContain("Missing 'set -uo pipefail'");
  });

  it("reports both violation types independently, listing the file under each", () => {
    script("broken.sh", "#!/bin/bash\necho hi\n", 0o644);
    const r = exec([dir]);
    expect(r.stderr).toContain("not marked executable");
    expect(r.stderr).toContain("Missing 'set -uo pipefail'");
    expect(r.stderr.match(/broken\.sh/g)).toHaveLength(2);
  });

  it("a no-shebang file is never checked for the exec bit", () => {
    script("lib.sh", "# a library\nhelper() { echo hi; }\n", 0o644);
    expect(exec([dir]).stderr).not.toContain("not marked executable");
  });

  it("ignores non-.sh files, missing roots, and symlinked scripts", () => {
    script("notes.txt", "echo hi\n", 0o644);
    script("target.sh", "#!/bin/bash\nset -uo pipefail\n", 0o755);
    symlinkSync("/nonexistent", join(dir, "dangling.sh"));
    expect(exec([dir, join(dir, "no-such-dir")]).status).toBe(0);
  });

  it("accepts a single script file as a root, as find does", () => {
    script("one.sh", "#!/bin/bash\necho a\n", 0o755);
    expect(exec([join(dir, "one.sh")]).status).toBe(1);
  });

  it("with no arguments, checks the default roots under the working directory", () => {
    mkdirSync(join(dir, "scripts"));
    writeFileSync(join(dir, "scripts", "bad.sh"), "#!/bin/bash\necho hi\n");
    chmodSync(join(dir, "scripts", "bad.sh"), 0o755);
    const r = exec([], dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("scripts/bad.sh");
  });
});

describe("the repo and the CLI surface", () => {
  it("the repo's own scripts satisfy the convention", () => {
    const r = exec([]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("-h prints usage and exits 0", () => {
    const r = exec(["-h"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Usage: check-shell-set-flags.ts");
  });

  it("--help prints usage and exits 0, even with other args present", () => {
    const r = exec(["--help", "somewhere"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Usage: check-shell-set-flags.ts");
  });

  it("an unrecognized option exits with EXIT_USAGE (2)", () => {
    const r = exec(["--bogus"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown option: --bogus");
  });
});

describe("makeMain with a fake filesystem", () => {
  const fakeFs = (files: readonly string[], execs: readonly string[]): ShellFs => ({
    listShellFiles: () => files,
    isExecutable: (p) => execs.includes(p),
  });

  it("an unreadable file is an EXIT_FAILURE error", () => {
    const result = makeMain(fakeFs(["x.sh"], []))(["d"], {}, {
      readFile: (p) => ({ tag: "err", error: { code: 1, message: `cannot read ${p}` } }),
    });
    expect(result).toEqual({ tag: "err", error: { code: 1, message: "cannot read x.sh" } });
  });

  it("uses the injected executable bit", () => {
    const text = "#!/bin/bash\nset -uo pipefail\n";
    const io = { readFile: () => ok(text) };
    expect(makeMain(fakeFs(["x.sh"], ["x.sh"]))(["d"], {}, io).tag).toBe("ok");
    expect(makeMain(fakeFs(["x.sh"], []))(["d"], {}, io).tag).toBe("err");
  });

  it("exports a main wired to the real filesystem", () => {
    expect(typeof main).toBe("function");
    expect(nodeShellFs.isExecutable(SCRIPT)).toBe(false);
    expect(nodeShellFs.listShellFiles([join(REPO_ROOT, "setup.sh")])).toHaveLength(1);
  });
});
