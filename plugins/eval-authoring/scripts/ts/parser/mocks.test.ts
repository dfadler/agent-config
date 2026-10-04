import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as parser from "./index.ts";
import { readMocks, readSuite } from "./index.ts";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eval-authoring-mocks-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const put = (rel: string, text: string): void => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
};

const mock = (front: string): string => `---\n${front}---\nBody\n`;

describe("relative plugin roots", () => {
  // A root made of plain names under the working directory. (A root climbing
  // out with `..` can cancel the doubled path by accident and hide the bug.)
  let local = "";
  beforeEach(() => {
    rmSync(root, { recursive: true, force: true });
    local = mkdtempSync(join(process.cwd(), ".tmp-eval-authoring-"));
    root = local;
  });
  afterEach(() => {
    rmSync(local, { recursive: true, force: true });
  });

  it("reads suite mocks when the plugin root is relative", () => {
    put("evals/mocks/srv/tool.md", mock("type: agent\n"));
    const relRoot = relative(process.cwd(), root);
    expect(relRoot.startsWith("/") || relRoot.includes("..")).toBe(false);
    const suite = readSuite(relRoot);
    expect(suite.mocks.mocks.map((m) => `${m.server}/${m.tool}`)).toEqual([
      "srv/tool",
    ]);
    // The path a rule passes on from the suite also works.
    expect(readMocks(relRoot, suite.evalDir).mocks).toHaveLength(1);
    // And a path relative to the root, as before.
    expect(readMocks(relRoot, "evals").mocks).toHaveLength(1);
    expect(readMocks(root, "evals").mocks).toHaveLength(1);
    expect(readMocks(root, join(root, "evals")).mocks).toHaveLength(1);
  });

  it("reads a case's own mocks with a relative root", () => {
    put("evals/c/mocks/srv/own.md", mock("type: fixed\n"));
    const relRoot = relative(process.cwd(), root);
    const cat = readMocks(
      relRoot,
      readSuite(relRoot).evalDir,
      join(relRoot, "evals", "c"),
    );
    expect(cat.mocks.map((m) => [m.tool, m.scope])).toEqual([["own", "case"]]);
  });
});

describe("Mock.typeKind follows the docs", () => {
  it.each([
    ["type: fixed\n", "fixed"],
    ["type: agent\n", "agent"],
    ["error: true\n", "fixed"],
    ["type: script\n", "unknown"],
    ["type: static\n", "unknown"],
    ["type: llm\n", "unknown"],
  ])("%j is %s", (front, kind) => {
    put("evals/mocks/s/t.md", mock(front));
    expect(readMocks(root, "evals").mocks[0]?.typeKind).toBe(kind);
  });

  it.each([
    ["a null value", "type:\n"],
    ["a list", "type: [agent]\n"],
    ["a mapping", "type:\n  kind: agent\n"],
  ])("classifies a present but invalid type (%s) as unknown, not fixed", (_n, front) => {
    put("evals/mocks/s/t.md", mock(front));
    const m = readMocks(root, "evals").mocks[0];
    expect(m?.typeKind).toBe("unknown");
    expect(m?.type).toBeUndefined();
    expect(m?.loc.line).toBe(2);
  });

  it("keeps the fixed default when type is absent from the frontmatter", () => {
    put("evals/mocks/s/t.md", mock("expect: called\n"));
    expect(readMocks(root, "evals").mocks[0]?.typeKind).toBe("fixed");
  });

  it("treats a file with no frontmatter as the default type, fixed", () => {
    put("evals/mocks/s/t.md", "just a body\n");
    expect(readMocks(root, "evals").mocks[0]).toMatchObject({
      typeKind: "fixed",
      type: undefined,
    });
  });
});

