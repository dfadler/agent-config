/**
 * Reading eval cases: the eval directory, both case layouts and their merge.
 * Never throws on a bad case: it records what it read plus `issues`, and the
 * lint rules decide what is an error.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { getSchema } from "./schema.ts";
import { parseAllowedTool } from "./tools.ts";
import { readMocks } from "./mocks.ts";
import type {
  AllowedTool,
  CaseKey,
  CaseLayout,
  EnvEntry,
  EvalCase,
  EvalSuite,
  Field,
  FieldSpec,
  Grader,
  GraderOrigin,
  GraderTarget,
  GraderType,
  KeyOrigin,
  MockCatalog,
  ParseIssue,
  ResolvedEvalDir,
  SourceLoc,
} from "./types.ts";
import { parseYaml, splitFrontmatter, type YMap, type YNode } from "./yaml.ts";

/** Options for locating the eval directory. */
export interface EvalDirOptions {
  /** The `--eval-dir` flag value, when given; wins over the manifest. */
  readonly flag?: string;
}

// ---------------------------------------------------------------------------
// Eval directory
// ---------------------------------------------------------------------------

const validateRelativeDir = (
  raw: string,
): { readonly ok: true; readonly dir: string } | { readonly ok: false; readonly reason: string } => {
  const trimmed = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  const bad =
    trimmed === "" ||
    trimmed.startsWith("/") ||
    /^[A-Za-z]:/.test(trimmed) ||
    trimmed.includes("\\") ||
    trimmed.includes("\0") ||
    trimmed.split("/").some((s) => s === "" || s === "." || s === "..");
  return bad
    ? {
        ok: false,
        reason: `eval directory '${raw}' must be a relative path of plain directory names (no '.', '..', or absolute parts)`,
      }
    : { ok: true, dir: trimmed };
};

/** `experimental.evals` from `.claude-plugin/plugin.json`; undefined when absent or unreadable (the manifest reader reports those). */
const manifestEvalDir = (pluginRoot: string): string | undefined => {
  try {
    const doc: unknown = JSON.parse(
      readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"),
    );
    if (typeof doc !== "object" || doc === null || !("experimental" in doc)) {
      return undefined;
    }
    const exp = doc.experimental;
    if (typeof exp !== "object" || exp === null || !("evals" in exp)) {
      return undefined;
    }
    return typeof exp.evals === "string" ? exp.evals : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Resolve the eval directory: `--eval-dir`, else the manifest's
 * `experimental.evals`, else `evals/`. Only a relative path of plain directory
 * names is accepted. `dir` is relative to the plugin root. Used by the lint
 * runner, wrapper and hook.
 */
export const resolveEvalDir = (
  pluginRoot: string,
  options: EvalDirOptions = {},
): ResolvedEvalDir => {
  if (options.flag !== undefined) {
    const v = validateRelativeDir(options.flag);
    return v.ok
      ? { ok: true, dir: v.dir, source: "flag" }
      : { ok: false, reason: v.reason, source: "flag" };
  }
  const fromManifest = manifestEvalDir(pluginRoot);
  if (fromManifest !== undefined) {
    const v = validateRelativeDir(fromManifest);
    return v.ok
      ? { ok: true, dir: v.dir, source: "manifest" }
      : { ok: false, reason: v.reason, source: "manifest" };
  }
  return { ok: true, dir: getSchema().defaultEvalDir, source: "default" };
};

// ---------------------------------------------------------------------------
// Reading one case
// ---------------------------------------------------------------------------

/** A key in a case file with its value node and where it was written. */
interface Entry {
  readonly key: string;
  readonly node: YNode;
  readonly loc: SourceLoc;
}

type Lookup = (name: string) => Entry | undefined;

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};
const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const dedupeKeys = (specs: readonly FieldSpec[]): ReadonlySet<string> =>
  new Set(specs.map((s) => s.name));

const specDefault = (specs: readonly FieldSpec[], name: string): number => {
  const d = specs.find((s) => s.name === name)?.default;
  return typeof d === "number" ? d : 0;
};

const lookupIn = (entries: readonly Entry[]): Lookup => {
  const m = new Map(entries.map((e) => [e.key, e]));
  return (name) => m.get(name);
};

/** JSON-ish description of a node, for an `unknown` target. */
const describeNode = (n: YNode): string => {
  if (n.kind === "scalar") return n.text;
  if (n.kind === "seq") return `[${n.items.map(describeNode).join(", ")}]`;
  return `{ ${n.entries.map((e) => `${e.key}: ${describeNode(e.value)}`).join(", ")} }`;
};

/** Shared state while reading one case. */
interface Ctx {
  readonly issues: ParseIssue[];
  readonly keys: CaseKey[];
}

const issueAt = (
  ctx: Ctx,
  kind: ParseIssue["kind"],
  message: string,
  loc: SourceLoc,
): void => {
  ctx.issues.push({ kind, message, loc });
};

const nodeLoc = (file: string, n: { line: number; column: number }): SourceLoc => ({
  file,
  line: n.line,
  column: n.column,
});

/** Parse YAML text into a map, reporting a syntax error or a non-map root. */
const readMap = (
  ctx: Ctx,
  file: string,
  text: string,
  firstLine: number,
): YMap | undefined => {
  const parsed = parseYaml(text, firstLine);
  if (!parsed.ok) {
    issueAt(ctx, "yaml-syntax", parsed.message, nodeLoc(file, parsed));
    return undefined;
  }
  if (parsed.value === undefined) return undefined;
  if (parsed.value.kind !== "map") {
    issueAt(
      ctx,
      "wrong-type",
      "expected a mapping of keys to values",
      nodeLoc(file, parsed.value),
    );
    return undefined;
  }
  return parsed.value;
};

const entriesOf = (file: string, map: YMap | undefined): readonly Entry[] =>
  (map?.entries ?? []).map((e) => ({
    key: e.key,
    node: e.value,
    loc: { file, line: e.keyLine, column: e.keyColumn },
  }));

const readText = (ctx: Ctx, file: string): string | undefined => {
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    issueAt(
      ctx,
      "unreadable-file",
      `cannot read file: ${e instanceof Error ? e.message : String(e)}`,
      { file, line: 1 },
    );
    return undefined;
  }
};

