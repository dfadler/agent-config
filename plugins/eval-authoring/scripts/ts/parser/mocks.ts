/**
 * Mock reader (#487). Used by EVAL013 and by `ScoringContext.declaredMockServers`.
 *
 * Frontmatter is read with a small flat `key: value` reader rather than a YAML
 * library: a mock only needs the scalar `type` and `expect` keys, and this keeps
 * the helper free of a dependency the parser core (#452) may choose differently.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { isRecord, readJsonFile } from "./json-file.ts";
import { resolveCasePath } from "./paths.ts";
import type {
  Mock,
  MockCatalog,
  MockType,
  ParseIssue,
  SourceLoc,
} from "./types.ts";

interface Frontmatter {
  readonly values: ReadonlyMap<string, { readonly value: string; readonly line: number }>;
  readonly issue: string | undefined;
}

const NO_FRONTMATTER: Frontmatter = { values: new Map(), issue: undefined };

const unquote = (raw: string): string => {
  const trimmed = raw.trim();
  const quoted = /^(["'])(.*)\1$/.exec(trimmed);
  return quoted?.[2] ?? trimmed.replace(/\s+#.*$/, "");
};

/** Parse a leading `---` block of flat `key: value` lines. */
const parseFrontmatter = (text: string): Frontmatter => {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return NO_FRONTMATTER;
  }
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end === -1) {
    return { values: new Map(), issue: "frontmatter has no closing `---`" };
  }
  const entries = lines.slice(1, end).flatMap((line, i) => {
    const match = /^([A-Za-z_][\w-]*)\s*:(.*)$/.exec(line);
    return match?.[1] === undefined
      ? []
      : [
          [
            match[1],
            { value: unquote(match[2] ?? ""), line: i + 2 },
          ] as const,
        ];
  });
  return { values: new Map(entries), issue: undefined };
};

const typeKindOf = (type: string | undefined): MockType =>
  type === "agent" || type === "script" || type === "static" ? type : "unknown";

const listDir = (dir: string): readonly string[] => {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
};

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
  const fm = typeof text === "string" ? parseFrontmatter(text) : NO_FRONTMATTER;
  const type = fm.values.get("type");
  const expectValue = fm.values.get("expect");
  const loc: SourceLoc = { file, line: type?.line ?? expectValue?.line ?? 1 };
  const issues: readonly ParseIssue[] = [
    ...(typeof text === "string" ? [] : [text]),
    ...(fm.issue === undefined
      ? []
      : [
          {
            kind: "malformed-frontmatter" as const,
            message: fm.issue,
            loc: { file, line: 1 },
          },
        ]),
  ];
  return {
    mock: {
      server,
      tool,
      file,
      type: type?.value,
      typeKind: typeKindOf(type?.value),
      expect: expectValue?.value,
      hasReplay: existsSync(join(mocksDir, server, `${tool}.replay`)),
      scope,
      loc,
    },
    issues,
  };
};

/** Every `<server>/<tool>.md` under `mocksDir`, in server then tool order. */
const scanMocks = (mocksDir: string, scope: "suite" | "case"): Scan => {
  const results = listDir(mocksDir)
    .filter((server) => isDirectory(join(mocksDir, server)))
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
 * Discover `<evalDir>/mocks/<server>/<tool>.md` and, when `caseDir` is given,
 * the case's own `mocks/`, which overrides the suite's file by file. Reads the
 * `type` and `expect` frontmatter, `.replay` presence, and the plugin's MCP
 * config server list. `evalDir` may be absolute or relative to `pluginRoot`.
 * A mock with no `type` has `typeKind: "unknown"`. Never throws.
 */
export const readMocks = (
  pluginRoot: string,
  evalDir: string,
  caseDir?: string,
): MockCatalog => {
  const suite = scanMocks(join(resolve(pluginRoot, evalDir), "mocks"), "suite");
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
