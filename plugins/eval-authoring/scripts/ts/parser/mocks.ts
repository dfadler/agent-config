/**
 * Mock reader (#487). Used by EVAL013 and by `ScoringContext.declaredMockServers`.
 *
 * Frontmatter is read with the parser's own YAML reader, because `expect` is
 * a nested mapping in real mocks.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { isRecord, readJsonFile } from "./json-file.ts";
import { resolveCasePath } from "./paths.ts";
import type {
  Mock,
  MockCatalog,
  MockType,
  ParseIssue,
  SourceLoc,
} from "./types.ts";
import { parseYaml, splitFrontmatter, type YNode } from "./yaml.ts";

interface Front {
  /** Present when the file has a `type` key; `value` is undefined when that key is not a usable scalar. */
  readonly type:
    | { readonly value: string | undefined; readonly line: number }
    | undefined;
  readonly expect: { readonly node: YNode; readonly line: number } | undefined;
  readonly issues: readonly ParseIssue[];
}

const NO_FRONT: Front = { type: undefined, expect: undefined, issues: [] };

/** Read the `type` and `expect` keys of a mock's frontmatter. */
const readFront = (file: string, text: string): Front => {
  const split = splitFrontmatter(text);
  if (split.kind === "none") return NO_FRONT;
  if (split.kind === "unterminated") {
    return {
      ...NO_FRONT,
      issues: [
        {
          kind: "malformed-frontmatter",
          message: "frontmatter has no closing `---`",
          loc: { file, line: 1 },
        },
      ],
    };
  }
  const parsed = parseYaml(split.yaml, split.yamlLine);
  if (!parsed.ok) {
    return {
      ...NO_FRONT,
      issues: [
        {
          kind: "yaml-syntax",
          message: parsed.message,
          loc: { file, line: parsed.line, column: parsed.column },
        },
      ],
    };
  }
  const entries = parsed.value?.kind === "map" ? parsed.value.entries : [];
  const typeEntry = entries.find((e) => e.key === "type");
  const expectEntry = entries.find((e) => e.key === "expect");
  return {
    type:
      typeEntry === undefined
        ? undefined
        : {
            value:
              typeEntry.value.kind === "scalar" &&
              typeEntry.value.value !== null
                ? typeEntry.value.text
                : undefined,
            line: typeEntry.keyLine,
          },
    expect:
      expectEntry === undefined
        ? undefined
        : { node: expectEntry.value, line: expectEntry.keyLine },
    issues: [],
  };
};

/** The docs define `fixed` (the default when `type` is absent) and `agent`. */
const typeKindOf = (type: string | undefined): MockType =>
  type === undefined || type === "fixed"
    ? "fixed"
    : type === "agent"
      ? "agent"
      : "unknown";

const listDir = (dir: string): readonly string[] => {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
};

/**
 * True when `dir` holds at least one regular file (a subdirectory does not
 * count). Each entry is checked on its own, so one that vanishes between the
 * listing and the check, or a broken link, is skipped rather than thrown.
 */
const hasRecording = (dir: string): boolean =>
  listDir(dir).some((name) => {
    try {
      return statSync(join(dir, name)).isFile();
    } catch {
      return false;
    }
  });

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

interface Scan {
  readonly mocks: readonly Mock[];
  readonly issues: readonly ParseIssue[];
}

/** Read one mock file. A file that cannot be read still yields a Mock, plus an issue. */
const readMock = (
  mocksDir: string,
  server: string,
  fileName: string,
  scope: "suite" | "case",
): { readonly mock: Mock; readonly issues: readonly ParseIssue[] } => {
  const file = join(mocksDir, server, fileName);
  const tool = basename(fileName, ".md");
  const text = ((): string | ParseIssue => {
    try {
      return readFileSync(file, "utf8");
    } catch (error) {
      return {
        kind: "unreadable-file",
        message: `cannot read mock: ${error instanceof Error ? error.message : String(error)}`,
        loc: { file, line: 1 },
      };
    }
  })();
  const fm = typeof text === "string" ? readFront(file, text) : NO_FRONT;
  const type = fm.type;
  const expectValue = fm.expect;
  const loc: SourceLoc = { file, line: type?.line ?? expectValue?.line ?? 1 };
  const issues: readonly ParseIssue[] = [
    ...(typeof text === "string" ? [] : [text]),
    ...fm.issues,
  ];
  return {
    mock: {
      server,
      tool,
      file,
      type: type?.value,
      // An absent `type` is the default (`fixed`); a `type` key that is present
      // but empty or not a scalar is invalid, so `unknown`.
      typeKind:
        type !== undefined && type.value === undefined
          ? "unknown"
          : typeKindOf(type?.value),
      expect:
        expectValue === undefined
          ? undefined
          : expectValue.node.kind === "scalar"
            ? expectValue.node.text
            : "",
      ...(expectValue === undefined ? {} : { expectNode: expectValue.node }),
      // Recordings live in `mocks/.replay/<server>/`, beside the server's mocks.
      hasReplay: hasRecording(join(mocksDir, ".replay", server)),
      scope,
      loc,
    },
    issues,
  };
};

