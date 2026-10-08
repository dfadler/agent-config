// Upload local image or video files to GitHub's user-attachments endpoint and
// print ready-to-paste markdown lines. See ../../SKILL.md for the full story.
//
// Usage:
//   node upload.ts --repo OWNER/NAME FILE [FILE...]
//   node upload.ts --repo OWNER/NAME --pr N [--comment] [--heading "## Screenshots"] FILE [FILE...]
//   node upload.ts --repo OWNER/NAME --issue N [--comment] [--heading "## Screenshots"] FILE [FILE...]
//
// Default mode (no --pr/--issue): uploads each file and prints one line per
// file to stdout, in input order: "![alt](url)" for an image, a bare url for
// a video (GitHub only renders a video player from a bare URL on its own
// line; image markdown around a video URL shows a broken-image icon).
// Nothing is saved anywhere on GitHub yet, so the URLs won't resolve until a
// saved body references them (see SKILL.md). Use this mode when the files
// need to go in a specific spot in a hand-crafted body (a table, a
// particular section) rather than a simple append.
//
// --pr N / --issue N: fetches the current body, appends a heading + the
// markdown lines, and saves it back via `gh pr edit`/`gh issue edit`. Add
// --comment to post as a new comment instead of editing the body.
//
// Standalone: node builtins only (a plugin installs on its own). Exit codes
// follow the repo taxonomy: 0 ok, 1 failure, 2 usage, 4 gh/curl missing.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const USAGE = `Usage:
  upload.ts --repo OWNER/NAME FILE [FILE...]
  upload.ts --repo OWNER/NAME --pr N [--comment] [--heading "## Screenshots"] FILE [FILE...]
  upload.ts --repo OWNER/NAME --issue N [--comment] [--heading "## Screenshots"] FILE [FILE...]
