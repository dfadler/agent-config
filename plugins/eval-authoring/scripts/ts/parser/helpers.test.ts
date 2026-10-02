import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPluginManifest } from "./manifest.ts";
import { readMocks } from "./mocks.ts";
import { resolveCasePath } from "./paths.ts";

// Hermetic fixtures: every test builds its plugin in a fresh temp directory.
let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eval-authoring-helpers-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const put = (rel: string, content: string): string => {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
};

const manifest = (body: unknown): void => {
  put(".claude-plugin/plugin.json", JSON.stringify(body, null, 2));
};

describe("readPluginManifest", () => {
  it("reads all three dependency forms", () => {
    manifest({
      name: "demo",
      dependencies: [
        "plain",
        "pinned@market",
        { name: "obj", version: "^1.2.0", marketplace: "m2" },
      ],
    });
    const m = readPluginManifest(root);
    expect(m.name).toBe("demo");
    expect(m.issues).toEqual([]);
    expect(
      m.dependencies.map((d) => [
        d.name,
        d.form,
        d.version,
        d.marketplace,
      ]),
    ).toEqual([
      ["plain", "name", undefined, undefined],
      ["pinned", "name@marketplace", undefined, "market"],
      ["obj", "object", "^1.2.0", "m2"],
    ]);
  });

  it("accepts an object form that omits version", () => {
    manifest({ name: "demo", dependencies: [{ name: "obj" }] });
    const [dep] = readPluginManifest(root).dependencies;
    expect(dep).toMatchObject({
      name: "obj",
      form: "object",
      version: undefined,
      marketplace: undefined,
    });
  });

  it("returns no dependencies when the manifest declares none", () => {
    manifest({ name: "demo" });
    const m = readPluginManifest(root);
    expect(m.dependencies).toEqual([]);
    expect(m.issues).toEqual([]);
  });

  it("points each dependency at its own line", () => {
    manifest({ name: "demo", dependencies: ["a", "b"] });
    const [a, b] = readPluginManifest(root).dependencies;
    expect(a?.loc.line).toBeLessThan(b?.loc.line ?? 0);
  });

  it("reports an entry it cannot read and keeps the rest", () => {
    manifest({
      name: "demo",
      dependencies: [42, { version: "1" }, "ok"],
    });
    const m = readPluginManifest(root);
    expect(m.dependencies.map((d) => d.name)).toEqual(["ok"]);
    expect(m.issues.map((i) => i.kind)).toEqual(["wrong-type", "wrong-type"]);
  });

  it("reports a non-array dependencies value", () => {
    manifest({ name: "demo", dependencies: "nope" });
    expect(readPluginManifest(root).issues[0]?.kind).toBe("wrong-type");
  });

  it("reads experimental.evals as written", () => {
    manifest({ name: "demo", experimental: { evals: "custom/evals" } });
    expect(readPluginManifest(root).experimentalEvals).toBe("custom/evals");
  });

  it("reports a missing manifest without throwing", () => {
    const m = readPluginManifest(root);
    expect(m.name).toBeUndefined();
    expect(m.issues[0]?.kind).toBe("unreadable-file");
  });

  it("reports invalid JSON and a non-object document", () => {
    put(".claude-plugin/plugin.json", "{ not json");
    expect(readPluginManifest(root).issues[0]?.message).toContain("invalid JSON");
    put(".claude-plugin/plugin.json", "[]");
    expect(readPluginManifest(root).issues[0]?.kind).toBe("wrong-type");
  });

  it("reports wrong-typed name and experimental.evals", () => {
    manifest({ name: 7, experimental: { evals: 1 } });
    const m = readPluginManifest(root);
    expect(m.name).toBeUndefined();
    expect(m.experimentalEvals).toBeUndefined();
    expect(m.issues).toHaveLength(2);
  });
});