/** Typed field readers over one key lookup. A wrong-typed value is reported and the default used. */
const makeFieldReaders = (ctx: Ctx, lookup: Lookup, defaultLoc: SourceLoc) => {
  // Reports the problem and yields the "no value" marker converters return.
  const wrong = (e: Entry, what: string): null => {
    issueAt(ctx, "wrong-type", `'${e.key}' must be ${what}`, e.loc);
    return null;
  };
  const field = <T>(
    name: string,
    convert: (e: Entry) => T | null,
    def: T,
  ): Field<T> => {
    const e = lookup(name);
    if (e === undefined) return { value: def, explicit: false, loc: defaultLoc };
    const v = convert(e);
    return { value: v === null ? def : v, explicit: true, loc: e.loc };
  };
  const asString = (e: Entry): string | null =>
    e.node.kind === "scalar" && e.node.value !== null
      ? e.node.text
      : wrong(e, "a string");
  const asNumber = (e: Entry): number | null =>
    e.node.kind === "scalar" && typeof e.node.value === "number"
      ? e.node.value
      : wrong(e, "a number");
  const asBoolean = (e: Entry): boolean | null =>
    e.node.kind === "scalar" && typeof e.node.value === "boolean"
      ? e.node.value
      : wrong(e, "true or false");
  const asStringList = (e: Entry): readonly string[] | null => {
    if (
      e.node.kind === "seq" &&
      e.node.items.every((i) => i.kind === "scalar" && i.value !== null)
    ) {
      return e.node.items.flatMap((i) => (i.kind === "scalar" ? [i.text] : []));
    }
    return wrong(e, "a list of strings");
  };
  const asTools = (e: Entry): readonly AllowedTool[] | null => {
    if (
      e.node.kind === "seq" &&
      e.node.items.every((i) => i.kind === "scalar" && i.value !== null)
    ) {
      return e.node.items.flatMap((i) =>
        i.kind === "scalar"
          ? [parseAllowedTool(i.text, nodeLoc(e.loc.file, i))]
          : [],
      );
    }
    return wrong(e, "a list of tool names");
  };
  const asEnv = (e: Entry): readonly EnvEntry[] | null => {
    if (
      e.node.kind === "map" &&
      e.node.entries.every((x) => x.value.kind === "scalar")
    ) {
      return e.node.entries.flatMap((x) =>
        x.value.kind === "scalar"
          ? [
              {
                key: x.key,
                value: x.value.text,
                loc: { file: e.loc.file, line: x.keyLine, column: x.keyColumn },
              },
            ]
          : [],
      );
    }
    return wrong(e, "a mapping of names to values");
  };
  const asTarget = (e: Entry): GraderTarget => {
    const n = e.node;
    if (n.kind === "scalar" && n.value !== null) {
      switch (n.text) {
        case "last_message":
          return { kind: "last_message" };
        case "trace":
          return { kind: "trace" };
        case "files":
          return { kind: "files" };
        case "mock_calls":
          return { kind: "mock_calls" };
        default:
          return { kind: "unknown", raw: n.text };
      }
    }
    if (n.kind === "map") {
      const source = n.entries.find((x) => x.key === "source")?.value;
      const path = n.entries.find((x) => x.key === "path")?.value;
      if (
        source?.kind === "scalar" &&
        source.text === "file" &&
        path?.kind === "scalar" &&
        path.value !== null
      ) {
        return { kind: "file", path: path.text };
      }
    }
    return { kind: "unknown", raw: describeNode(n) };
  };
  /** A tool name, or the `tool` of a `{ tool, input_match }` mapping (the `input_match` is not kept). */
  const asToolRef = (e: Entry): string | null => {
    if (e.node.kind === "scalar" && e.node.value !== null) return e.node.text;
    if (e.node.kind === "map") {
      const t = e.node.entries.find((x) => x.key === "tool")?.value;
      if (t?.kind === "scalar" && t.value !== null) return t.text;
    }
    return wrong(e, "a tool name or { tool, input_match }");
  };
  return {
    field,
    asString,
    asNumber,
    asBoolean,
    asStringList,
    asTools,
    asEnv,
    asTarget,
    asToolRef,
  };
};

