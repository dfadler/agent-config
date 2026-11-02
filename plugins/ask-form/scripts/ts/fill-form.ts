/**
 * Fill the ask-form template with a question list and write the result.
 * `node fill-form.ts <questions.json> <out.html>`
 *
 * Validates the questions (see skills/ask-form/SKILL.md for the schema) so a bad
 * list fails here with a readable message, not as a blank form in the browser.
 * `<` is written as the JS escape `\x3c` so a question can never close the script tag.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = "/*QUESTIONS*/[]";
const TYPES = ["single", "multi", "select", "text", "textarea"];
const CHOICE = ["single", "multi", "select"];
const TEMPLATE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../skills/ask-form/template.html",
);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x: unknown) => typeof x === "string");

const checkDefault = (type: string, dflt: unknown, options: readonly string[]): string[] => {
  if (dflt === undefined) return [];
  if (type === "multi") {
    return strings(dflt) && dflt.every((d) => options.includes(d))
      ? []
      : ["default must be an array of options"];
  }
  if (CHOICE.includes(type)) {
    return typeof dflt === "string" && options.includes(dflt) ? [] : ["default must be one of the options"];
  }
  return typeof dflt === "string" ? [] : ["default must be a string"];
};

/** Every problem with the question list; empty when it is fine to render. */
export const validateQuestions = (input: unknown): string[] => {
  if (!Array.isArray(input) || input.length === 0) return ["questions must be a non-empty array"];
  const seen = new Set<string>();
  return input.flatMap((q: unknown, i: number) => {
    const at = `question ${String(i + 1)}`;
    if (!isRecord(q)) return [`${at}: must be an object`];
    const { id, type, label, options, default: dflt } = q;
    if (!nonEmpty(id) || !/^[\w-]+$/.test(id)) return [`${at}: id must be a slug (letters, digits, - _)`];
    const dup = seen.has(id);
    seen.add(id);
    if (dup) return [`${at}: duplicate id "${id}"`];
    if (typeof type !== "string" || !TYPES.includes(type)) {
      return [`${at} (${id}): type must be one of ${TYPES.join(", ")}`];
    }
    const errs: string[] = [];
    if (!nonEmpty(label)) errs.push("label is required");
    if (CHOICE.includes(type)) {
      if (!strings(options) || options.length === 0 || !options.every(nonEmpty)) {
        errs.push("options must be a non-empty array of non-empty strings");
      } else errs.push(...checkDefault(type, dflt, options));
    } else {
      if (options !== undefined) errs.push(`options are not allowed on ${type}`);
      errs.push(...checkDefault(type, dflt, []));
    }
    return errs.map((e) => `${at} (${id}): ${e}`);
  });
};

/** Embed the questions in the template; throws on an invalid list. */
export const fillTemplate = (template: string, questions: unknown): string => {
  const errors = validateQuestions(questions);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  if (!template.includes(PLACEHOLDER)) throw new Error(`template has no ${PLACEHOLDER} placeholder`);
  const json = JSON.stringify(questions).replaceAll("<", String.raw`\x3c`);
  return template.replace(PLACEHOLDER, () => json);
};

if (import.meta.main) {
  const [src, out] = process.argv.slice(2);
  if (src === undefined || out === undefined) {
    process.stderr.write("usage: node fill-form.ts <questions.json> <out.html>\n");
    process.exit(2);
  }
  try {
    const html = fillTemplate(readFileSync(TEMPLATE, "utf8"), JSON.parse(readFileSync(src, "utf8")));
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, html);
    process.stdout.write(`${resolve(out)}\n`);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}
