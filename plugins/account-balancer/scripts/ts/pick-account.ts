import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

// Reads each Claude account's plan usage by running `claude -p "/usage"` under that
// account's CLAUDE_CONFIG_DIR (no model call), then ranks the accounts by how much
// budget they have per hour until their weekly window resets.
//
// Usage: node pick-account.ts [--json] <label=dir | label=default> ...

export interface Window {
  label: string;
  percentUsed: number;
  resets: string;
}

export interface Account {
  name: string;
  status: "ok" | "unavailable";
  windows: Window[];
  /** Hours until the weekly all-models window resets; null if unparsed. */
  hoursToReset: number | null;
  /** Percent of the weekly all-models budget left; null if unavailable. */
  budgetLeft: number | null;
  /** Budget left per hour to reset: higher means more use-it-or-lose-it pressure. */
  ratePerHour: number | null;
}

const WINDOW = /^Current ([^:\n]+): (\d+)% used · resets (.+)$/gm;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKLY = "week (all models)";

export const parseUsage = (text: string): Window[] =>
  [...text.matchAll(WINDOW)].map(([, label = "", pct = "0", resets = ""]) => ({
    label,
    percentUsed: Number(pct),
    resets: resets.trim(),
  }));

// Offset (ms) of `tz` from UTC at the instant `at`.
const tzOffset = (at: number, tz: string): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(at));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - at;
};

/** Parses "Nov 8 at 6pm (America/Chicago)" or "6:30pm (tz)"; null if the shape is unknown. */
export const parseReset = (s: string, now: Date): Date | null => {
  const m = /^(?:([A-Za-z]{3})[a-z]* (\d{1,2}),? (?:at )?)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)(?: \(([^)]+)\))?$/i.exec(
    s.trim(),
  );
  if (!m) return null;
  const tz = m[6] ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  let hour = Number(m[3]) % 12;
  if ((m[5] ?? "").toLowerCase() === "pm") hour += 12;
  const minute = Number(m[4] ?? 0);
  try {
    const wall = (y: number, mo: number, d: number) => {
      const guess = Date.UTC(y, mo, d, hour, minute);
      // Two passes settle the offset across a DST change.
      let t = guess - tzOffset(guess, tz);
      t = guess - tzOffset(t, tz);
      return t;
    };
    const nowWall = new Date(now.getTime() + tzOffset(now.getTime(), tz));
    const y = nowWall.getUTCFullYear();
    if (m[1] !== undefined) {
      const mo = MONTHS.indexOf(m[1].toLowerCase());
      if (mo < 0) return null;
      let t = wall(y, mo, Number(m[2]));
      if (t < now.getTime() - 24 * 3600e3) t = wall(y + 1, mo, Number(m[2]));
      return new Date(t);
    }
    let t = wall(y, nowWall.getUTCMonth(), nowWall.getUTCDate());
    // Next local calendar day, not +24h, so a DST change does not shift the reset hour.
    if (t <= now.getTime()) t = wall(y, nowWall.getUTCMonth(), nowWall.getUTCDate() + 1);
    return new Date(t);
  } catch {
    return null; // unknown time zone name
  }
};

export const summarize = (name: string, output: string, now: Date): Account => {
  const windows = parseUsage(output);
  const weekly = windows.find((w) => w.label.toLowerCase() === WEEKLY);
  const none = { hoursToReset: null, budgetLeft: null, ratePerHour: null };
  if (!weekly) return { name, status: "unavailable", windows, ...none };
  const at = parseReset(weekly.resets, now);
  const hours = at ? Math.max((at.getTime() - now.getTime()) / 3600e3, 0.25) : null;
  const left = Math.max(100 - weekly.percentUsed, 0);
  return {
    name,
    status: "ok",
    windows,
    hoursToReset: hours === null ? null : Math.round(hours * 10) / 10,
    budgetLeft: left,
    ratePerHour: hours === null ? null : Math.round((left / hours) * 100) / 100,
  };
};

// A readable account whose reset time did not parse has no rate; count it as 0 so it still
// outranks an exhausted account (the budget tiebreak below), and `format` warns about it.
const key = (a: Account): number => a.ratePerHour ?? (a.status === "ok" ? 0 : -1);

/** Most use-it-or-lose-it pressure first; accounts we could not read go last. */
export const rank = (accounts: Account[]): Account[] =>
  [...accounts].sort(
    (a, b) => key(b) - key(a) || (b.budgetLeft ?? -1) - (a.budgetLeft ?? -1),
  );

export const format = (ranked: Account[]): string => {
  const num = (x: number | null) => (x === null ? "?" : String(x));
  const lines = ranked.map((a, i) =>
    a.status === "ok"
      ? `${String(i + 1)}. ${a.name}: ${num(a.budgetLeft)}% left, resets in ${num(a.hoursToReset)}h, ${num(a.ratePerHour)}%/h`
      : `${String(i + 1)}. ${a.name}: unavailable (claude not on PATH, not logged in, or /usage output not recognized)`,
  );
  for (const a of ranked)
    if (a.status === "ok" && a.hoursToReset === null)
      lines.push(`note: reset time for ${a.name} was not recognized, so the ranking is inconclusive`);
  return lines.join("\n");
};

export interface Deps {
  now: Date;
  probe: (dir: string | null) => string;
  out: (t: string) => void;
}

export const run = (args: string[], d: Deps): number => {
  const json = args.includes("--json");
  const specs = args.filter((a) => a !== "--json");
  if (specs.length === 0 || specs.some((s) => !/^[^=]+=.+$/.test(s))) {
    d.out("usage: pick-account.ts [--json] <label=dir | label=default> ...\n");
    return 2;
  }
  const accounts = specs.map((s) => {
    const i = s.indexOf("=");
    const dir = s.slice(i + 1);
    return summarize(s.slice(0, i), d.probe(dir === "default" ? null : dir), d.now);
  });
  const ranked = rank(accounts);
  d.out(json ? `${JSON.stringify(ranked, null, 2)}\n` : `${format(ranked)}\n`);
  return ranked.some((a) => a.status === "ok") ? 0 : 1;
};

const realDeps = (): Deps => ({
  now: new Date(),
  probe: (dir) => {
    const env = { ...process.env };
    if (dir === null) delete env["CLAUDE_CONFIG_DIR"];
    else env["CLAUDE_CONFIG_DIR"] = dir.replace(/^~(?=\/)/, homedir());
    const r = spawnSync("claude", ["-p", "/usage"], { encoding: "utf8", env, timeout: 60_000 });
    // A missing `claude` or a timeout sets r.error; stdout is then null or partial.
    return r.error ? "" : r.stdout;
  },
  out: (t) => process.stdout.write(t),
});

if (import.meta.main) process.exitCode = run(process.argv.slice(2), realDeps());
