import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { FieldSpec, SchemaTable } from "./types.ts";

// Every default the reader applies must come from the schema table, so a CLI
// schema change is one edit. Prove it by swapping the table for one whose
// defaults all differ from the shipped ones.
const withDefault = (
  keys: readonly FieldSpec[],
  name: string,
  def: string | number | boolean,
): readonly FieldSpec[] =>
  keys.map((k) => (k.name === name ? { ...k, default: def } : k));

vi.mock("./schema.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("./schema.ts")>();
  const table = real.getSchema();
  const altered: SchemaTable = {
    ...table,
    promptMdKeys: [
      ["runs", 7],
      ["max_turns", 8],
      ["timeout_seconds", 9],
    ].reduce<readonly FieldSpec[]>(
      (keys, [name, def]) =>
        withDefault(keys, String(name), Number(def)),
      table.promptMdKeys,
    ),
    graderCommonKeys: withDefault(table.graderCommonKeys, "weight", 5),
    graderTypes: table.graderTypes.map((t) => ({
      ...t,
      keys: [
        ["match", "not_contains"],
        ["target", "trace"],
        ["focus", "files"],
        ["min", 4],
        ["exists", false],
      ].reduce<readonly FieldSpec[]>(
        (keys, [name, def]) =>
          withDefault(
            keys,
            String(name),
            typeof def === "number" || typeof def === "boolean"
              ? def
              : String(def),
          ),
        t.keys,
      ),
    })),
  };
  return { ...real, getSchema: () => altered };
});

const { readCase } = await import("./case.ts");

const root = mkdtempSync(join(tmpdir(), "eval-authoring-defaults-"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("defaults come from the schema table", () => {
  it("applies the table's defaults to case fields and every grader type", () => {
    const dir = join(root, "c");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "case.yaml"),
      [
        'schema_version: "1.1"',
        "name: c",
        "graders:",
        "  - type: regex",
        "    pattern: x",
        "  - type: tool_used",
        "    tool: Bash",
        "  - type: file_exists",
        "    path: a",
        "  - type: llm",
        "    criteria: c",
        "",
      ].join("\n"),
    );
    const c = readCase(dir);
    expect(c.runs.value).toBe(7);
    expect(c.maxTurns.value).toBe(8);
    expect(c.timeoutSeconds.value).toBe(9);
    const [regex, toolUsed, fileExists, llm] = c.graders;
    expect(regex?.weight.value).toBe(5);
    expect(regex?.type === "regex" && regex.match.value).toBe("not_contains");
    expect(regex?.type === "regex" && regex.target.value).toEqual({
      kind: "trace",
    });
    expect(toolUsed?.type === "tool_used" && toolUsed.min.value).toBe(4);
    expect(fileExists?.type === "file_exists" && fileExists.exists.value).toBe(
      false,
    );
    expect(llm?.type === "llm" && llm.focus.value).toEqual({ kind: "files" });
  });
});
