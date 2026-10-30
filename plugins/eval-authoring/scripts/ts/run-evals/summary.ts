/**
 * The paste-ready Markdown summary of a run, and the marked block that carries
 * it in a PR body. Pure: no I/O, so it is tested from recorded result text.
 */
import { isAbsolute } from "node:path";

export const BLOCK_START = "<!-- run-evals:start -->";
export const BLOCK_END = "<!-- run-evals:end -->";

const REPLY_MAX = 300;
const REPLACEMENT = "[REDACTED]";

/** Anything token-like, replaced before text is quoted. Conservative: a long unbroken run is redacted too. */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(api[_-]?key|token|secret|password|passwd|authorization)(\s*[:=]\s*)(?:Bearer\s+)?\S+/gi,
  /\bBearer\s+[\w.~+/=-]{8,}/gi,
  /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]*/g,
  /\b(?:sk|pk|rk)-[\w-]{16,}/g,
  /\bgh[pousr]_\w{20,}/g,
  /\bgithub_pat_\w{20,}/g,
  /\bxox[abprs]-[\w-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /[A-Za-z0-9+/_-]{32,}={0,2}/g,
];

/** Redact token-like strings (the key name of a `key=value` pair is kept). */
export const redact = (text: string): string =>
  SECRET_PATTERNS.reduce(
    (t, re) =>
      t.replace(re, (...m: string[]) =>
        re === SECRET_PATTERNS[0] ? `${m[1] ?? ""}${m[2] ?? ""}${REPLACEMENT}` : REPLACEMENT,
      ),
    text,
  );

/**
 * `home` replaced with `~` on a path boundary only (followed by `/` or the end of
 * the text, the same rule as the caffeinate exit path): `/Users/x` masks
 * `/Users/x/repo` but leaves `/Users/xavier` alone. Applied before `redact`,
 * whose long-run catch-all would otherwise eat the whole path prefix.
 */
export const maskHome = (text: string, home: string): string => {
  const bare = home.replace(/\/+$/, "");
  return bare === ""
    ? text
    : text.replace(new RegExp(`${bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=/|$)`, "g"), "~");
};

