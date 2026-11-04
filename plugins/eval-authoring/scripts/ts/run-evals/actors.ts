// Per-actor view of one kept `claude plugin eval` trace.jsonl: what the parent and each subagent did (#909 follow-up).
// Free and offline. Trace content is DATA: only JSON.parse and string tests, nothing in it is run.
import { readFileSync } from "node:fs";
import type { Outcome } from "./power.ts";
import { isRec, list, parse } from "./summary.ts";

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

export const USAGE = `Usage: actors.ts [-h|--help] [--json] TRACE.jsonl...

Split each trace into the parent session and its subagents: tool-call counts per
actor, subagent calls that touch an evals/ path, denied calls (with the kind of
error text), whether a check-replies.ts --probe Bash call ran successfully, and
each subagent's final report. Free, no model calls, nothing in a trace is run.

A subagent entry is any assistant/user line whose parent_tool_use_id is set.
The trace format is the CLI's internal one: a field it drops is skipped, not an error.

  --json        One JSON object per trace instead of text (full final reports).
  -h, --help    Show this message and exit.

Read this before trusting a count:
  - Only a run kept with --keep-temp has a trace.jsonl to read (without it the
    CLI deletes the sandbox first).
  - It reports what happened and decides nothing. A zero evals/ count is
    vacuous when reads were denied: look at the denied list first.
  - "Touches evals/" is a path-string test (a file_path, path or pattern of
    Read/Glob/Grep/Edit/Write, or anywhere in a Bash command, with an evals
    path segment). It can miss a path built at run time and match one that is
    only named.
  - A denial is read from a permission_denied entry or from an error result
    saying "don't ask mode", "No such tool available" or a permission denial.

Exit codes: 0 printed, 1 a trace could not be read, 2 usage error.
`;

export type DenialKind = "dont-ask-mode" | "tool-unavailable" | "permission-denied";

export interface Denial {
  readonly actor: string;
  readonly tool: string;
  readonly kind: DenialKind;
  readonly target: string;
}

export interface AgentReport {
  readonly agentId: string;
  readonly type: string | undefined;
  readonly status: string | undefined;
  readonly calls: number;
  /** The task_notification summary, else the agent's last text block; "" when neither is in the trace. */
  readonly final: string;
}

export interface Analysis {
  readonly file: string;
  readonly parentCalls: Readonly<Record<string, number>>;
  readonly subagentCalls: Readonly<Record<string, number>>;
  readonly subagentEvalsTouches: readonly string[];
  readonly denied: readonly Denial[];
  /** check-replies.ts --probe Bash calls that returned without an error, by actor. */
  readonly probeRuns: { readonly parent: number; readonly subagent: number };
  readonly agents: readonly AgentReport[];
}

