/**
 * Resolve fan-out limits (#807) so the arithmetic is code, not model judgment.
 * `node limits.ts [--budget N] [--depth N] [--width N] <prompt...>` prints one JSON
 * object: the effective limits, the prompt, and the first wave's per-child budget
 * shares. Exit 0 on success, 2 with `{"error": ...}` on an invalid flag.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const FALLBACK_BUDGET = 20;
export const MAX_DEPTH = 3;
const DEFAULT_DEPTH = 2;
const DEFAULT_WIDTH = 4;

export interface Limits {
  readonly budget: number;
  readonly depth: number;
  readonly width: number;
  readonly prompt: string;
  /** Budget share for each first-wave child; sums to at most `budget - 1`. */
  readonly shares: readonly number[];
}

export type Resolved = Limits | { readonly error: string };

const WHOLE = /^\d+$/;

/** A whole number the JSON output can carry: digits only and a safe integer (no Infinity). */
const wholeNumber = (raw: string | undefined): number | undefined => {
  const n = raw !== undefined && WHOLE.test(raw) ? Number(raw) : Number.NaN;
  return Number.isSafeInteger(n) ? n : undefined;
};

/** The harness's current max sub-agent count, or the fallback when unset or not a positive whole number. */
export const envBudget = (value: string | undefined): number => {
  const n = wholeNumber(value);
  return n !== undefined && n >= 1 ? n : FALLBACK_BUDGET;
};

/** Split `total` into `count` near-equal shares (larger ones first). */
export const split = (total: number, count: number): number[] =>
  Array.from({ length: count }, (_, i) => Math.floor(total / count) + (i < total % count ? 1 : 0));

export const resolveLimits = (args: readonly string[], env: Record<string, string | undefined>): Resolved => {
  const given = new Map<string, number>();
  let i = 0;
  while (i < args.length && args[i]?.startsWith("--")) {
    const arg = args[i] ?? "";
    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    const name = flag.slice(2);
    if (name !== "budget" && name !== "depth" && name !== "width") return { error: `unknown flag ${flag}` };
    const raw = inline ?? args[++i];
    const value = wholeNumber(raw);
    if (value === undefined) return { error: `--${name} needs a whole number, got ${raw ?? "nothing"}` };
    given.set(name, value);
    i++;
  }
  const budget = given.get("budget") ?? envBudget(env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS);
  const depth = given.get("depth") ?? DEFAULT_DEPTH;
  const requestedWidth = given.get("width") ?? DEFAULT_WIDTH;
  if (budget < 1) return { error: "--budget must be at least 1" };
  if (depth > MAX_DEPTH) return { error: `--depth must be 0 to ${String(MAX_DEPTH)}` };
  if (requestedWidth < 1) return { error: "--width must be at least 1" };
  const width = Math.min(requestedWidth, Math.max(budget - 1, 1));
  // A leaf (depth 0 or budget 1) does the work itself and spawns nothing.
  const children = depth === 0 ? 0 : Math.min(width, budget - 1);
  return { budget, depth, width, prompt: args.slice(i).join(" "), shares: split(budget - 1, children) };
};

/**
 * True when this file is the entry script. Compares real paths on both sides: the skill is linked into
 * ~/.claude/skills, and `--preserve-symlinks-main` keeps the link in `import.meta.url`. An `argv[1]` that is
 * not a file (`node -e ... arg`) means we were imported.
 */
const isMain = (): boolean => {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (isMain()) {
  const out = resolveLimits(process.argv.slice(2), process.env);
  console.log(JSON.stringify(out));
  process.exit("error" in out ? 2 : 0);
}