/** One line, redacted, truncated, and unable to close the code span or fake a block marker. */
export const quoteSafe = (text: string, max: number = REPLY_MAX): string => {
  const flat = redact(text)
    .replace(/\s+/g, " ")
    .replace(/`/g, "'")
    .replace(/<!--/g, "<!- -")
    .trim();
  return flat.length > max ? `${flat.slice(0, max)}... (truncated)` : flat;
};

type Rec = Readonly<Record<string, unknown>>;
export const isRec = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

export const list = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);

export const parse = (text: string | undefined): Rec | undefined => {
  if (text === undefined) return undefined;
  try {
    const j: unknown = JSON.parse(text);
    return isRec(j) ? j : undefined;
  } catch {
    return undefined;
  }
};

/** The content blocks of each assistant message in a `trace.jsonl` (stream-json lines), in order. */
const assistantContent = (trace: string | undefined): readonly (readonly unknown[])[] =>
  (trace ?? "").split("\n").map((line) => {
    const e = parse(line);
    return isRec(e) && e["type"] === "assistant" && isRec(e["message"]) ? list(e["message"]["content"]) : [];
  });

/** A run's `trace.jsonl` through `readFile`; undefined unless `tracePath` is absolute (a relative one would resolve against the cwd) and readable. */
export const traceOf = (
  run: Rec,
  readFile: (path: string) => string | undefined,
): string | undefined => {
  const p = run["tracePath"];
  return typeof p === "string" && isAbsolute(p) ? readFile(p) : undefined;
};

/** True when the trace's last non-empty line is not a JSON record: the file was cut short, so its last message may be missing. */
export const truncatedTrace = (trace: string): boolean => {
  const last = trace.split("\n").findLast((l) => l.trim() !== "");
  return last !== undefined && parse(last) === undefined;
};

/** The text of the last assistant message in a `trace.jsonl`; undefined when there is none. */
export const finalReply = (trace: string | undefined): string | undefined => {
  const texts = assistantContent(trace).flatMap((content) => {
    const t = content.flatMap((b) => (isRec(b) && b["type"] === "text" && typeof b["text"] === "string" ? [b["text"]] : []));
    return t.length > 0 ? [t.join("\n")] : [];
  });
  return texts.at(-1);
};

export interface ToolCall {
  readonly name: string;
  /** The call's input as JSON text (unredacted: quote it through `quoteSafe` or `redact`). */
  readonly input: string;
}

/** Every tool call in a `trace.jsonl`, in order. */
export const toolCalls = (trace: string | undefined): readonly ToolCall[] =>
  assistantContent(trace).flatMap((content) =>
    content.flatMap((b) =>
      isRec(b) && b["type"] === "tool_use" && typeof b["name"] === "string"
        ? [{ name: b["name"], input: JSON.stringify(b["input"] ?? null) }]
        : [],
    ),
  );

export interface FailedGrader {
  readonly run: number;
  readonly grader: string;
  readonly explanation: string | undefined;
  readonly reply: string | undefined;
}

export interface CaseRow {
  readonly caseName: string;
  readonly with: number | undefined;
  readonly without: number | undefined;
  readonly delta: number | undefined;
  /** Graders that failed in the plugin arm. */
  readonly failed: readonly FailedGrader[];
  /** Plugin-arm runs where skill_fired failed, and how many runs had that grader. */
  readonly skillMissed: number;
  readonly skillRuns: number;
}

/** Read the one case row from an invocation's `aggregate-result.json` text; undefined when unreadable. The reply of a failed run comes from its trace via `readFile`; without one it is left out. */
export const caseRow = (
  caseName: string,
  text: string | undefined,
  readFile: (path: string) => string | undefined = () => undefined,
): CaseRow | undefined => {
  const c = list(parse(text)?.["cases"]).find(
    (x) => isRec(x) && x["name"] === caseName,
  );
  if (!isRec(c)) return undefined;
  const agg = isRec(c["aggregates"]) ? c["aggregates"] : {};
  const arms = isRec(c["arms"]) ? c["arms"] : {};
  const runs = list(arms["with"]);
  const skillGraders = runs.flatMap((r) =>
    isRec(r) ? list(r["graders"]).filter((g) => isRec(g) && g["name"] === "skill_fired") : [],
  );
  return {
    skillRuns: skillGraders.length,
    skillMissed: skillGraders.filter((g) => isRec(g) && g["passed"] === false).length,
    caseName,
    with: num(agg["score"]),
    without: num(agg["scoreWithout"]),
    delta: num(agg["delta"]),
    failed: runs.flatMap((r, i) => {
      if (!isRec(r)) return [];
      const reply = finalReply(traceOf(r, readFile));
      return list(r["graders"]).flatMap((g) =>
        isRec(g) && g["passed"] === false
          ? [
              {
                run: i + 1,
                grader: typeof g["name"] === "string" ? g["name"] : "(unnamed)",
                explanation:
                  typeof g["explanation"] === "string" ? g["explanation"] : undefined,
                reply,
              },
            ]
          : [],
      );
    }),
  };
};

/** Runs that hit (fired, for a fire rate; fired anyway, for a false-fire rate) out of the runs graded. */
export interface Tally {
  readonly hit: number;
  readonly runs: number;
}

/** One skill (or set of skills one pattern accepts) in the trigger table; a side with no grader is undefined. */
export interface TriggerRow {
  readonly skill: string;
  readonly fires: Tally | undefined;
  readonly falseFires: Tally | undefined;
  /** Characters of the SKILL.md or agent description; "-" when unreadable. */
  readonly descriptionChars: string;
}

export interface SummaryInput {
  readonly plugin: string;
  readonly tier: string;
  readonly model: string;
  readonly judgeModel: string;
  readonly spentUsd: number;
  readonly ceilingUsd: number;
  readonly exit: number;
  readonly command: string;
  readonly unstarted: readonly string[];
  /** The `--neighbours` plugins loaded beside the plugin under test; undefined when the flag was off. */
  readonly neighbours?: readonly string[] | undefined;
  /** The trigger table rows; empty or undefined leaves the table out. */
  readonly trigger?: readonly TriggerRow[] | undefined;
  /** One per invocation, in run order; `row` undefined when no result could be read. */
  readonly cases: readonly {
    readonly caseName: string;
    readonly exit: number;
    readonly row: CaseRow | undefined;
  }[];
}

/** Below this many cases a suite's delta is too noisy to call (see author-cases guidance). */
export const DELTA_CASE_FLOOR = 20;

const fmt = (n: number | undefined): string => (n === undefined ? "-" : n.toFixed(2));
const cell = (s: string): string => s.replace(/\|/g, "\\|");

const rate = (t: Tally | undefined): string =>
  t === undefined || t.runs === 0
    ? "-"
    : `${String(t.hit)}/${String(t.runs)} (${(t.hit / t.runs).toFixed(2)})`;

/** The trigger section: the neighbours line (when the flag was on) and the table; empty when there is neither. */
const triggerLines = (s: SummaryInput): readonly string[] => {
  const rows = s.trigger ?? [];
  return s.neighbours === undefined && rows.length === 0
    ? []
    : [
        "",
        "### Trigger set",
        "",
        ...(s.neighbours === undefined
          ? []
          : [
              `Neighbours loaded beside \`${s.plugin}\` through each case's \`plugins:\` (a staged copy; committed cases untouched): ${s.neighbours.map((n) => `\`${n}\``).join(", ")}. Plugin arm only (\`--neighbours\` forces \`--ablation none\` whatever the tier), so there is no without arm and no delta.`,
              "",
            ]),
        ...(rows.length === 0
          ? ["No tool_used grader on Skill or Agent in the cases that ran, so there is nothing to tabulate."]
          : [
              "Plugin arm only. Fire rate: runs that fired over runs of cases that must fire. False-fire rate: runs that fired over runs of must-not-fire cases. Roles come from each grader's min and max, not its name.",
              "",
              "| skill | fire rate | false-fire rate | description chars |",
              "| --- | --- | --- | --- |",
              ...rows.map(
                (r) =>
                  `| ${cell(r.skill)} | ${rate(r.fires)} | ${rate(r.falseFires)} | ${cell(r.descriptionChars)} |`,
              ),
            ]),
      ];
};