interface Call {
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
  /** undefined for the parent. */
  readonly agentId: string | undefined;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
/** One line of at most `max` characters (no redaction: a trace is local, and this output is not posted). */
const clip = (s: string, max: number): string => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}... (truncated)` : flat;
};
// An evals path segment: `evals/x`, `/evals`, `"evals"`, but not `retrievals/` or `evals-old/`.
const EVALS = /(^|[/\s'"])evals(\/|$|\s|['"*])/;
const PATH_TOOLS = new Set(["Read", "Glob", "Grep", "Edit", "Write"]);

const targetOf = (c: Call): string =>
  [c.input["file_path"], c.input["pattern"], c.input["path"], c.input["command"]]
    .flatMap((v) => (typeof v === "string" ? [v] : []))
    .join(" @ ");

const touchesEvals = (c: Call): boolean =>
  PATH_TOOLS.has(c.name)
    ? ["file_path", "path", "pattern"].some((k) => EVALS.test(`${str(c.input[k]) ?? ""} `))
    : c.name === "Bash" && EVALS.test(str(c.input["command"]) ?? "");

const isProbe = (c: Call): boolean => {
  const cmd = str(c.input["command"]) ?? "";
  return c.name === "Bash" && cmd.includes("check-replies") && cmd.includes("--probe");
};

/** The text of a tool_result's content (a string, or text blocks). */
const resultText = (content: unknown): string =>
  typeof content === "string"
    ? content
    : list(content).map((b) => (isRec(b) ? (str(b["text"]) ?? "") : "")).join("");

const denialKind = (text: string): DenialKind | undefined =>
  /don't ask mode/.test(text)
    ? "dont-ask-mode"
    : /No such tool available/.test(text)
      ? "tool-unavailable"
      : /permission[^\n]{0,40}denied|denied[^\n]{0,40}permission/i.test(text)
        ? "permission-denied"
        : undefined;

const tally = (calls: readonly Call[]): Record<string, number> =>
  calls.reduce<Record<string, number>>((m, c) => ({ ...m, [c.name]: (m[c.name] ?? 0) + 1 }), {});

/** Analyze the text of one trace.jsonl (a line that is not JSON is skipped). */
export const analyzeText = (file: string, trace: string): Analysis => {
  const calls = new Map<string, Call>();
  const results = new Map<string, { readonly isError: boolean; readonly text: string }>();
  const systemDenied = new Map<string, DenialKind>(); // permission_denied entries, by tool_use_id
  const agents = new Map<string, { type: string | undefined; texts: string[] }>();
  const notes = new Map<string, { status: string | undefined; summary: string | undefined }>(); // task_notification, by task_id
  for (const line of trace.split("\n")) {
    const e = parse(line);
    if (e === undefined) continue;
    const kind = str(e["type"]);
    if (kind === "system") {
      const id = str(e["tool_use_id"]);
      if (e["subtype"] === "permission_denied" && id !== undefined) {
        systemDenied.set(id, denialKind(str(e["message"]) ?? "") ?? "permission-denied");
      } else if (e["subtype"] === "task_notification" && str(e["task_id"]) !== undefined) {
        notes.set(str(e["task_id"]) ?? "", { status: str(e["status"]), summary: str(e["summary"]) });
      } else if (e["subtype"] === "task_started" && str(e["task_id"]) !== undefined) {
        agents.set(str(e["task_id"]) ?? "", { type: str(e["subagent_type"]), texts: [] });
      }
      continue;
    }
    if (kind !== "assistant" && kind !== "user") continue;
    // A set parent_tool_use_id marks a subagent entry; null or absent is the parent.
    const sub = str(e["parent_tool_use_id"]) !== undefined;
    const agentId = sub ? (str(e["agent_id"]) ?? str(e["parent_tool_use_id"])) : undefined;
    if (agentId !== undefined && !agents.has(agentId)) agents.set(agentId, { type: str(e["subagent_type"]), texts: [] });
    const content = isRec(e["message"]) ? list(e["message"]["content"]) : [];
    for (const b of content) {
      if (!isRec(b)) continue;
      if (kind === "assistant" && b["type"] === "tool_use" && str(b["id"]) !== undefined && str(b["name"]) !== undefined) {
        calls.set(str(b["id"]) ?? "", {
          id: str(b["id"]) ?? "",
          name: str(b["name"]) ?? "",
          input: isRec(b["input"]) ? b["input"] : {},
          agentId,
        });
      } else if (kind === "assistant" && b["type"] === "text" && agentId !== undefined) {
        agents.get(agentId)?.texts.push(str(b["text"]) ?? "");
      } else if (kind === "user" && b["type"] === "tool_result" && str(b["tool_use_id"]) !== undefined) {
        results.set(str(b["tool_use_id"]) ?? "", { isError: b["is_error"] === true, text: resultText(b["content"]) });
      }
    }
  }
  const all = [...calls.values()];
  const parent = all.filter((c) => c.agentId === undefined);
  const subs = all.filter((c) => c.agentId !== undefined);
  const denied = all.flatMap((c): Denial[] => {
    const r = results.get(c.id);
    const kind = systemDenied.get(c.id) ?? (r?.isError === true ? denialKind(r.text) : undefined);
    return kind === undefined
      ? []
      : [{ actor: c.agentId === undefined ? "parent" : "subagent", tool: c.name, kind, target: clip(targetOf(c), 100) }];
  });
  const ranProbe = (c: Call): boolean => {
    const r = results.get(c.id);
    return isProbe(c) && r !== undefined && !r.isError && !systemDenied.has(c.id);
  };
  return {
    file,
    parentCalls: tally(parent),
    subagentCalls: tally(subs),
    subagentEvalsTouches: subs.filter(touchesEvals).map((c) => `${c.name} ${clip(targetOf(c), 100)}`),
    denied,
    probeRuns: { parent: parent.filter(ranProbe).length, subagent: subs.filter(ranProbe).length },
    agents: [...agents].map(([agentId, a]) => ({
      agentId,
      type: a.type,
      status: notes.get(agentId)?.status,
      calls: subs.filter((c) => c.agentId === agentId).length,
      final: notes.get(agentId)?.summary ?? a.texts.at(-1) ?? "",
    })),
  };
};

/** Analyze the trace.jsonl at `file`; throws when it cannot be read. */
export const analyze = (file: string): Analysis => analyzeText(file, readFileSync(file, "utf8"));

const countsLine = (counts: Readonly<Record<string, number>>): string =>
  Object.keys(counts).length === 0 ? "none" : Object.entries(counts).map(([k, n]) => `${k} ${String(n)}`).join(", ");

const REPORT_MAX = 400;

const render = (a: Analysis): string =>
  [
    `## ${a.file}`,
    `parent calls: ${countsLine(a.parentCalls)}`,
    `subagent calls: ${countsLine(a.subagentCalls)}`,
    `subagent calls touching evals/: ${String(a.subagentEvalsTouches.length)}${a.subagentEvalsTouches.map((t) => `\n  ${t}`).join("")}`,
    `denied calls: ${String(a.denied.length)}${a.denied.map((d) => `\n  ${d.actor} ${d.tool} [${d.kind}] ${d.target}`).join("")}`,
    `--probe runs that succeeded: parent ${String(a.probeRuns.parent)}, subagent ${String(a.probeRuns.subagent)}`,
    ...a.agents.map(
      (g) =>
        `agent ${g.type ?? g.agentId} (${g.status ?? "no notification"}, ${String(g.calls)} calls) final report: ${g.final === "" ? "(none)" : clip(g.final, REPORT_MAX)}`,
    ),
    "",
  ].join("\n");