`;

const MAX_ATTEMPTS = 3;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  apng: "image/apng",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

export interface ExecResult {
  /** `missing` means the command is not installed. */
  missing: boolean;
  status: number;
  stdout: string;
  stderr: string;
}

/** The effects the upload needs; injected so tests stay hermetic. */
export interface Deps {
  exec: (cmd: string, args: string[]) => ExecResult;
  sleepSeconds: (s: number) => void;
  out: (s: string) => void;
  errOut: (s: string) => void;
}

export const realDeps: Deps = {
  exec: (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const code: unknown = r.error && "code" in r.error ? r.error.code : undefined;
    return { missing: code === "ENOENT", status: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
  },
  sleepSeconds: (s) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, s * 1000);
  },
  out: (s) => process.stdout.write(s),
  errOut: (s) => process.stderr.write(s),
};

class Fail extends Error {
  readonly code: number;
  constructor(message: string, code = 1) {
    super(message);
    this.code = code;
  }
}

interface Options {
  repo: string;
  pr: string;
  issue: string;
  asComment: boolean;
  heading: string;
  files: string[];
}

const parse = (argv: string[]): Options => {
  const o: Options = { repo: "", pr: "", issue: "", asComment: false, heading: "## Screenshots", files: [] };
  const value = (i: number): string => {
    const v = argv[i + 1];
    if (v === undefined) throw new Fail(`Error: ${String(argv[i])} requires a value`, 2);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--repo") o.repo = value(i++);
    else if (a === "--pr") o.pr = value(i++);
    else if (a === "--issue") o.issue = value(i++);
    else if (a === "--heading") o.heading = value(i++);
    else if (a === "--comment") o.asComment = true;
    else if (a === "--") {
      o.files.push(...argv.slice(i + 1));
      break;
    } else if (a.startsWith("-")) throw new Fail(`Unknown flag: ${a}`, 2);
    else o.files.push(a);
  }
  if (o.repo === "") throw new Fail("Error: --repo OWNER/NAME is required", 2);
  if (o.files.length === 0) throw new Fail("Error: at least one image file is required", 2);
  if (o.pr !== "" && o.issue !== "") throw new Fail("Error: pass --pr or --issue, not both", 2);
  return o;
};

const contentTypeFor = (file: string): string => {
  const type = file.includes(".") ? CONTENT_TYPES[file.slice(file.lastIndexOf(".") + 1)] : undefined;
  if (type === undefined) {
    throw new Fail(`Error: unrecognized extension on '${file}' (expected png/jpg/jpeg/gif/webp/svg/apng/mp4/mov/webm)`);
  }
  return type;
};

// Same escaping as Python's urllib.parse.quote (safe="/"), which the shell
// version used, so the request URL is unchanged.
const quote = (s: string): string => encodeURIComponent(s).replace(/%2F/g, "/");

// Shell `$(...)` stripped trailing newlines; comparisons keep that behavior.
const stripTrailingNewlines = (s: string): string => s.replace(/\n+$/, "");

const parseUrl = (raw: string): string => {
  try {
    const j: unknown = JSON.parse(raw);
    if (typeof j === "object" && j !== null && "url" in j && typeof j.url === "string") return j.url;
  } catch {
    // Not JSON: the caller treats "" as "no url" and reports the raw text.
  }
  return "";
};

const upload = (o: Options, deps: Deps, tmp: string): void => {
  const run = (cmd: string, args: string[]): ExecResult => {
    const r = deps.exec(cmd, args);
    if (r.missing) throw new Fail(`Error: '${cmd}' not found on PATH`, 4);
    return r;
  };
  const gh = (args: string[]): ExecResult => run("gh", args);

  const tokenRes = gh(["auth", "token"]);
  if (tokenRes.status !== 0) {
    throw new Fail("Error: 'gh auth token' failed — are you logged in? (gh auth login)");
  }
  // The auth header goes through a file so the token stays out of process
  // arguments (visible to `ps aux` and similar tools).
  const authHdr = join(tmp, "auth-header");
  writeFileSync(authHdr, `Authorization: Bearer ${stripTrailingNewlines(tokenRes.stdout)}\n`, { mode: 0o600 });

  const idRes = gh(["api", `repos/${o.repo}`, "--jq", ".id"]);
  if (idRes.status !== 0) {
    throw new Fail(`Error: could not resolve repository id for '${o.repo}' — check the repo exists and you have access`);
  }
  const repoId = stripTrailingNewlines(idRes.stdout);

  const lines: string[] = [];
  for (const f of o.files) {
    if (!existsSync(f) || !statSync(f).isFile()) throw new Fail(`Error: file not found: ${f}`);
    const name = basename(f);
    const alt = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
    const ctype = contentTypeFor(f);
    const url =
      `https://uploads.github.com/user-attachments/assets?name=${quote(name)}` +
      `&content_type=${quote(ctype)}&repository_id=${repoId}`;
    const r = run("curl", ["-sS", url, "-X", "POST", "--header", `@${authHdr}`, "-H", "Accept: application/json", "--data-binary", `@${f}`]);
    if (r.status !== 0) throw new Fail(`Error: upload request failed for '${f}'`);
    const assetUrl = parseUrl(r.stdout);
    if (assetUrl === "") {
      throw new Fail(`Error: upload of '${f}' didn't return a url. Raw response: ${r.stdout}`);
    }
    // Video renders from a bare URL on its own line; `![alt](url)` gives a
    // broken-image icon since it is not img markup.
    lines.push(ctype.startsWith("video/") ? assetUrl : `![${alt}](${assetUrl})`);
    deps.errOut(`Uploaded ${f} -> ${assetUrl}\n`);
  }

  if (o.pr === "" && o.issue === "") {
    deps.out(`${lines.join("\n")}\n`);
    deps.errOut(
      "\nNote: these URLs 404 until referenced inside a body that gets saved (gh pr edit/issue edit/comment). Paste the lines above into the target body and save it, THEN the URLs will resolve.\n",
    );
    return;
  }

  const kind = o.issue === "" ? "pr" : "issue";
  const num = o.issue === "" ? o.pr : o.issue;
  const block = `${o.heading}\n\n${lines.join("\n")}`;

  if (o.asComment) {
    const r = gh([kind, "comment", num, "--repo", o.repo, "--body", block]);
    if (r.status !== 0) throw new Fail(r.stderr || `Error: gh ${kind} comment failed`);
    deps.errOut(`Posted comment on ${kind} #${num} in ${o.repo}.\n`);
    return;
  }

  // gh/GitHub expose no atomic conditional PATCH for an issue/PR body (no
  // If-Match/ETag on write), so a true compare-and-swap isn't available.
  // This is optimistic concurrency instead: read the body, then re-read it
  // immediately before writing and retry if it moved. A body-text compare is
  // used rather than `updatedAt` because GitHub's timestamp has second
  // resolution and two rapid edits can share one. A window between the final
  // check and `gh edit` still exists (gh has no way to close it), but this
  // retries rather than ever silently overwriting a changed body.
  const view = (what: string): string => {
    const r = gh([kind, "view", num, "--repo", o.repo, "--json", "body", "--jq", ".body"]);
    if (r.status !== 0) throw new Fail(`Error: could not ${what} ${kind} body`);
    return stripTrailingNewlines(r.stdout);
  };
  const done = `Appended to ${kind} #${num}'s body in ${o.repo} (this save is what makes the URLs above resolve).\n`;
  const bodyFile = join(tmp, "body.md");
  for (let attempt = 1; ; attempt++) {
    const current = view("read current");
    if (current.includes(block)) {
      // Already applied: a previous attempt's edit landed unreported.
      deps.errOut(done);
      return;
    }
    writeFileSync(bodyFile, `${current}\n\n${block}\n`);
    if (view("re-read current") === current) {
      const r = gh([kind, "edit", num, "--repo", o.repo, "--body-file", bodyFile]);
      if (r.status !== 0) throw new Fail(r.stderr || `Error: gh ${kind} edit failed`);
      deps.errOut(done);
      return;
    }
    if (attempt >= MAX_ATTEMPTS) {
      throw new Fail(
        `Error: ${kind} #${num}'s body changed concurrently ${String(MAX_ATTEMPTS)} times in a row — giving up without overwriting the newer body. Re-run the upload to retry.`,
      );
    }
    deps.sleepSeconds(1);
  }
};

export const main = (argv: string[], deps: Deps = realDeps): number => {
  if (argv.includes("-h") || argv.includes("--help")) {
    deps.out(USAGE);
    return 0;
  }
  const tmp = mkdtempSync(join(tmpdir(), "gh-attach-"));
  try {
    upload(parse(argv), deps, tmp);
    return 0;
  } catch (e) {
    if (e instanceof Fail) {
      deps.errOut(`${e.message}\n${e.code === 2 ? `\n${USAGE}` : ""}`);
      return e.code;
    }
    throw e;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
};

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
