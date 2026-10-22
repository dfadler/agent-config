/**
 * Offline check (#763): run each case's free `regex` graders on `last_message`
 * against the reference-good and known-bad replies written in the case.yaml
 * header, with no model call. `node check-replies.ts [--require] [PLUGIN_ROOT]`.
 *
 * Header convention (comment lines before the first key; continuation lines
 * are comments indented by two or more spaces):
 *   # good-reply: <text>
 *   # bad-reply: <text>
 *
 * Every regex grader must pass the good reply and at least one must fail the
 * bad one. `llm` graders cannot be run offline: a case with only those is
 * reported "unchecked". A case with an `llm` grader and no header replies is
 * reported "missing"; that is an error only with --require.
 */
import { readFileSync } from "node:fs";
import { readSuite, type EvalCase, type RegexGrader } from "./parser/index.ts";

export interface Replies {
  readonly good: string | undefined;
  readonly bad: string | undefined;
}

/** Read `good-reply:` and `bad-reply:` from the leading comment block. */
export const headerReplies = (yaml: string): Replies => {
  const found = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of yaml.split("\n")) {
    if (!line.startsWith("#")) break;
    const m = /^# (good|bad)-reply:\s?(.*)$/.exec(line);
    if (m !== null) {
      current = m[2] === "" ? [] : [m[2] ?? ""];
      found.set(m[1] ?? "", current);
    } else if (current !== undefined && line.startsWith("#  ")) {
      current.push(line.slice(3).trim());
    } else {
      current = undefined;
    }
  }
  const text = (k: string): string | undefined => found.get(k)?.join("\n");
  return { good: text("good"), bad: text("bad") };
};

/** Does a regex grader pass on this reply? `contains`, `not_contains` or `count:N`. */
export const regexPasses = (g: RegexGrader, reply: string): boolean => {
  const flags = [...new Set(`${g.flags.value ?? ""}g`)].join("");
  const n = [...reply.matchAll(new RegExp(g.pattern.value, flags))].length;
  const mode = g.match.value;
  if (mode === "not_contains") return n === 0;
  const count = /^count:(\d+)$/.exec(mode);
  return count !== null ? n === Number(count[1]) : n > 0;
};

export type Status = "ok" | "unchecked" | "missing" | "fail" | "skipped";
export interface CaseReport {
  readonly name: string;
  readonly status: Status;
  readonly detail: string;
}

const regexGraders = (c: EvalCase): readonly RegexGrader[] =>
  c.graders.filter(
    (g): g is RegexGrader => g.type === "regex" && g.target.value.kind === "last_message",
  );

export const checkCase = (c: EvalCase, replies: Replies): CaseReport => {
  const name = c.dirName;
  const hasLlm = c.graders.some((g) => g.type === "llm" || g.type === "baseline");
  const { good, bad } = replies;
  if (good === undefined && bad === undefined) {
    return hasLlm
      ? { name, status: "missing", detail: "no good-reply/bad-reply in the header" }
      : { name, status: "skipped", detail: "no llm grader" };
  }
  if (good === undefined || bad === undefined) {
    return { name, status: "missing", detail: `header lacks ${good === undefined ? "good" : "bad"}-reply` };
  }
  const regexes = regexGraders(c);
  const failsGood = regexes.filter((g) => !regexPasses(g, good)).map((g) => g.name.value ?? "(unnamed)");
  if (failsGood.length > 0) {
    return { name, status: "fail", detail: `good-reply fails: ${failsGood.join(", ")}` };
  }
  if (regexes.length === 0) {
    return { name, status: "unchecked", detail: "no regex grader on last_message; judge graders need a paid run" };
  }
  if (regexes.every((g) => regexPasses(g, bad))) {
    return { name, status: "fail", detail: "no regex grader fails the bad-reply" };
  }
  return { name, status: "ok", detail: "good passes, bad fails" };
};

export const checkPlugin = (pluginRoot: string): readonly CaseReport[] =>
  readSuite(pluginRoot).cases.map((c) => {
    const file = c.caseYamlFile;
    return checkCase(c, headerReplies(file === undefined ? "" : readFileSync(file, "utf8")));
  });

/** Exit 1 on a `fail`, or on `missing` when `require` is set. */
export const exitCode = (reports: readonly CaseReport[], require: boolean): number =>
  reports.some((r) => r.status === "fail" || (require && r.status === "missing")) ? 1 : 0;

if (import.meta.main) {
  const args = process.argv.slice(2);
  const require = args.includes("--require");
  const root = args.find((a) => !a.startsWith("--")) ?? ".";
  const reports = checkPlugin(root);
  for (const r of reports) {
    if (r.status !== "skipped") process.stdout.write(`${r.status.padEnd(9)} ${r.name}: ${r.detail}\n`);
  }
  process.exitCode = exitCode(reports, require);
}
