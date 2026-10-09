// Lists feedback-type auto-memory files across every Claude Code project on
// this machine, for the collab-retro skill to read and judge.
//
// Auto-memory writes one file per memory under
// ~/.claude/projects/<project-slug>/memory/*.md, each with YAML frontmatter
// including `metadata.type`. This script is the exhaustive half of the job:
// finding every feedback-type file and skipping ones already surfaced. The
// semantic judgment stays with the model reading each file.
//
// Standalone: node builtins only (a plugin installs on its own).
// Exit codes: 0 ok, 2 bad usage.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export const USAGE = `Usage: scan-feedback-memories.ts [-h|--help]

Lists this machine's feedback-type auto-memory files (metadata.type:
feedback in the file's frontmatter) across every Claude Code project,
skipping any file that already records having been surfaced as a
collab-retro issue (a line containing "Surfaced as dfadler/agent-config#").

Tab-separated output, newest first:

  <mtime-iso>\t<project-slug>\t<memory-name>\t<path>

Read each printed path directly (e.g. with the Read tool) to judge its
content; this script only locates candidates, it does not interpret them.
`;

const pad = (n: number): string => String(n).padStart(2, "0");

/** Local time as YYYY-MM-DDTHH:MM:SS, like `date -r FILE +%Y-%m-%dT%H:%M:%S`. */
export const isoLocal = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** Every .md file under a `memory/` directory anywhere below `root`. */
const memoryFiles = (root: string): string[] =>
  readdirSync(root, { withFileTypes: true }).flatMap((e) => {
    const p = join(root, e.name);
    if (e.isDirectory()) return memoryFiles(p);
    return e.isFile() && e.name.endsWith(".md") && p.includes("/memory/")
      ? [p]
      : [];
  });

/** The lines between the first and second `---` delimiter lines. */
const frontmatter = (text: string): string[] => {
  const out: string[] = [];
  let n = 0;
  for (const line of text.split("\n")) {
    if (line === "---") n++;
    else if (n === 1) out.push(line);
  }
  return out;
};

/** One output row for a memory file, or undefined when it is not a candidate. */
export const candidate = (file: string): string | undefined => {
  const text = readFileSync(file, "utf8");
  const fm = frontmatter(text);
  // Restrict the type check to the frontmatter so a "feedback" mention in
  // the body doesn't match.
  if (!fm.some((l) => /type:\s*feedback/.test(l))) return undefined;
  if (text.includes("Surfaced as dfadler/agent-config#")) return undefined;
  const nameLine = text.split("\n").find((l) => l.startsWith("name:"));
  const name = nameLine?.split(/: */)[1] ?? "";
  const project = basename(dirname(dirname(file)));
  return [isoLocal(statSync(file).mtimeMs), project, name, file].join("\t");
};

export interface Ctx {
  readonly home: string;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

export const main = (argv: readonly string[], ctx: Ctx): number => {
  if (argv[0] === "-h" || argv[0] === "--help") {
    ctx.out(USAGE);
    return 0;
  }
  if (argv.length > 0) {
    ctx.err(`error: unexpected argument: ${argv[0] ?? ""}\n${USAGE}`);
    return 2;
  }
  let files: string[];
  try {
    files = memoryFiles(join(ctx.home, ".claude", "projects"));
  } catch {
    // No project has ever written memory on this machine: not an error.
    return 0;
  }
  const rows = files.flatMap((f) => candidate(f) ?? []).sort().reverse();
  if (rows.length > 0) ctx.out(`${rows.join("\n")}\n`);
  return 0;
};

if (import.meta.main)
  process.exitCode = main(process.argv.slice(2), {
    home: homedir(),
    out: (t) => process.stdout.write(t),
    err: (t) => process.stderr.write(t),
  });
