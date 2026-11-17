/**
 * Can this case fail? (docs/adr/0002, CONTEXT.md "Discrimination State", "Ceiling")
 *
 * One home for the vacuity checks that used to live in EVAL024, EVAL025,
 * check-replies.ts and the run summary. Pre-run (`assess`) is free and pure; post-run
 * (`atCeiling`) reads scores. Nothing here replaces the paid no-plugin baseline:
 * offline, only a `last_message` regex can be run, and only against a hand-written
 * bad reply. The module narrows what the baseline must find out.
 */
import { createContext, runInContext } from "node:vm";
import {
  isBoundaryCase,
  PROBE_TAG,
  SMOKE_TAG,
  type EvalCase,
  type Grader,
  type RegexGrader,
  type ToolUsedGrader,
} from "./parser/index.ts";

/** A case at or above this in both arms cannot tell the plugin from no plugin. */
export const CEILING = 0.95;

export type State = "can-fail" | "cannot-fail" | "unproven";
export type Exempt = "smoke" | "probe" | "trigger-boundary";
export interface Assessment {
  readonly state: State;
  readonly reason: string;
  /** The label that excuses a `cannot-fail` result. Reported, never used to hide the state. */
  readonly exempt?: Exempt;
}

/** "Must not invoke the skill": `tool_used: Skill`, `max: 0`, scored in both arms (the no-plugin arm passes it by construction). */
export const isQuietSkillCheck = (g: Grader): g is ToolUsedGrader =>
  g.type === "tool_used" && g.tool.value === "Skill" && g.max.value === 0 && g.arm.value === "both";

const MAX_PROMPT_CHARS = 20_000;
/** Hard cap on one offline regex run. A sound pattern finishes in microseconds; one that backtracks catastrophically is cut off. */
const REGEX_TIMEOUT_MS = 100;
const sandbox = createContext({});

/**
 * How many times `pattern` matches `text`, run in a vm with a hard timeout so a
 * catastrophic pattern cannot hang lint or run-evals. Undefined when it does not
 * compile or does not finish in time (unproven, never a crash or a hang).
 */
const countMatches = (pattern: string, flags: string | undefined, text: string): number | undefined => {
  const f = [...new Set(`${flags ?? ""}g`)].join("");
  Object.assign(sandbox, { p: pattern, f, t: text });
  try {
    const n: unknown = runInContext("[...t.matchAll(new RegExp(p, f))].length", sandbox, { timeout: REGEX_TIMEOUT_MS });
    return typeof n === "number" ? n : undefined;
  } catch {
    return undefined;
  }
};

/** A `last_message` regex whose pattern already matches `prompt`, so an echo of the prompt satisfies (or trips) it. */
export const echoesPrompt = (g: Grader, prompt: string): g is RegexGrader => {
  if (g.type !== "regex" || g.target.value.kind !== "last_message" || prompt.length > MAX_PROMPT_CHARS) return false;
  return (countMatches(g.pattern.value, g.flags.value, prompt) ?? 0) > 0; // invalid pattern: EVAL012's and the parser's to report
};

/** Does a regex grader pass on this reply? `contains`, `not_contains` or `count:N`. Undefined when the pattern does not compile or times out (unproven). */
export const regexPasses = (g: RegexGrader, reply: string): boolean | undefined => {
  const n = countMatches(g.pattern.value, g.flags.value, reply);
  if (n === undefined) return undefined;
  const mode = g.match.value;
  if (mode === "not_contains") return n === 0;
  const count = /^count:(\d+)$/.exec(mode);
  return count !== null ? n === Number(count[1]) : n > 0;
};

const isRunnable = (g: Grader): g is RegexGrader => g.type === "regex" && g.target.value.kind === "last_message";

/** One line per grader: `pass|FAIL|unproven <name>` for a `last_message` regex, else `not-run <name> (<type>)`. */
export const probeCase = (c: EvalCase, reply: string): readonly string[] =>
  c.graders.map((g) => {
    const name = g.name.value ?? "(unnamed)";
    if (!isRunnable(g)) return `not-run ${name} (${g.type})`;
    const ok = regexPasses(g, reply);
    return `${ok === undefined ? "unproven" : ok ? "pass" : "FAIL"} ${name}`;
  });

const exemptOf = (c: EvalCase): Exempt | undefined => {
  if (c.tags.value.includes(SMOKE_TAG)) return "smoke";
  if (c.tags.value.includes(PROBE_TAG)) return "probe";
  return isBoundaryCase(c) ? "trigger-boundary" : undefined;
};

/** A `contains` regex on the reply that already matches the prompt. */
const isCued = (g: Grader, prompt: string): boolean =>
  g.type === "regex" && g.match.value === "contains" && echoesPrompt(g, prompt);

/**
 * Pre-run state of a case. `cannot-fail` is shown two ways: every grader passes
 * without the plugin or is cued by the prompt (needs no bad reply), or the case's
 * graders are all runnable and the bad reply passes every one. `can-fail` means
 * a runnable regex fails the bad reply. Everything else is `unproven`, never "ok".
 */
export const assess = (c: EvalCase, badReply?: string): Assessment => {
  const exempt = exemptOf(c);
  const out = (state: State, reason: string): Assessment => (exempt === undefined ? { state, reason } : { state, reason, exempt });
  const prompt = c.prompt.value ?? "";
  if (c.graders.length > 0 && c.graders.every((g) => isQuietSkillCheck(g) || isCued(g, prompt))) {
    return out("cannot-fail", "every grader passes without the plugin or is cued by the prompt text");
  }
  const runnable = c.graders.filter(isRunnable);
  if (runnable.length === 0) return out("unproven", "no last_message regex to run offline; only the paid no-plugin baseline can tell");
  if (badReply === undefined || badReply.trim() === "") return out("unproven", "no # bad-reply header to run the regex graders on");
  const results = runnable.map((g) => ({ g, ok: regexPasses(g, badReply) }));
  // A `with-only` grader is never scored in the no-plugin arm, so failing the bad reply proves nothing about the baseline.
  if (results.some((r) => r.ok === false && r.g.arm.value !== "with-only")) return out("can-fail", "a regex grader fails the bad reply");
  if (results.some((r) => r.ok === false)) return out("unproven", "only an arm: with-only regex fails the bad reply; the no-plugin arm never scores it");
  if (results.some((r) => r.ok === undefined)) return out("unproven", "a regex grader does not compile or ran out of time");
  return runnable.length === c.graders.length
    ? out("cannot-fail", "the bad reply passes every grader in the case")
    : out("unproven", "the bad reply passes every regex grader; the other graders need a paid run");
};

/** Post-run: is the case at the ceiling in both arms, is that held as labelled, and did the free check already doubt it? */
export const atCeiling = (
  s: { with: number; without: number; tags: readonly string[] },
  pre?: Assessment,
  ceiling: number = CEILING, // diagnose's --near-ceiling overrides it
): { flat: boolean; held?: "smoke" | "probe"; flaggedBefore: boolean } => {
  const flat = s.with >= ceiling && s.without >= ceiling;
  const held = ([PROBE_TAG, SMOKE_TAG] as const).find((t) => s.tags.includes(t));
  return {
    flat,
    ...(held === undefined ? {} : { held }),
    flaggedBefore: pre !== undefined && pre.state !== "can-fail",
  };
};