describe("readMocks", () => {
  const mock = (type: string, extra = ""): string =>
    `---\ntype: ${type}\n${extra}---\nBody\n`;

  it("reads type and expect frontmatter and sorts by server and tool", () => {
    put("evals/mocks/zeta/b.md", mock("static", "expect: called\n"));
    put("evals/mocks/alpha/a.md", mock("script"));
    const cat = readMocks(root, "evals");
    expect(cat.mocks.map((m) => `${m.server}/${m.tool}`)).toEqual([
      "alpha/a",
      "zeta/b",
    ]);
    expect(cat.mocks[1]).toMatchObject({
      type: "static",
      typeKind: "static",
      expect: "called",
      scope: "suite",
    });
    expect([...cat.declaredServers].sort()).toEqual(["alpha", "zeta"]);
  });

  it("passes an invalid expect through for EVAL013 to judge", () => {
    put("evals/mocks/s/t.md", mock("static", "expect: sometimes\n"));
    expect(readMocks(root, "evals").mocks[0]?.expect).toBe("sometimes");
  });

  it("flags an unknown or absent type as unknown", () => {
    put("evals/mocks/s/odd.md", mock("llm"));
    put("evals/mocks/s/bare.md", "no frontmatter\n");
    const cat = readMocks(root, "evals");
    expect(cat.mocks.map((m) => [m.tool, m.typeKind, m.type])).toEqual([
      ["bare", "unknown", undefined],
      ["odd", "unknown", "llm"],
    ]);
  });

  it("detects .replay for a type: agent mock, present and absent", () => {
    put("evals/mocks/s/with.md", mock("agent"));
    put("evals/mocks/s/with.replay", "{}\n");
    put("evals/mocks/s/without.md", mock("agent"));
    const byTool = new Map(
      readMocks(root, "evals").mocks.map((m) => [m.tool, m]),
    );
    expect(byTool.get("with")).toMatchObject({ typeKind: "agent", hasReplay: true });
    expect(byTool.get("without")).toMatchObject({
      typeKind: "agent",
      hasReplay: false,
    });
  });

  it("lets a case's mocks override the suite's file by file", () => {
    put("evals/mocks/s/shared.md", mock("static"));
    put("evals/mocks/s/suite-only.md", mock("static"));
    put("evals/case1/mocks/s/shared.md", mock("script"));
    put("evals/case1/mocks/s/case-only.md", mock("script"));
    const cat = readMocks(root, "evals", join(root, "evals/case1"));
    expect(
      cat.mocks.map((m) => [m.tool, m.typeKind, m.scope]),
    ).toEqual([
      ["case-only", "script", "case"],
      ["shared", "script", "case"],
      ["suite-only", "static", "suite"],
    ]);
  });

  it("ignores the case's mocks when no case directory is given", () => {
    put("evals/case1/mocks/s/t.md", mock("script"));
    expect(readMocks(root, "evals").mocks).toEqual([]);
  });

  it("returns an empty catalog when there are no mocks or MCP config", () => {
    const cat = readMocks(root, "evals");
    expect(cat.mocks).toEqual([]);
    expect(cat.mcpServers).toEqual([]);
    expect(cat.declaredServers.size).toBe(0);
    expect(cat.issues).toEqual([]);
  });

  it("reports an unclosed frontmatter block", () => {
    put("evals/mocks/s/t.md", "---\ntype: static\n");
    const cat = readMocks(root, "evals");
    expect(cat.issues[0]?.kind).toBe("malformed-frontmatter");
    expect(cat.mocks[0]?.type).toBeUndefined();
  });

  it("strips quotes and trailing comments from values", () => {
    put("evals/mocks/s/t.md", '---\ntype: "agent"\nexpect: called # note\n---\n');
    expect(readMocks(root, "evals").mocks[0]).toMatchObject({
      type: "agent",
      expect: "called",
    });
  });

  it("lists MCP servers from .mcp.json and plugin.json, merged", () => {
    put(".mcp.json", JSON.stringify({ mcpServers: { files: {}, db: {} } }));
    manifest({ name: "demo", mcpServers: { web: {}, db: {} } });
    expect(readMocks(root, "evals").mcpServers).toEqual(["db", "files", "web"]);
  });

  it("accepts a bare server map in .mcp.json", () => {
    put(".mcp.json", JSON.stringify({ files: {} }));
    expect(readMocks(root, "evals").mcpServers).toEqual(["files"]);
  });

  it("follows a plugin.json mcpServers path inside the plugin", () => {
    put("config/mcp.json", JSON.stringify({ mcpServers: { cfg: {} } }));
    manifest({ name: "demo", mcpServers: "./config/mcp.json" });
    expect(readMocks(root, "evals").mcpServers).toEqual(["cfg"]);
  });

  it("refuses an mcpServers path that leaves the plugin and reports it", () => {
    manifest({ name: "demo", mcpServers: "../outside.json" });
    const cat = readMocks(root, "evals");
    expect(cat.mcpServers).toEqual([]);
    expect(cat.issues[0]?.message).toContain("outside the plugin root");
  });

  it("reports a malformed .mcp.json but not a missing one", () => {
    put(".mcp.json", "{ bad");
    expect(readMocks(root, "evals").issues[0]?.kind).toBe("unreadable-file");
  });
});

describe("resolveCasePath", () => {
  const caseDir = (): string => join(root, "evals", "case1");

  it("accepts a path inside the plugin root and reports existence", () => {
    put("scripts/setup.sh", "#!/bin/sh\n");
    const hit = resolveCasePath(caseDir(), "../../scripts/setup.sh", root);
    expect(hit).toEqual({
      resolved: join(root, "scripts", "setup.sh"),
      insidePluginRoot: true,
      exists: true,
    });
    const miss = resolveCasePath(caseDir(), "setup.sh", root);
    expect(miss).toMatchObject({ insidePluginRoot: true, exists: false });
  });

  it("rejects a sibling path outside the plugin root", () => {
    const plugin = join(root, "plugin");
    const sibling = join(root, "plugin-other");
    mkdirSync(sibling, { recursive: true });
    const result = resolveCasePath(join(plugin, "evals/c"), "../../../plugin-other", plugin);
    expect(result.insidePluginRoot).toBe(false);
    expect(result.exists).toBe(true);
  });

  it("rejects a path that climbs out with ..", () => {
    expect(
      resolveCasePath(caseDir(), "../../../escape", root).insidePluginRoot,
    ).toBe(false);
  });

  it("treats the plugin root itself as inside", () => {
    expect(resolveCasePath(caseDir(), "../..", root).insidePluginRoot).toBe(true);
  });

  it("checks an absolute path the same way", () => {
    expect(resolveCasePath(caseDir(), join(root, "x"), root).insidePluginRoot).toBe(
      true,
    );
    expect(resolveCasePath(caseDir(), tmpdir(), root).insidePluginRoot).toBe(false);
  });

  it("does not follow symlinks: a link inside the plugin counts as inside, whatever it targets", () => {
    const outside = mkdtempSync(join(tmpdir(), "eval-authoring-outside-"));
    try {
      mkdirSync(caseDir(), { recursive: true });
      symlinkSync(outside, join(caseDir(), "link"));
      const result = resolveCasePath(caseDir(), "link", root);
      expect(result.insidePluginRoot).toBe(true);
      expect(result.resolved).toBe(join(caseDir(), "link"));
      expect(result.exists).toBe(true);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