export const main = (argv: readonly string[], readFile: (path: string) => string | undefined): Outcome => {
  if (argv.includes("-h") || argv.includes("--help")) return { code: EXIT_OK, stdout: USAGE, stderr: "" };
  const stray = argv.find((a) => a.startsWith("-") && a !== "--json");
  if (stray !== undefined) return { code: EXIT_USAGE, stdout: "", stderr: `unknown option ${stray}\n${USAGE}` };
  const files = argv.filter((a) => a !== "--json");
  if (files.length === 0) return { code: EXIT_USAGE, stdout: "", stderr: `give at least one trace.jsonl\n${USAGE}` };
  const json = argv.includes("--json");
  const unreadable = files.filter((f) => readFile(f) === undefined);
  if (unreadable.length > 0) {
    return { code: EXIT_FAILURE, stdout: "", stderr: `cannot read ${unreadable.join(", ")}\n` };
  }
  const stdout = files
    .map((f) => analyzeText(f, readFile(f) ?? ""))
    .map((a) => (json ? JSON.stringify(a) + "\n" : render(a)))
    .join("");
  return { code: EXIT_OK, stdout, stderr: "" };
};

if (import.meta.main) {
  const out = main(process.argv.slice(2), (p) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return undefined;
    }
  });
  process.stdout.write(out.stdout);
  process.stderr.write(out.stderr);
  process.exitCode = out.code;
}
