import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { main, type Deps, type ExecResult } from "./upload.ts";

const SCRIPT = join(import.meta.dirname, "upload.ts");

const done = (stdout = ""): ExecResult => ({ missing: false, status: 0, stdout, stderr: "" });

interface Fake {
  deps: Deps;
  calls: { cmd: string; args: string[] }[];
  /** Body passed to `pr|issue edit --body-file`, or `comment --body`. */
  saved: string[];
  curlUrls: string[];
  out: string[];
  err: string[];
  sleeps: number[];
}

/**
 * Fake gh/curl. `bodies` is served one per `view` call (last repeats), which
 * is how a test simulates a concurrent edit landing between the two reads.
 */
const fake = (bodies: string[] = ["existing body text"]): Fake => {
  const f: Omit<Fake, "deps"> = { calls: [], saved: [], curlUrls: [], out: [], err: [], sleeps: [] };
  let views = 0;
  const deps: Deps = {
    exec: (cmd, args) => {
      f.calls.push({ cmd, args });
      if (cmd === "curl") {
        f.curlUrls.push(args[1] ?? "");
        return done(JSON.stringify({ url: `https://github.com/user-attachments/assets/fake-${String(f.curlUrls.length)}` }));
      }
      if (args[0] === "auth") return done("fake-token\n");
      if (args[0] === "api") return done("12345\n");
      const sub = args[1];
      if (sub === "view") {
        const body = bodies[Math.min(views++, bodies.length - 1)] ?? "";
        return done(`${body}\n`);
      }
      if (sub === "edit") f.saved.push(readFileSync(args[args.indexOf("--body-file") + 1] ?? "", "utf8"));
      if (sub === "comment") f.saved.push(args[args.indexOf("--body") + 1] ?? "");
      return done();
    },
    sleepSeconds: (s) => f.sleeps.push(s),
    out: (s) => f.out.push(s),
    errOut: (s) => f.err.push(s),
  };
  return { ...f, deps };
};

const files = (names: string[]): string[] => {
  const dir = mkdtempSync(join(tmpdir(), "upload-files-"));
  return names.map((n) => {
    const p = join(dir, n);
    writeFileSync(p, "bytes");
    return p;
  });
};

const ghCalls = (f: Fake, kind: string, sub: string) => f.calls.filter((c) => c.cmd === "gh" && c.args[0] === kind && c.args[1] === sub);

describe("default mode", () => {
  it("prints image markdown for an image and a bare url for a video", () => {
    const f = fake();
    const [png, mp4] = files(["before.png", "walkthrough.mp4"]);
    expect(main(["--repo", "o/n", png ?? "", mp4 ?? ""], f.deps)).toBe(0);
    expect(f.out.join("")).toBe(
      "![before](https://github.com/user-attachments/assets/fake-1)\nhttps://github.com/user-attachments/assets/fake-2\n",
    );
    expect(f.err.join("")).toContain("404 until referenced");
    expect(f.calls.some((c) => c.args[0] === "edit")).toBe(false);
  });

  it("maps mp4/mov/webm to the right content type and keeps the token off argv", () => {
    const f = fake();
    expect(main(["--repo", "o/n", ...files(["a.mp4", "b.mov", "c.webm"])], f.deps)).toBe(0);
    expect(f.curlUrls[0]).toContain("content_type=video/mp4");
    expect(f.curlUrls[1]).toContain("content_type=video/quicktime");
    expect(f.curlUrls[2]).toContain("content_type=video/webm");
    expect(f.curlUrls[0]).toContain("repository_id=12345");
    expect(JSON.stringify(f.calls)).not.toContain("fake-token");
  });

  it("percent-encodes the file name", () => {
    const f = fake();
    expect(main(["--repo", "o/n", ...files(["my shot.png"])], f.deps)).toBe(0);
    expect(f.curlUrls[0]).toContain("name=my%20shot.png&");
  });
});

