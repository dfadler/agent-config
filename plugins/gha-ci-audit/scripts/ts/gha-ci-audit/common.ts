// Shared helpers for gha-ci-audit's GitHub API analysis scripts (TypeScript
// port of utils.py). Plugin-owned and standalone: node builtins only.
//
// Null-guard convention (issue #305): `parseDt` always guards. A falsy or
// unparseable input returns `null` rather than throwing. A caller that needs a
// duration must check both endpoints for `null` before calling
// `durationMinutes`, which does not guard.
import { readFileSync } from "node:fs";

/** The only impure surface of the CLIs: output, and reading stdin. */
export interface Io {
  readonly out: (s: string) => void;
  readonly err: (s: string) => void;
  readonly stdin: () => string;
}

export const defaultIo: Io = {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
  stdin: () => readFileSync(0, "utf8"),
};

/** Parse an ISO-8601 timestamp from the GitHub API; `null` if absent or invalid. */
export const parseDt = (s: string | null | undefined): Date | null => {
  if (s === null || s === undefined || s === "") return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Minutes between two dates. Callers must ensure neither is `null`. */
export const durationMinutes = (start: Date, end: Date): number =>
  (end.getTime() - start.getTime()) / 60000;

/** UTC timestamp ~30 days before `now`, in the `created>=` filter format. */
export const thirtyDaysAgo = (now: Date = new Date()): string =>
  new Date(now.getTime() - 30 * 86400000).toISOString().replace(/\.\d{3}Z$/, "Z");

/** A non-negative duration in minutes, or `null` if either end is missing/reversed. */
export const spanMinutes = (
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): number | null => {
  const s = parseDt(startIso);
  const e = parseDt(endIso);
  if (s === null || e === null) return null;
  const d = durationMinutes(s, e);
  return d >= 0 ? d : null;
};

export const mean = (xs: readonly number[]): number =>
  xs.reduce((a, b) => a + b, 0) / xs.length;

/** Median of a non-empty list (mean of the middle pair when even). */
export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const hi = s[mid] ?? 0;
  return s.length % 2 === 1 ? hi : ((s[mid - 1] ?? 0) + hi) / 2;
};

/** Sample standard deviation; 0 for fewer than two values. */
export const stdev = (xs: readonly number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

/** A plain object (not null/array), for narrowing parsed JSON. */
export type Json = Record<string, unknown>;
export const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Narrow unknown to a string field value, else `null`. */
export const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * A GitHub API response is either an object wrapping the list under `key`
 * (`workflow_runs`, `jobs`) or the bare list; return the list.
 */
export const unwrapList = (raw: unknown, key: string): Json[] => {
  const list = isObject(raw) ? (raw[key] ?? raw) : raw;
  return Array.isArray(list) ? list.filter(isObject) : [];
};

/** Read JSON from `file`, or from stdin when `file` is undefined. */
export const readJson = (io: Io, file?: string): unknown =>
  JSON.parse(file === undefined ? io.stdin() : readFileSync(file, "utf8"));
