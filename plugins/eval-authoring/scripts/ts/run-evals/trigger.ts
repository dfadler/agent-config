/**
 * The trigger table: per skill or agent of the plugin under test, how often it
 * fired where it should (fire rate) and where it should not (false-fire rate),
 * with the length of its description.
 *
 * Roles come from the grader's parameters, never its name (`skill_fired`,
 * `skill_not_fired`, `diagnose_not_fired` and `*-fires-*` all occur): a
 * `tool_used` grader on `Skill` or `Agent` with `max: 0` is must-not-fire, one
 * with `min >= 1` is fires. Which skill it is about comes from running its
 * `input_match` against each skill and agent name (`matchesCall`).
 */
import { join } from "node:path";
import { comparable } from "../diagnose/verdict.ts";
import {
  parseYaml,
  readAggregateResult,
  splitFrontmatter,
  type EvalCase,
  type EvalSuite,
} from "../parser/index.ts";
import type { Io } from "./io.ts";
import { manifestOf, matchesCall } from "./plan.ts";
import type { TriggerRow, Tally } from "./summary.ts";

export interface Routable {
  readonly name: string;
  /** Characters in the frontmatter `description`; undefined when it has none. */
  readonly descriptionChars: number | undefined;
}

/** `name` and the description length from a SKILL.md or agent file's frontmatter; the fallback name when none is given. */
const readRoutable = (text: string | undefined, fallback: string): Routable | undefined => {
  if (text === undefined) return undefined;
  const fm = splitFrontmatter(text);
  const parsed = fm.kind === "found" ? parseYaml(fm.yaml) : undefined;
  const entries = parsed?.ok === true && parsed.value?.kind === "map" ? parsed.value.entries : [];
  const scalar = (key: string): string | undefined => {
    const v = entries.find((e) => e.key === key)?.value;
    return v?.kind === "scalar" ? v.text : undefined;
  };
  const name = scalar("name");
  return {
    name: name === undefined || name === "" ? fallback : name,
    descriptionChars: scalar("description")?.length,
  };
};

/** The plugin's skills (`SKILL.md` at the root or under `skills/<name>/`) and agents (`agents/<name>.md`). */
export const routablesOf = (io: Io, pluginRoot: string): readonly Routable[] =>
  [
    readRoutable(io.readFile(join(pluginRoot, "SKILL.md")), manifestOf(pluginRoot).name),
    ...io
      .listDir(join(pluginRoot, "skills"))
      .map((d) => readRoutable(io.readFile(join(pluginRoot, "skills", d, "SKILL.md")), d)),
    ...io
      .listDir(join(pluginRoot, "agents"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => readRoutable(io.readFile(join(pluginRoot, "agents", f)), f.slice(0, -3))),
  ].filter((r): r is Routable => r !== undefined);

export type Role = "fires" | "must-not-fire";

export interface TriggerGrader {
  readonly grader: string;
  readonly role: Role;
  /** The skills or agents its pattern accepts, sorted. */
  readonly names: readonly string[];
}

/** The trigger graders of a case, classified by their parameters. */
export const triggerGraders = (
  c: EvalCase,
  routables: readonly Routable[],
  plugin: string,
): readonly TriggerGrader[] =>
  c.graders.flatMap((g): readonly TriggerGrader[] => {
    const grader = g.name.value;
    if (g.type !== "tool_used" || grader === undefined) return [];
    if (g.tool.value !== "Skill" && g.tool.value !== "Agent") return [];
    const role: Role | undefined =
      g.max.value === 0 ? "must-not-fire" : g.min.value >= 1 ? "fires" : undefined;
    const names = routables
      .map((r) => r.name)
      .filter((n) => matchesCall(g.inputMatch.value, n, plugin))
      .toSorted();
    return role === undefined || names.length === 0 ? [] : [{ grader, role, names }];
  });

/**
 * In the plugin arm of a result: the runs that gave grader `grader` of case
 * `caseName` an explicit verdict, and how many of those passed. A run that
 * errored, was stopped by a mock, skipped paid graders or scored a silent zero
 * (`comparable`, the diagnosis's own predicate) is not counted, and neither is a
 * grader result with no `passed`, so neither can pass for a fire or a false fire.
 */
export const armTally = (
  text: string | undefined,
  caseName: string,
  grader: string,
): { readonly runs: number; readonly passed: number } => {
  const read = text === undefined ? undefined : readAggregateResult(text);
  const c = read?.ok === true ? read.result.cases.find((x) => x.name === caseName) : undefined;
  const verdicts = (c?.withRuns ?? [])
    .filter((r) => comparable(r) && r.aborted !== true)
    .flatMap((r) => (r.graders ?? []).filter((g) => g.name === grader))
    .flatMap((g) => (g.passed === undefined ? [] : [g.passed]));
  return { runs: verdicts.length, passed: verdicts.filter((p) => p).length };
};

const add = (a: Tally | undefined, hit: number, runs: number): Tally => ({
  hit: (a?.hit ?? 0) + hit,
  runs: (a?.runs ?? 0) + runs,
});

/**
 * One row per skill (or per set of skills, when one pattern accepts several).
 * Fire rate counts runs that fired over `fires` graders; false-fire rate counts
 * runs that fired over `must-not-fire` graders, so a failed grader is a hit there.
 */
export const triggerRows = (
  suite: EvalSuite,
  routables: readonly Routable[],
  plugin: string,
  results: readonly { readonly caseName: string; readonly text: string | undefined }[],
): readonly TriggerRow[] => {
  const hits = results.flatMap((r) => {
    const c = suite.cases.find((x) => x.name.value === r.caseName);
    return c === undefined
      ? []
      : triggerGraders(c, routables, plugin).map((g) => ({ g, t: armTally(r.text, r.caseName, g.grader) }));
  });
  const keys = [...new Set(hits.map(({ g }) => g.names.join("|")))].toSorted();
  return keys.map((skill) => {
    const mine = hits.filter(({ g }) => g.names.join("|") === skill);
    const tally = (role: Role): Tally | undefined =>
      mine
        .filter(({ g }) => g.role === role)
        .reduce<Tally | undefined>(
          (acc, { t }) => add(acc, role === "fires" ? t.passed : t.runs - t.passed, t.runs),
          undefined,
        );
    return {
      skill,
      fires: tally("fires"),
      falseFires: tally("must-not-fire"),
      descriptionChars: skill
        .split("|")
        .map((n) => routables.find((r) => r.name === n)?.descriptionChars)
        .map((n) => (n === undefined ? "-" : String(n)))
        .join("|"),
    };
  });
};
