/**
 * The paste-ready Markdown summary of a run, and the marked block that carries
 * it in a PR body. Pure: no I/O, so it is tested from recorded result text.
 */

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
const isRec = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

const list = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);

const parse = (text: string | undefined): Rec | undefined => {
  if (text === undefined) return undefined;
  try {
    const j: unknown = JSON.parse(text);
    return isRec(j) ? j : undefined;
  } catch {
    return undefined;
  }
};

/** The text of the last assistant message in a `trace.jsonl` (stream-json lines); undefined when there is none. */
export const finalReply = (trace: string | undefined): string | undefined => {
  const texts = (trace ?? "").split("\n").flatMap((line) => {
    const e = parse(line);
    const content = isRec(e) && e["type"] === "assistant" && isRec(e["message"]) ? list(e["message"]["content"]) : [];
    const t = content.flatMap((b) => (isRec(b) && b["type"] === "text" && typeof b["text"] === "string" ? [b["text"]] : []));
    return t.length > 0 ? [t.join("\n")] : [];
  });
  return texts.at(-1);
};

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
      const tracePath = r["tracePath"];
      const reply = typeof tracePath === "string" ? finalReply(readFile(tracePath)) : undefined;
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

/** The paste-ready Markdown. Heading "Eval results" is what the PR convention looks for. */
export const renderSummary = (s: SummaryInput): string => {
  const failures = s.cases.flatMap((c) => c.row?.failed.map((f) => ({ c: c.caseName, f })) ?? []);
  const unfired = s.cases.flatMap((c) =>
    c.row !== undefined && c.row.skillMissed > 0 ? [{ caseName: c.caseName, row: c.row }] : [],
  );
  const hasDelta = s.cases.some((c) => c.row?.delta !== undefined);
  return [
    "## Eval results",
    "",
    `Tool-generated by run-evals.ts (AI-assisted session); not hand-written. Plugin \`${s.plugin}\`, tier \`${s.tier}\`, model \`${s.model}\`, judge \`${s.judgeModel}\`. Cost $${s.spentUsd.toFixed(4)} of $${String(s.ceilingUsd)} ceiling (list price). Exit ${String(s.exit)}.`,
    "",
    "| case | with | without | delta | exit |",
    "| --- | --- | --- | --- | --- |",
    ...s.cases.map(
      (c) =>
        `| ${cell(c.caseName)} | ${fmt(c.row?.with)} | ${fmt(c.row?.without)} | ${fmt(c.row?.delta)} | ${String(c.exit)}${c.row === undefined ? " (no readable result)" : ""} |`,
    ),
    ...s.unstarted.map((n) => `| ${cell(n)} | not run | | | |`),
    ...(hasDelta && s.cases.length + s.unstarted.length < DELTA_CASE_FLOOR
      ? ["", `Delta not significant below ${String(DELTA_CASE_FLOOR)} cases (this suite has ${String(s.cases.length + s.unstarted.length)}).`]
      : []),
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
