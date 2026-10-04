import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readMocks, type Mock, type SourceLoc } from "../../parser/index.ts";
import { parseYaml, splitFrontmatter, type YNode } from "../../parser/yaml.ts";
import { fromDocs } from "../sources.ts";
import type { LintContext, Problem, Rule } from "../types.ts";

/** Type names the docs list for an `expect:` value. */
const EXPECT_TYPE_NAMES: readonly string[] = [
  "string",
  "number",
  "boolean",
  "array",
  "object",
];

/** Type words from other languages that an author is likely to mistake for the docs' names. */
const LIKELY_TYPE_TYPOS: readonly string[] = [
  "str",
  "text",
  "int",
  "integer",
  "float",
  "bool",
  "list",
  "dict",
  "map",
  "any",
];

/** The docs name `fixed` (default) and `agent`. */
const MOCK_TYPES: readonly string[] = ["fixed", "agent"];

const MOCK_DOCS = fromDocs(
  "the mock file reference: `expect` maps dotted input paths to a type name, a /regex/, a literal, or a list of allowed literals; `type` is `fixed` or `agent`; recordings go under `mocks/.replay/<server>/`",
);

const at = (node: YNode, file: string): SourceLoc => ({
  file,
  line: node.line,
  column: node.column,
});

const isRegexLiteral = (text: string): boolean => /^\/.*\/[a-z]*$/s.test(text);