const graderType = (t: string | undefined): GraderType | undefined =>
  getSchema()
    .graderTypes.map((g) => g.type)
    .find((g) => g === t);

/** Build one grader from its keys. `stem` and `body` are set for `graders/*.md` files. */
const buildGrader = (
  ctx: Ctx,
  entries: readonly Entry[],
  origin: GraderOrigin,
  stem: string | undefined,
  body: { readonly text: string; readonly line: number } | undefined,
): Grader => {
  const schema = getSchema();
  const lookup = lookupIn(entries);
  const r = makeFieldReaders(ctx, lookup, origin.loc);
  const rawType = r.field<string | undefined>("type", r.asString, undefined);
  const type = graderType(rawType.value);

  const typeKeys =
    schema.graderTypes.find((t) => t.type === type)?.keys ?? [];
  const known = dedupeKeys([...schema.graderCommonKeys, ...typeKeys]);
  entries.forEach((e) => {
    ctx.keys.push({
      name: e.key,
      origin: "grader",
      // An unknown type is EVAL003's to report; do not also flag every key.
      status: type === undefined || known.has(e.key) ? "known" : "unknown",
      loc: e.loc,
    });
  });

  const nameField: Field<string | undefined> =
    stem !== undefined && lookup("name") === undefined
      ? { value: stem, explicit: false, loc: origin.loc }
      : r.field<string | undefined>("name", r.asString, undefined);
  const base = {
    name: nameField,
    weight: r.field("weight", r.asNumber, 1),
    arm: r.field<string | undefined>("arm", r.asString, undefined),
    origin,
  };
  const criteria = (): Field<string | undefined> => {
    const written = r.field<string | undefined>("criteria", r.asString, undefined);
    if (written.explicit || body === undefined || body.text.trim() === "") {
      return written;
    }
    return {
      value: body.text,
      explicit: true,
      loc: { file: origin.file, line: body.line },
    };
  };
  const target = (name: string): Field<GraderTarget> => {
    const e = lookup(name);
    return e === undefined
      ? { value: { kind: "last_message" }, explicit: false, loc: origin.loc }
      : { value: r.asTarget(e), explicit: true, loc: e.loc };
  };

  switch (type) {
    case "regex":
      return {
        ...base,
        type,
        pattern: r.field("pattern", r.asString, ""),
        flags: r.field<string | undefined>("flags", r.asString, undefined),
        match: r.field("match", r.asString, "contains"),
        target: target("target"),
      };
    case "tool_used":
      return {
        ...base,
        type,
        tool: r.field("tool", r.asString, ""),
        inputMatch: r.field<string | undefined>("input_match", r.asString, undefined),
        min: r.field("min", r.asNumber, 1),
        max: r.field<number | undefined>("max", r.asNumber, undefined),
      };
    case "tool_order":
      return {
        ...base,
        type,
        before: r.field("before", r.asToolRef, ""),
        after: r.field("after", r.asToolRef, ""),
      };
    case "file_exists":
      return {
        ...base,
        type,
        path: r.field("path", r.asString, ""),
        exists: r.field("exists", r.asBoolean, true),
      };
    case "llm": {
      const c = criteria();
      return {
        ...base,
        type,
        criteria: { ...c, value: c.value ?? "" },
        focus: target("focus"),
      };
    }
    case "baseline":
      return {
        ...base,
        type,
        baselineFile: r.field("baseline_file", r.asString, ""),
        criteria: criteria(),
      };
    case undefined:
      return { ...base, type: "unknown", rawType };
  }
};