/** The paste-ready Markdown. Heading "Eval results" is what the PR convention looks for. */
export const renderSummary = (s: SummaryInput): string => {
  const failures = s.cases.flatMap((c) => c.row?.failed.map((f) => ({ c: c.caseName, f })) ?? []);
  const unfired = s.cases.flatMap((c) =>
    c.row !== undefined && c.row.skillMissed > 0 ? [{ caseName: c.caseName, row: c.row }] : [],
  );
  // --neighbours runs the plugin arm only: no without or delta column to show.
  const oneArm = s.neighbours !== undefined;
  const showDelta = s.tier === "thorough" && !oneArm;
  const hasDelta = showDelta && s.cases.some((c) => c.row?.delta !== undefined);
  return [
    "## Eval results",
    "",
    `Tool-generated by run-evals.ts (AI-assisted session); not hand-written. Plugin \`${s.plugin}\`, tier \`${s.tier}\`, model \`${s.model}\`, judge \`${s.judgeModel}\`. Cost $${s.spentUsd.toFixed(4)} of $${String(s.ceilingUsd)} ceiling (list price). Exit ${String(s.exit)}.`,
    "",
    ...(oneArm
      ? ["| case | score | exit |", "| --- | --- | --- |"]
      : ["| case | with | without | delta | exit |", "| --- | --- | --- | --- | --- |"]),
    ...s.cases.map(
      (c) =>
        oneArm
          ? `| ${cell(c.caseName)} | ${fmt(c.row?.with)} | ${String(c.exit)}${c.row === undefined ? " (no readable result)" : ""} |`
          : `| ${cell(c.caseName)} | ${fmt(c.row?.with)} | ${fmt(c.row?.without)} | ${showDelta ? fmt(c.row?.delta) : "-"} | ${String(c.exit)}${c.row === undefined ? " (no readable result)" : ""} |`,
    ),
    ...s.unstarted.map((n) => (oneArm ? `| ${cell(n)} | not run | |` : `| ${cell(n)} | not run | | | |`)),
    ...(hasDelta && s.cases.length + s.unstarted.length < DELTA_CASE_FLOOR
      ? ["", `Delta not significant below ${String(DELTA_CASE_FLOOR)} cases (this suite has ${String(s.cases.length + s.unstarted.length)}).`]
      : []),
    ...(s.tier === "thorough" || oneArm
      ? []
      : ["", `Delta not measured at tier \`${s.tier}\`: report arm scores only, not a delta, in a PR (even marked preliminary). Re-run at \`thorough\` for a delta.`]),
    ...triggerLines(s),
    ...(unfired.length === 0
      ? []
      : [
          "",
          "Skill never fired (skill_fired is not scored, so the score can still look fine):",
          "",
          ...unfired.map(
            (c) => `- \`${c.caseName}\`: skill_fired failed in ${String(c.row.skillMissed)} of ${String(c.row.skillRuns)} runs`,
          ),
        ]),
    ...(failures.length === 0
      ? []
      : [
          "",
          "Failed graders (plugin arm):",
          "",
          ...failures.flatMap(({ c, f }) => [
            `- \`${c}\` run ${String(f.run)}, grader \`${f.grader}\`${f.explanation === undefined ? "" : `: ${quoteSafe(f.explanation)}`}`,
            ...(f.reply === undefined ? [] : [`  - reply: \`${quoteSafe(f.reply)}\``]),
          ]),
        ]),
    "",
    "Command:",
    "",
    "```",
    s.command.replace(/`/g, "'"),
    "```",
  ].join("\n");
};

/** The summary wrapped in the PR-body markers. */
export const renderBlock = (summary: string): string =>
  `${BLOCK_START}\n${summary}\n${BLOCK_END}`;

/** Replace the marked block in `body`, or append one when there is none. */
export const withBlock = (body: string, block: string): string => {
  const start = body.indexOf(BLOCK_START);
  const end = body.indexOf(BLOCK_END, start);
  return start !== -1 && end !== -1
    ? `${body.slice(0, start)}${block}${body.slice(end + BLOCK_END.length)}`
    : `${body.trimEnd()}\n\n${block}\n`;
};