describe("--pr / --issue", () => {
  it("--pr appends the heading and markdown via gh pr edit, with one read pair and one edit", () => {
    const f = fake();
    expect(main(["--repo", "o/n", "--pr", "42", ...files(["before.png"])], f.deps)).toBe(0);
    expect(ghCalls(f, "pr", "view")).toHaveLength(2);
    expect(ghCalls(f, "pr", "edit")).toHaveLength(1);
    expect(f.saved[0]).toBe(
      "existing body text\n\n## Screenshots\n\n![before](https://github.com/user-attachments/assets/fake-1)\n",
    );
  });

  it("retries and preserves a concurrent body edit instead of clobbering it", () => {
    const f = fake(["existing body text", "existing body text -- edited by someone else"]);
    expect(main(["--repo", "o/n", "--pr", "42", ...files(["before.png"])], f.deps)).toBe(0);
    expect(ghCalls(f, "pr", "edit")).toHaveLength(1);
    expect(f.saved[0]).toContain("edited by someone else");
    expect(f.saved[0]).toContain("![before]");
    expect(f.sleeps).toEqual([1]);
  });

  it("gives up without writing when the body changes on every read", () => {
    const f = fake(["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8"]);
    expect(main(["--repo", "o/n", "--pr", "42", ...files(["before.png"])], f.deps)).toBe(1);
    expect(f.err.join("")).toContain("changed concurrently");
    expect(f.err.join("")).toContain("without overwriting the newer body");
    expect(ghCalls(f, "pr", "edit")).toHaveLength(0);
    expect(f.saved).toEqual([]);
  });

  it("does not edit again when the block is already in the body", () => {
    const f = fake(["intro\n\n## Screenshots\n\n![before](https://github.com/user-attachments/assets/fake-1)"]);
    expect(main(["--repo", "o/n", "--pr", "42", ...files(["before.png"])], f.deps)).toBe(0);
    expect(ghCalls(f, "pr", "edit")).toHaveLength(0);
  });

  it("--issue uses gh issue edit, not gh pr edit", () => {
    const f = fake();
    expect(main(["--repo", "o/n", "--issue", "7", ...files(["before.png"])], f.deps)).toBe(0);
    expect(ghCalls(f, "issue", "edit")).toHaveLength(1);
    expect(ghCalls(f, "pr", "edit")).toHaveLength(0);
  });

  it("--comment posts a comment instead of editing the body", () => {
    const f = fake();
    expect(main(["--repo", "o/n", "--pr", "42", "--comment", ...files(["before.png"])], f.deps)).toBe(0);
    expect(ghCalls(f, "pr", "comment")).toHaveLength(1);
    expect(ghCalls(f, "pr", "edit")).toHaveLength(0);
    expect(f.saved[0]).toContain("![before]");
  });

  it("--heading overrides the default heading", () => {
    const f = fake();
    expect(main(["--repo", "o/n", "--pr", "42", "--heading", "## Walkthrough", ...files(["before.png"])], f.deps)).toBe(0);
    expect(f.saved[0]).toContain("## Walkthrough");
    expect(f.saved[0]).not.toContain("## Screenshots");
  });
});

describe("errors", () => {
  const [png = ""] = files(["before.png"]);
  it.each([
    [[png], "--repo OWNER/NAME is required"],
    [["--repo", "o/n"], "at least one image file is required"],
    [["--repo", "o/n", "--pr", "1", "--issue", "2", png], "pass --pr or --issue, not both"],
    [["--repo", "o/n", "--bogus", png], "Unknown flag: --bogus"],
    [["--repo"], "--repo requires a value"],
  ])("usage error %j exits 2 before calling gh", (argv, message) => {
    const f = fake();
    expect(main(argv, f.deps)).toBe(2);
    expect(f.err.join("")).toContain(message);
    expect(f.calls).toEqual([]);
  });

  it("rejects an unrecognized extension and names the supported ones", () => {
    const f = fake();
    expect(main(["--repo", "o/n", ...files(["clip.mkv"])], f.deps)).toBe(1);
    expect(f.err.join("")).toContain("unrecognized extension");
    expect(f.err.join("")).toContain("mp4/mov/webm");
    expect(f.curlUrls).toEqual([]);
  });

  it("rejects a file that does not exist", () => {
    const f = fake();
    expect(main(["--repo", "o/n", "/nonexistent/nope.png"], f.deps)).toBe(1);
    expect(f.err.join("")).toContain("file not found");
  });

  it("reports an upload response with no url, including the raw response", () => {
    const f = fake();
    const base = f.deps.exec;
    f.deps.exec = (cmd, args) => (cmd === "curl" ? done('{"message":"nope"}') : base(cmd, args));
    expect(main(["--repo", "o/n", png], f.deps)).toBe(1);
    expect(f.err.join("")).toContain("didn't return a url");
    expect(f.err.join("")).toContain('{"message":"nope"}');
  });

  it("exits 4 when gh is not installed", () => {
    const f = fake();
    f.deps.exec = () => ({ missing: true, status: 1, stdout: "", stderr: "" });
    expect(main(["--repo", "o/n", png], f.deps)).toBe(4);
  });

  it("prints usage for --help", () => {
    const f = fake();
    expect(main(["--help"], f.deps)).toBe(0);
    expect(f.out.join("")).toContain("Usage:");
  });
});

describe("CLI against PATH shims", () => {
  it("uploads through real gh/curl lookups", () => {
    const root = mkdtempSync(join(tmpdir(), "upload-cli-"));
    const bin = join(root, "bin");
    mkdirSync(bin);
    const shim = (name: string, body: string) => {
      writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    };
    shim("gh", 'case "$1" in auth) echo tok;; api) echo 9;; *) exit 3;; esac');
    shim("curl", 'echo \'{"url":"https://github.com/user-attachments/assets/shim"}\'');
    const [png = ""] = files(["x.png"]);
    const r = spawnSync(process.execPath, [SCRIPT, "--repo", "o/n", png], {
      encoding: "utf8",
      env: { PATH: `${bin}:${dirname(process.execPath)}` },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("![x](https://github.com/user-attachments/assets/shim)\n");
  });
});