/** The compile error of a `/body/flags` literal, or undefined when it compiles. */
const regexError = (text: string): string | undefined => {
  const m = /^\/(.*)\/([a-z]*)$/s.exec(text);
  try {
    new RegExp(m?.[1] ?? "", m?.[2] ?? "");
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

/** What is wrong with one `expect:` value, given the dotted path it guards. */
const checkExpectValue = (path: string, value: YNode): readonly string[] => {
  switch (value.kind) {
    case "map":
      return [
        `\`expect.${path}\` is a nested map; write the full dotted path as the key (\`${path}.<field>: ...\`) with a type, /regex/, literal or list of literals as the value`,
      ];
    case "seq":
      return value.items.flatMap((item) =>
        item.kind === "scalar"
          ? []
          : [`\`expect.${path}\` lists a ${item.kind}; a list holds only literals`],
      );
    case "scalar": {
      if (value.quoted) return [];
      if (isRegexLiteral(value.text)) {
        const err = regexError(value.text);
        return err === undefined
          ? []
          : [`\`expect.${path}\` is not a valid regex (${err})`];
      }
      return LIKELY_TYPE_TYPOS.includes(value.text.toLowerCase())
        ? [
            `\`expect.${path}\` is \`${value.text}\`, which is not a type name (${EXPECT_TYPE_NAMES.join(", ")}); as written it is a literal the input must equal`,
          ]
        : [];
    }
  }
};

const EXPECT_FIX =
  "Write `expect:` as a map from dotted input paths to a type name (string, number, boolean, array, object), a /regex/, a literal, or a list of allowed literals. Quote a literal that looks like a type word.";

/** Everything wrong with `expect:` in a mock's frontmatter. */
const expectProblems = (
  mock: Mock,
  fm: Readonly<Record<string, YNode>>,
): readonly Problem[] => {
  const node = fm["expect"];
  if (node === undefined) return [];
  const label = `${mock.server}/${mock.tool}`;
  if (node.kind !== "map") {
    return [
      {
        message: `Mock ${label} has an \`expect\` that is not a map of input paths, so it guards nothing or aborts every call.`,
        fix: EXPECT_FIX,
        loc: at(node, mock.file),
      },
    ];
  }
  return node.entries.flatMap((entry) =>
    checkExpectValue(entry.key, entry.value).map(
      (message): Problem => ({
        message: `Mock ${label}: ${message}.`,
        fix: EXPECT_FIX,
        loc: { file: mock.file, line: entry.keyLine, column: entry.keyColumn },
      }),
    ),
  );
};

/** Top-level nodes of a mock's frontmatter; empty when it has none or cannot be read. */
const readFrontmatterMap = (file: string): Readonly<Record<string, YNode>> => {
  try {
    const split = splitFrontmatter(readFileSync(file, "utf8"));
    if (split.kind !== "found") return {};
    const parsed = parseYaml(split.yaml, split.yamlLine);
    if (!parsed.ok || parsed.value?.kind !== "map") return {};
    return Object.fromEntries(
      parsed.value.entries.map((e) => [e.key, e.value]),
    );
  } catch {
    return {};
  }
};

/**
 * True when `<mocksDir>/.replay/<server>/` holds at least one file. The
 * parser's `Mock.hasReplay` looks for a sibling `<tool>.replay` instead, which
 * is not the documented layout, so this rule does not use it.
 */
const hasReplay = (mock: Mock): boolean => {
  const dir = join(dirname(dirname(mock.file)), ".replay", mock.server);
  try {
    return existsSync(dir) && readdirSync(dir).length > 0;
  } catch {
    return false;
  }
};

const checkMock = (
  mock: Mock,
  mcpServers: readonly string[],
): readonly Problem[] => {
  const label = `${mock.server}/${mock.tool}`;
  const fm = readFrontmatterMap(mock.file);
  const typeNode = fm["type"];
  const typeText = typeNode?.kind === "scalar" ? typeNode.text : mock.type;

  const serverProblems: readonly Problem[] = mcpServers.includes(mock.server)
    ? []
    : [
        {
          message: `Mock ${label} is for server '${mock.server}', which is not in the plugin's MCP configuration (${mcpServers.length === 0 ? "none found" : mcpServers.join(", ")}), so no call ever reaches it.`,
          fix: "Rename the directory to a server name from .mcp.json or plugin.json `mcpServers`, or add the server there.",
          loc: mock.loc,
        },
      ];

  const typeProblems: readonly Problem[] =
    typeText === undefined || MOCK_TYPES.includes(typeText)
      ? []
      : [
          {
            message: `Mock ${label} has type '${typeText}'; the docs list only ${MOCK_TYPES.join(" and ")}.`,
            fix: "Set `type: fixed` (the default) or `type: agent`.",
            loc: typeNode === undefined ? mock.loc : at(typeNode, mock.file),
          },
        ];

  const replayProblems: readonly Problem[] =
    typeText === "agent" && !hasReplay(mock)
      ? [
          {
            message: `Mock ${label} is \`type: agent\` with no recording under mocks/.replay/${mock.server}/, so the judge model answers differently on every run and CI is not repeatable.`,
            fix: `Run the case once, copy the recordings ADOPT.txt names into mocks/.replay/${mock.server}/, and commit them.`,
            loc: mock.loc,
          },
        ]
      : [];

  // `_server.md` is a type: agent mock for several tools; the docs put `expect:` on tool files only.
  const expectChecks = mock.tool === "_server" ? [] : expectProblems(mock, fm);
  return [...serverProblems, ...typeProblems, ...replayProblems, ...expectChecks];
};

/** Skips the `.replay` recordings directory, which the parser lists as a server when it holds `.md` files. */
const checkAll = (
  mocks: readonly Mock[],
  mcpServers: readonly string[],
): readonly Problem[] =>
  mocks
    .filter((m) => !m.server.startsWith("."))
    .flatMap((m) => checkMock(m, mcpServers));

/**
 * EVAL013: mock files. Suite-level mocks are checked once (`checkSuite`); a
 * case's own `mocks/` files are checked per case, so nothing is reported twice.
 * The runner already reports mock read problems as rule PARSE, so this rule
 * ignores `MockCatalog.issues` and leaves that to the runner.
 */
export const rule: Rule = {
  id: "EVAL013",
  severity: "warn",
  title:
    "Mock for a server not in the plugin's MCP config, invalid expect or type, or type: agent with no .replay",
  source: MOCK_DOCS,
  checkSuite: ({ pluginRoot, suite }: LintContext) => {
    // Re-read with an absolute eval dir: `suite.mocks` is read from `suite.evalDir`
    // joined onto a relative plugin root a second time, so it is empty for one.
    const catalog = readMocks(pluginRoot, resolve(suite.evalDir));
    return checkAll(
      catalog.mocks.filter((m) => m.scope === "suite"),
      catalog.mcpServers,
    );
  },
  checkCase: (c, { pluginRoot, suite }) => {
    const catalog = readMocks(pluginRoot, resolve(suite.evalDir), c.dir);
    return checkAll(
      catalog.mocks.filter((m) => m.scope === "case"),
      catalog.mcpServers,
    );
  },
};