/**
 * Read one case directory in either layout (or both). Never throws on a bad
 * case; problems land in `EvalCase.issues`. Used by every rule.
 */
export const readCase = (caseDir: string): EvalCase => {
  const schema = getSchema();
  const ctx: Ctx = { issues: [], keys: [] };
  const dirName = basename(caseDir);

  const promptPath = join(caseDir, "prompt.md");
  const yamlPath = join(caseDir, "case.yaml");
  const gradersDir = join(caseDir, "graders");
  const promptFile = isFile(promptPath) ? promptPath : undefined;
  const caseYamlFile = isFile(yamlPath) ? yamlPath : undefined;
  const graderFiles = isDir(gradersDir)
    ? readdirSync(gradersDir)
        .filter((f) => f.endsWith(".md") && isFile(join(gradersDir, f)))
        .sort()
        .map((f) => join(gradersDir, f))
    : [];
  const layout: CaseLayout =
    promptFile !== undefined && caseYamlFile !== undefined
      ? "mixed"
      : caseYamlFile !== undefined
        ? "case-yaml"
        : "prompt-md";
  const primary = promptFile ?? caseYamlFile ?? graderFiles[0] ?? caseDir;
  const defaultLoc: SourceLoc = { file: primary, line: 1 };
  if (promptFile === undefined && caseYamlFile === undefined) {
    issueAt(
      ctx,
      "unreadable-file",
      "case directory has neither prompt.md nor case.yaml",
      { file: caseDir, line: 1 },
    );
  }

  // --- prompt.md
  const promptKnown = dedupeKeys(schema.promptMdKeys);
  const promptText =
    promptFile === undefined ? undefined : readText(ctx, promptFile);
  const promptSplit =
    promptText === undefined ? undefined : splitFrontmatter(promptText);
  if (promptFile !== undefined && promptSplit?.kind === "unterminated") {
    issueAt(
      ctx,
      "malformed-frontmatter",
      "frontmatter opens with '---' but never closes",
      { file: promptFile, line: 1 },
    );
  }
  const promptEntries: readonly Entry[] =
    promptFile !== undefined && promptSplit?.kind === "found"
      ? entriesOf(
          promptFile,
          readMap(ctx, promptFile, promptSplit.yaml, promptSplit.yamlLine),
        )
      : [];
  promptEntries.forEach((e) => {
    ctx.keys.push({
      name: e.key,
      origin: "prompt.md",
      status: promptKnown.has(e.key) ? "known" : "unknown",
      loc: e.loc,
    });
  });
  const promptBody =
    promptSplit?.kind === "found" || promptSplit?.kind === "none"
      ? { text: promptSplit.body, line: promptSplit.bodyLine }
      : undefined;

  // --- case.yaml
  const yamlText =
    caseYamlFile === undefined ? undefined : readText(ctx, caseYamlFile);
  const yamlMap =
    caseYamlFile !== undefined && yamlText !== undefined
      ? readMap(ctx, caseYamlFile, yamlText, 1)
      : undefined;
  const topEntries = caseYamlFile === undefined ? [] : entriesOf(caseYamlFile, yamlMap);
  const topSpecs = schema.caseYamlTopLevelKeys;
  const execKeys = dedupeKeys(schema.caseYamlExecutionKeys);
  const ctxKeys = dedupeKeys(schema.caseYamlContextKeys);
  const topKnown = dedupeKeys(topSpecs);
  const nested = (name: string): readonly Entry[] => {
    const e = topEntries.find((x) => x.key === name);
    if (e === undefined) return [];
    if (e.node.kind !== "map") {
      if (!(e.node.kind === "scalar" && e.node.value === null)) {
        issueAt(ctx, "wrong-type", `'${name}' must be a mapping`, e.loc);
      }
      return [];
    }
    return entriesOf(e.loc.file, e.node);
  };
  const execEntries = nested("execution");
  const contextEntries = nested("context");

  const classify = (
    entries: readonly Entry[],
    origin: KeyOrigin,
    here: ReadonlySet<string>,
  ): void => {
    entries.forEach((e) => {
      if (here.has(e.key)) {
        ctx.keys.push({ name: e.key, origin, status: "known", loc: e.loc });
        return;
      }
      const home: KeyOrigin | undefined = execKeys.has(e.key)
        ? "case.yaml:execution"
        : ctxKeys.has(e.key)
          ? "case.yaml:context"
          : topKnown.has(e.key)
            ? "case.yaml"
            : undefined;
      ctx.keys.push(
        home === undefined
          ? { name: e.key, origin, status: "unknown", loc: e.loc }
          : {
              name: e.key,
              origin,
              status: "misplaced",
              belongsUnder: home,
              loc: e.loc,
            },
      );
    });
  };
  classify(topEntries, "case.yaml", topKnown);
  classify(execEntries, "case.yaml:execution", execKeys);
  classify(contextEntries, "case.yaml:context", ctxKeys);

  // Only keys that sit where the CLI reads them count toward values.
  const yamlLayer = lookupIn([
    ...topEntries.filter(
      (e) => topKnown.has(e.key) && !["execution", "context", "graders"].includes(e.key),
    ),
    ...execEntries.filter((e) => execKeys.has(e.key)),
    ...contextEntries.filter((e) => ctxKeys.has(e.key)),
  ]);
  const promptLayer = lookupIn(
    promptEntries.filter((e) => promptKnown.has(e.key) && e.key !== "schema_version"),
  );
  // prompt.md frontmatter overrides matching case.yaml fields.
  const lookup: Lookup = (name) => promptLayer(name) ?? yamlLayer(name);
  const r = makeFieldReaders(ctx, lookup, defaultLoc);

  const topSpecList = schema.promptMdKeys;
  const schemaVersion = makeFieldReaders(ctx, yamlLayer, defaultLoc).field<
    string | undefined
  >("schema_version", r.asString, undefined);

  const prompt: Field<string | undefined> =
    promptBody !== undefined
      ? {
          value: promptBody.text,
          explicit: true,
          loc: { file: promptFile ?? primary, line: promptBody.line },
        }
      : r.field<string | undefined>("prompt", r.asString, undefined);

  // --- graders: case.yaml first, then graders/*.md in name order
  const gradersEntry = topEntries.find((e) => e.key === "graders");
  const yamlGraders: readonly Grader[] = (() => {
    if (gradersEntry === undefined) return [];
    if (gradersEntry.node.kind !== "seq") {
      if (!(gradersEntry.node.kind === "scalar" && gradersEntry.node.value === null)) {
        issueAt(ctx, "wrong-type", "'graders' must be a list", gradersEntry.loc);
      }
      return [];
    }
    return gradersEntry.node.items.flatMap((item, i) => {
      const file = gradersEntry.loc.file;
      if (item.kind !== "map") {
        issueAt(ctx, "wrong-type", "a grader must be a mapping", nodeLoc(file, item));
        return [];
      }
      const origin: GraderOrigin = {
        source: "case.yaml",
        file,
        index: i,
        loc: nodeLoc(file, item),
      };
      return [buildGrader(ctx, entriesOf(file, item), origin, undefined, undefined)];
    });
  })();
  const mdGraders: readonly Grader[] = graderFiles.flatMap((file, i) => {
    const text = readText(ctx, file);
    if (text === undefined) return [];
    const split = splitFrontmatter(text);
    if (split.kind === "unterminated") {
      issueAt(
        ctx,
        "malformed-frontmatter",
        "frontmatter opens with '---' but never closes",
        { file, line: 1 },
      );
      return [];
    }
    const entries =
      split.kind === "found"
        ? entriesOf(file, readMap(ctx, file, split.yaml, split.yamlLine))
        : [];
    const origin: GraderOrigin = {
      source: "graders-md",
      file,
      index: yamlGraders.length + i,
      loc: { file, line: 1 },
    };
    return [
      buildGrader(
        ctx,
        entries,
        origin,
        basename(file, ".md"),
        { text: split.body, line: split.kind === "found" ? split.bodyLine : 1 },
      ),
    ];
  });

  return {
    dir: caseDir,
    dirName,
    layout,
    promptFile,
    caseYamlFile,
    graderFiles,
    schemaVersion,
    name: r.field("name", r.asString, dirName),
    description: r.field<string | undefined>("description", r.asString, undefined),
    tags: r.field<readonly string[]>("tags", r.asStringList, []),
    plugins: r.field<readonly string[]>("plugins", r.asStringList, []),
    expectedOutcome: r.field<string | undefined>("expected_outcome", r.asString, undefined),
    runs: r.field("runs", r.asNumber, specDefault(topSpecList, "runs")),
    prompt,
    model: r.field<string | undefined>("model", r.asString, undefined),
    maxTurns: r.field("max_turns", r.asNumber, specDefault(topSpecList, "max_turns")),
    timeoutSeconds: r.field(
      "timeout_seconds",
      r.asNumber,
      specDefault(topSpecList, "timeout_seconds"),
    ),
    allowedTools: r.field<readonly AllowedTool[]>("allowed_tools", r.asTools, []),
    appendSystemPrompt: r.field<string | undefined>(
      "append_system_prompt",
      r.asString,
      undefined,
    ),
    env: r.field<readonly EnvEntry[]>("env", r.asEnv, []),
    scaffoldScript: r.field<string | undefined>("scaffold_script", r.asString, undefined),
    historyFile: r.field<string | undefined>("history_file", r.asString, undefined),
    addDirs: r.field<readonly string[]>("add_dirs", r.asStringList, []),
    graders: [...yamlGraders, ...mdGraders],
    keys: ctx.keys,
    issues: ctx.issues,
  };
};

