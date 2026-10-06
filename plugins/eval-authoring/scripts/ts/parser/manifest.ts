/**
 * Plugin manifest reader (#487). Reads `name`, `dependencies` (all three forms)
 * and `experimental.evals`. Used by EVAL018 and the eval-directory resolver.
 */
import { join } from "node:path";
import { isRecord, lineOf, readJsonFile } from "./json-file.ts";
import type {
  ParseIssue,
  PluginDependency,
  PluginManifest,
  SourceLoc,
} from "./types.ts";

const wrongType = (message: string, loc: SourceLoc): ParseIssue => ({
  kind: "wrong-type",
  message,
  loc,
});

type Entry =
  | { readonly dep: PluginDependency }
  | { readonly issue: ParseIssue };

/** A name string, or `name@marketplace`. A leading `@` belongs to the name, not a separator. */
const fromString = (raw: string, loc: SourceLoc): Entry => {
  const at = raw.indexOf("@", 1);
  return at === -1
    ? {
        dep: {
          name: raw,
          version: undefined,
          marketplace: undefined,
          form: "name",
          loc,
        },
      }
    : {
        dep: {
          name: raw.slice(0, at),
          version: undefined,
          marketplace: raw.slice(at + 1),
          form: "name@marketplace",
          loc,
        },
      };
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const fromObject = (
  raw: Readonly<Record<string, unknown>>,
  loc: SourceLoc,
): Entry => {
  const name = raw["name"];
  return typeof name === "string" && name !== ""
    ? {
        dep: {
          name,
          version: optionalString(raw["version"]),
          marketplace: optionalString(raw["marketplace"]),
          form: "object",
          loc,
        },
      }
    : {
        issue: wrongType(
          "dependencies entry object needs a non-empty string `name`",
          loc,
        ),
      };
};

const readEntry = (raw: unknown, loc: SourceLoc): Entry => {
  if (typeof raw === "string" && raw !== "") {
    return fromString(raw, loc);
  }
  if (isRecord(raw)) {
    return fromObject(raw, loc);
  }
  return {
    issue: wrongType(
      "dependencies entry must be a name string, `name@marketplace`, or an object",
      loc,
    ),
  };
};

const nameOf = (raw: unknown): unknown => (isRecord(raw) ? raw["name"] : raw);

/** Best-effort line for one entry: its name text after the `dependencies` key, else the key's line. */
const entryLoc = (
  file: string,
  text: string,
  raw: unknown,
  keyLine: number,
): SourceLoc => {
  const name = nameOf(raw);
  const keyAt = text.indexOf('"dependencies"');
  const line =
    typeof name === "string" && keyAt !== -1
      ? lineOf(text, JSON.stringify(name), keyAt)
      : undefined;
  return { file, line: line ?? keyLine };
};

/** Read `<pluginRoot>/.claude-plugin/plugin.json`. Never throws; problems land in `issues`. */
export const readPluginManifest = (pluginRoot: string): PluginManifest => {
  const file = join(pluginRoot, ".claude-plugin", "plugin.json");
  const empty = {
    file,
    name: undefined,
    dependencies: [],
    experimentalEvals: undefined,
  };
  const read = readJsonFile(file);
  if (!read.ok) {
    return { ...empty, issues: [read.issue] };
  }
  const { text, value } = read;
  const top: SourceLoc = { file, line: 1 };
  if (!isRecord(value)) {
    return {
      ...empty,
      issues: [wrongType("plugin.json must contain a JSON object", top)],
    };
  }

  const nameIssues =
    value["name"] !== undefined && typeof value["name"] !== "string"
      ? [wrongType("`name` must be a string", top)]
      : [];

  const experimental = value["experimental"];
  const evalsRaw = isRecord(experimental) ? experimental["evals"] : undefined;
  const evalsIssues =
    evalsRaw !== undefined && typeof evalsRaw !== "string"
      ? [wrongType("`experimental.evals` must be a string", top)]
      : [];

  const depsRaw = value["dependencies"];
  const keyLine = lineOf(text, '"dependencies"') ?? 1;
  const entries: readonly Entry[] = Array.isArray(depsRaw)
    ? depsRaw.map((raw: unknown) =>
        readEntry(raw, entryLoc(file, text, raw, keyLine)),
      )
    : [];
  const depsIssues =
    depsRaw !== undefined && !Array.isArray(depsRaw)
      ? [wrongType("`dependencies` must be an array", { file, line: keyLine })]
      : [];

  return {
    file,
    name: optionalString(value["name"]),
    dependencies: entries.flatMap((entry) =>
      "dep" in entry ? [entry.dep] : [],
    ),
    experimentalEvals: optionalString(evalsRaw),
    issues: [
      ...nameIssues,
      ...evalsIssues,
      ...depsIssues,
      ...entries.flatMap((entry) => ("issue" in entry ? [entry.issue] : [])),
    ],
  };
};