describe("Mock.hasReplay follows the documented layout", () => {
  it("looks for mocks/.replay/<server>/, per server", () => {
    put("evals/mocks/with/t.md", mock("type: agent\n"));
    put("evals/mocks/with/u.md", mock("type: agent\n"));
    put("evals/mocks/.replay/with/recording.json", "{}\n");
    put("evals/mocks/without/t.md", mock("type: agent\n"));
    put("evals/mocks/empty/t.md", mock("type: agent\n"));
    mkdirSync(join(root, "evals/mocks/.replay/empty"), { recursive: true });
    const byKey = new Map(
      readMocks(root, "evals").mocks.map((m) => [`${m.server}/${m.tool}`, m]),
    );
    expect(byKey.get("with/t")?.hasReplay).toBe(true);
    expect(byKey.get("with/u")?.hasReplay).toBe(true);
    expect(byKey.get("without/t")?.hasReplay).toBe(false);
    expect(byKey.get("empty/t")?.hasReplay).toBe(false);
  });

  it("counts only regular files, not subdirectories", () => {
    put("evals/mocks/dirs/t.md", mock("type: agent\n"));
    mkdirSync(join(root, "evals/mocks/.replay/dirs/nested"), { recursive: true });
    put("evals/mocks/files/t.md", mock("type: agent\n"));
    put("evals/mocks/.replay/files/rec.json", "{}\n");
    put("evals/mocks/nested/t.md", mock("type: agent\n"));
    put("evals/mocks/.replay/nested/sub/rec.json", "{}\n");
    const byServer = new Map(
      readMocks(root, "evals").mocks.map((m) => [m.server, m.hasReplay]),
    );
    expect(byServer.get("dirs")).toBe(false);
    expect(byServer.get("files")).toBe(true);
    // A file only inside a subdirectory is not a recording beside the mock.
    expect(byServer.get("nested")).toBe(false);
  });

  it("does not throw and is false when a listed entry vanishes or is a broken link", () => {
    put("evals/mocks/s/t.md", mock("type: agent\n"));
    mkdirSync(join(root, "evals/mocks/.replay/s"), { recursive: true });
    symlinkSync(
      join(root, "does-not-exist"),
      join(root, "evals/mocks/.replay/s/gone.json"),
    );
    expect(() => readMocks(root, "evals")).not.toThrow();
    expect(readMocks(root, "evals").mocks[0]?.hasReplay).toBe(false);
  });

  it("does not count a sibling <tool>.replay file", () => {
    put("evals/mocks/s/t.md", mock("type: agent\n"));
    put("evals/mocks/s/t.replay", "{}\n");
    expect(readMocks(root, "evals").mocks[0]?.hasReplay).toBe(false);
  });

  it("reads a case's own mocks/.replay for its own mocks", () => {
    put("evals/c/mocks/s/t.md", mock("type: agent\n"));
    put("evals/c/mocks/.replay/s/r.json", "{}\n");
    const cat = readMocks(root, "evals", join(root, "evals/c"));
    expect(cat.mocks[0]?.hasReplay).toBe(true);
  });

  it("does not list .replay (or any dot directory) as a server", () => {
    put("evals/mocks/real/t.md", mock("type: fixed\n"));
    put("evals/mocks/.replay/real/t.md", mock("type: agent\n"));
    put("evals/mocks/.hidden/t.md", mock("type: fixed\n"));
    const cat = readMocks(root, "evals");
    expect(cat.mocks.map((m) => m.server)).toEqual(["real"]);
    expect([...cat.declaredServers]).toEqual(["real"]);
  });
});

describe("Mock.expect", () => {
  it("keeps the scalar text and offers the parsed node for a block map", () => {
    put(
      "evals/mocks/s/map.md",
      mock("expect:\n  title: string\n  priority: [low, high]\n"),
    );
    put("evals/mocks/s/scalar.md", mock("expect: called\n"));
    const byTool = new Map(
      readMocks(root, "evals").mocks.map((m) => [m.tool, m]),
    );
    const map = byTool.get("map");
    expect(map?.expectNode?.kind).toBe("map");
    expect(map?.expectNode?.kind === "map" && map.expectNode.entries.map((e) => e.key)).toEqual(["title", "priority"]);
    expect(map?.expect).toBe("");
    expect(map?.loc.line).toBe(2);
    expect(byTool.get("scalar")).toMatchObject({ expect: "called" });
    expect(byTool.get("scalar")?.expectNode?.kind).toBe("scalar");
  });

  it("has no expect or node when absent", () => {
    put("evals/mocks/s/t.md", mock("type: fixed\n"));
    const m = readMocks(root, "evals").mocks[0];
    expect(m?.expect).toBeUndefined();
    expect(m?.expectNode).toBeUndefined();
  });

  it("reports bad frontmatter YAML as an issue and still lists the mock", () => {
    put("evals/mocks/s/t.md", "---\ntype: [agent\n---\n");
    const cat = readMocks(root, "evals");
    expect(cat.mocks).toHaveLength(1);
    expect(cat.issues[0]?.kind).toBe("yaml-syntax");
  });
});

describe("parser index", () => {
  it("exports the YAML reader and the frontmatter splitter", () => {
    expect(typeof parser.parseYaml).toBe("function");
    expect(typeof parser.splitFrontmatter).toBe("function");
    expect(parser.splitFrontmatter("---\na: 1\n---\nb").kind).toBe("found");
  });
});