// ---------------------------------------------------------------------------
// Reading a suite
// ---------------------------------------------------------------------------

const emptyCatalog: MockCatalog = {
  mocks: [],
  mcpServers: [],
  declaredServers: new Set(),
  issues: [],
};

const looksLikeCase = (dir: string): boolean =>
  isFile(join(dir, "prompt.md")) ||
  isFile(join(dir, "case.yaml")) ||
  isDir(join(dir, "graders"));

/**
 * Read every case under the resolved eval directory, plus suite mocks. Used by
 * the lint runner. `ResolvedEvalDir.dir` is relative to the plugin root;
 * `EvalSuite.evalDir` is that joined onto `pluginRoot` (absolute when
 * `pluginRoot` is), so it is directly readable.
 */
export const readSuite = (
  pluginRoot: string,
  options: EvalDirOptions = {},
): EvalSuite => {
  const resolved = resolveEvalDir(pluginRoot, options);
  if (!resolved.ok) {
    return {
      pluginRoot,
      evalDir: join(pluginRoot, getSchema().defaultEvalDir),
      cases: [],
      mocks: emptyCatalog,
      issues: [
        {
          kind: "wrong-type",
          message: resolved.reason,
          loc: { file: pluginRoot, line: 1 },
        },
      ],
    };
  }
  const evalDir = join(pluginRoot, resolved.dir);
  const caseDirs = existsSync(evalDir)
    ? readdirSync(evalDir)
        .filter((n) => !n.startsWith("."))
        .sort()
        .map((n) => join(evalDir, n))
        .filter((p) => isDir(p) && looksLikeCase(p))
    : [];
  // TODO(#487): drop the fallback once the mock reader is implemented; until
  // then its stub throws and a suite still has to be readable.
  const mocks = ((): MockCatalog => {
    try {
      return readMocks(pluginRoot, evalDir);
    } catch {
      return emptyCatalog;
    }
  })();
  return {
    pluginRoot,
    evalDir,
    cases: caseDirs.map(readCase),
    mocks,
    issues: [],
  };
};