/** Every `<server>/<tool>.md` under `mocksDir`, in server then tool order. */
const scanMocks = (mocksDir: string, scope: "suite" | "case"): Scan => {
  const results = listDir(mocksDir)
    // A dot directory (`.replay`) holds recordings, not a server's mocks.
    .filter(
      (server) => !server.startsWith(".") && isDirectory(join(mocksDir, server)),
    )
    .flatMap((server) =>
      listDir(join(mocksDir, server))
        .filter((name) => name.endsWith(".md"))
        .map((name) => readMock(mocksDir, server, name, scope)),
    );
  return {
    mocks: results.map((r) => r.mock),
    issues: results.flatMap((r) => r.issues),
  };
};

const keyOf = (mock: Mock): string => `${mock.server}\u0000${mock.tool}`;

/** The case's file wins over the suite's file with the same server and tool. */
const overlay = (suite: readonly Mock[], own: readonly Mock[]): readonly Mock[] => {
  const overridden = new Set(own.map(keyOf));
  return [...suite.filter((m) => !overridden.has(keyOf(m))), ...own].sort(
    (a, b) => a.server.localeCompare(b.server) || a.tool.localeCompare(b.tool),
  );
};

/** Server names out of an MCP config value: `{ mcpServers: {...} }` or the bare map. */
const serversOf = (value: unknown): readonly string[] => {
  if (!isRecord(value)) {
    return [];
  }
  const nested = value["mcpServers"];
  return Object.keys(isRecord(nested) ? nested : value);
};

interface McpRead {
  readonly servers: readonly string[];
  readonly issues: readonly ParseIssue[];
}

/** Read an MCP config file named by the plugin; a file outside the plugin root is reported, not read. */
const readMcpFile = (pluginRoot: string, path: string, from: SourceLoc): McpRead => {
  const target = resolveCasePath(pluginRoot, path, pluginRoot);
  if (!target.insidePluginRoot) {
    return {
      servers: [],
      issues: [
        {
          kind: "wrong-type",
          message: `mcpServers path "${path}" resolves outside the plugin root`,
          loc: from,
        },
      ],
    };
  }
  const read = readJsonFile(target.resolved);
  return read.ok
    ? { servers: serversOf(read.value), issues: [] }
    : { servers: [], issues: [read.issue] };
};

/**
 * Server names from `.mcp.json` and from `mcpServers` in `plugin.json` (an
 * inline object, or a path, or a list of paths). A missing file is not an issue.
 */
const readMcpServers = (pluginRoot: string): McpRead => {
  const defaultFile = join(pluginRoot, ".mcp.json");
  const fromDefault = ((): McpRead => {
    const read = readJsonFile(defaultFile);
    if (read.ok) {
      return { servers: serversOf(read.value), issues: [] };
    }
    return { servers: [], issues: read.missing ? [] : [read.issue] };
  })();

  const manifestFile = join(pluginRoot, ".claude-plugin", "plugin.json");
  const manifest = readJsonFile(manifestFile);
  const declared =
    manifest.ok && isRecord(manifest.value)
      ? manifest.value["mcpServers"]
      : undefined;
  const loc: SourceLoc = { file: manifestFile, line: 1 };
  const fromManifest: McpRead =
    typeof declared === "string"
      ? readMcpFile(pluginRoot, declared, loc)
      : Array.isArray(declared)
        ? merge(
            declared.flatMap((p: unknown) =>
              typeof p === "string" ? [readMcpFile(pluginRoot, p, loc)] : [],
            ),
          )
        : { servers: serversOf(declared), issues: [] };

  return merge([fromDefault, fromManifest]);
};

const merge = (reads: readonly McpRead[]): McpRead => ({
  servers: [...new Set(reads.flatMap((r) => r.servers))].sort(),
  issues: reads.flatMap((r) => r.issues),
});

/**
 * `evalDir` as callers pass it: absolute, relative to `pluginRoot`, or
 * already joined onto a relative `pluginRoot` (as `EvalSuite.evalDir` is).
 * The last form is told apart by starting with the plugin root's own path.
 */
const resolveEvalDirArg = (pluginRoot: string, evalDir: string): string => {
  if (isAbsolute(evalDir)) return evalDir;
  const root = normalize(pluginRoot);
  const dir = normalize(evalDir);
  const joined = root !== "." && (dir === root || dir.startsWith(root + sep));
  return joined ? resolve(dir) : resolve(pluginRoot, evalDir);
};

/**
 * Discover `<evalDir>/mocks/<server>/<tool>.md` and, when `caseDir` is given,
 * the case's own `mocks/`, which overrides the suite's file by file. Reads the
 * `type` and `expect` frontmatter, `.replay` presence, and the plugin's MCP
 * config server list. `evalDir` may be absolute, relative to `pluginRoot`, or `EvalSuite.evalDir`
 * as returned. A mock with no `type` is `fixed`, the docs' default. Never throws.
 */
export const readMocks = (
  pluginRoot: string,
  evalDir: string,
  caseDir?: string,
): MockCatalog => {
  const suite = scanMocks(
    join(resolveEvalDirArg(pluginRoot, evalDir), "mocks"),
    "suite",
  );
  const own =
    caseDir === undefined
      ? { mocks: [], issues: [] }
      : scanMocks(join(resolve(caseDir), "mocks"), "case");
  const mcp = readMcpServers(pluginRoot);
  const mocks = overlay(suite.mocks, own.mocks);
  return {
    mocks,
    mcpServers: mcp.servers,
    declaredServers: new Set(mocks.map((m) => m.server)),
    issues: [...suite.issues, ...own.issues, ...mcp.issues],
  };
};
