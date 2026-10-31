import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fillTemplate, validateQuestions } from "./fill-form.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "fill-form.ts");
const TEMPLATE = readFileSync(resolve(HERE, "../../skills/ask-form/template.html"), "utf8");

const single = { id: "db", type: "single", label: "Which database?", options: ["Postgres", "SQLite"] };

describe("validateQuestions", () => {
  it("accepts one question of every type, with defaults", () => {
    expect(
      validateQuestions([
        { ...single, default: "Postgres" },
        { id: "f", type: "multi", label: "Features?", options: ["A", "B"], default: ["A"] },
        { id: "e", type: "select", label: "Env?", options: ["dev", "prod"] },
        { id: "n", type: "text", label: "Name?", default: "x" },
        { id: "t", type: "textarea", label: "Notes?", help: "optional" },
      ]),
    ).toEqual([]);
  });

  it.each([
    ["not an array", { id: "a" }, /non-empty array/],
    ["empty array", [], /non-empty array/],
    ["a non-object entry", ["hi"], /must be an object/],
    ["a bad id", [{ ...single, id: "has space" }], /id must be a slug/],
    ["a duplicate id", [single, single], /duplicate id "db"/],
    ["an unknown type", [{ ...single, type: "radio" }], /type must be one of/],
    ["a missing label", [{ ...single, label: " " }], /label is required/],
    ["a choice without options", [{ ...single, options: undefined }], /options must be/],
    ["empty options", [{ ...single, options: [] }], /options must be/],
    ["options on text", [{ id: "n", type: "text", label: "N?", options: ["a"] }], /not allowed on text/],
    ["a default outside the options", [{ ...single, default: "MySQL" }], /one of the options/],
    ["a multi default that is a string", [{ id: "f", type: "multi", label: "F?", options: ["A"], default: "A" }], /array of options/],
    ["a non-string text default", [{ id: "n", type: "text", label: "N?", default: 3 }], /must be a string/],
  ])("rejects %s", (_name, input, message) => {
    expect(validateQuestions(input).join("\n")).toMatch(message);
  });
});

describe("fillTemplate", () => {
  it("replaces the placeholder with the questions as JSON", () => {
    const html = fillTemplate(TEMPLATE, [single]);
    expect(html).toContain(`const Q = ${JSON.stringify([single])};`);
    expect(html).not.toContain("/*QUESTIONS*/");
  });

  it("escapes < so a question cannot close the script tag", () => {
    const html = fillTemplate(TEMPLATE, [{ ...single, label: "Why </script><b>?" }]);
    expect(html).toContain(String.raw`Why \x3c/script>\x3cb>?`);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });

  it("keeps $ patterns in a label literal", () => {
    const html = fillTemplate(TEMPLATE, [{ ...single, label: "Costs $& or $1?" }]);
    expect(html).toContain("Costs $& or $1?");
  });

  it("throws the validation errors and a missing-placeholder error", () => {
    expect(() => fillTemplate(TEMPLATE, [])).toThrow(/non-empty array/);
    expect(() => fillTemplate("<html></html>", [single])).toThrow(/placeholder/);
  });
});

describe("cli", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fill-form-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the page, creating the output directory, and prints its path", () => {
    writeFileSync(join(dir, "q.json"), JSON.stringify([single]));
    const out = join(dir, "nested", "form.html");
    const printed = execFileSync("node", [SCRIPT, join(dir, "q.json"), out], { encoding: "utf8" });
    expect(printed.trim()).toBe(out);
    expect(readFileSync(out, "utf8")).toContain('"id":"db"');
  });

  it("exits 1 with the message on an invalid list and writes nothing", () => {
    writeFileSync(join(dir, "q.json"), JSON.stringify([{ ...single, type: "radio" }]));
    const out = join(dir, "form.html");
    const r = spawnSync("node", [SCRIPT, join(dir, "q.json"), out], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/type must be one of/);
    expect(() => readFileSync(out)).toThrow();
  });

  it("exits 2 with usage when arguments are missing", () => {
    const r = spawnSync("node", [SCRIPT], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/usage/);
  });
});
