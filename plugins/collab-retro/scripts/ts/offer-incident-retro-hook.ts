// SessionStart hook: when the user had a PR closed unmerged, or reverted a
// commit, in the last two days, print a short note suggesting an incident
// retro (collab-retro skill, incident mode, `trigger: PR closed` / `revert`).
//
// Offer only: it reads (gh, git log) and prints. It never posts, edits or
// runs the retro; the skill runs only on the user's yes.
// Fails open: gh or git missing, unauthenticated or slow means one stderr
// line (gh) or silence, and exit 0. Standalone: node builtins only.
//
// ponytail: a fixed 2-day window stands in for "already offered"; a stateful
// seen-list would stop repeat offers within the window. Upgrade path: a marker
// file keyed on PR url / commit sha.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const WINDOW_DAYS = 2;
export const TIMEOUT_MS = 5000;

export type Run = (
  cmd: string,
  args: readonly string[],
  cwd: string,
) => { readonly status: number; readonly stdout: string };

export interface Deps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdin: string;
  readonly run: Run;
  readonly now: Date;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

interface ClosedPr {
  readonly number: number;
  readonly title: string;
  readonly url: string;
}

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

const parseClosedUnmerged = (json: string): readonly ClosedPr[] => {
  const raw: unknown = JSON.parse(json);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p: unknown): ClosedPr[] => {
    if (typeof p !== "object" || p === null) return [];
    const r: Record<string, unknown> = Object.fromEntries(Object.entries(p));
    const merged = r["mergedAt"];
    const { number, title, url } = r;
    if (merged !== null && merged !== undefined && merged !== "") return [];
    return typeof number === "number" && typeof title === "string" && typeof url === "string"
      ? [{ number, title, url }]
      : [];
  });
};

export const run = (d: Deps): number => {
  if (d.env["CLAUDE_CODE_REMOTE"] === "true") return 0;
  let cwd = "";
  try {
    const input: unknown = JSON.parse(d.stdin);
    const rec: Record<string, unknown> =
      typeof input === "object" && input !== null ? Object.fromEntries(Object.entries(input)) : {};
    const c = rec["cwd"];
    cwd = typeof c === "string" ? c : "";
  } catch {
    return 0;
  }
  if (cwd === "") return 0;

  const since = isoDate(new Date(d.now.getTime() - WINDOW_DAYS * 86_400_000));
  const lines: string[] = [];

  const gh = d.run(
    "gh",
    ["pr", "list", "--author", "@me", "--state", "closed", "--search", `is:unmerged closed:>=${since}`, "--limit", "10", "--json", "number,title,url,mergedAt"],
    cwd,
  );
  if (gh.status === 0) {
    try {
      for (const p of parseClosedUnmerged(gh.stdout)) {
        lines.push(`- PR #${String(p.number)} closed unmerged (trigger: PR closed): ${p.title} ${p.url}`);
      }
    } catch {
      d.err("collab-retro: could not parse gh output; skipping PR check\n");
    }
  } else {
    d.err("collab-retro: gh unavailable or not authenticated; skipping closed-PR check\n");
  }

  const email = d.run("git", ["config", "user.email"], cwd);
  const author = email.status === 0 ? email.stdout.trim() : "";
  if (author !== "") {
    const log = d.run(
      "git",
      ["log", `--since=${since}`, "--grep=^Revert ", "--author", author, "-n", "5", "--format=%h %s"],
      cwd,
    );
    if (log.status === 0) {
      for (const l of log.stdout.split("\n").filter((x) => x !== "")) {
        lines.push(`- revert (trigger: revert): ${l}`);
      }
    }
  }

  if (lines.length === 0) return 0;
  d.out(
    `collab-retro: recent setbacks of yours:\n${lines.join("\n")}\nIf it fits, offer the user an incident retro (collab-retro skill, incident mode) with the trigger above pre-filled. Ask first; run it only on a yes.\n`,
  );
  return 0;
};

const realRun: Run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, [...args], { cwd, encoding: "utf8", timeout: TIMEOUT_MS });
  // status is null when the binary is missing or the timeout killed it.
  return { status: r.status ?? 1, stdout: r.stdout };
};

if (import.meta.main) {
  try {
    process.exitCode = run({
      env: process.env,
      stdin: readFileSync(0, "utf8"),
      run: realRun,
      now: new Date(),
      out: (t) => process.stdout.write(t),
      err: (t) => process.stderr.write(t),
    });
  } catch (e) {
    process.stderr.write(`collab-retro hook error: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 0;
  }
}
