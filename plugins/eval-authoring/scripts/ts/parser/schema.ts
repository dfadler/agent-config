import type { FieldSpec, SchemaTable } from "./types.ts";

// The case schema from the plugin-evals docs, as one table. Limits and key
// names live here and nowhere else; a lint rule that needs one imports it.
const str = (name: string, required = false): FieldSpec => ({
  name,
  kind: "string",
  required,
});
const list = (name: string): FieldSpec => ({
  name,
  kind: "string-list",
  required: false,
  default: [],
});
const num = (
  name: string,
  limits: { def?: number; min?: number; max?: number } = {},
): FieldSpec => ({
  name,
  kind: "number",
  required: false,
  ...(limits.def === undefined ? {} : { default: limits.def }),
  ...(limits.min === undefined ? {} : { min: limits.min }),
  ...(limits.max === undefined ? {} : { max: limits.max }),
});
const obj = (name: string, def?: string, required = false): FieldSpec => ({
  name,
  kind: "object",
  required,
  ...(def === undefined ? {} : { default: def }),
});

const COMMON_TOP: readonly FieldSpec[] = [
  str("description"),
  list("tags"),
  list("plugins"),
  num("runs", { def: 3, min: 1, max: 50 }),
  str("expected_outcome"),
];
const RUN_SETTINGS: readonly FieldSpec[] = [
  str("model"),
  num("max_turns", { def: 10, max: 200 }),
  num("timeout_seconds", { def: 300, max: 3600 }),
  list("allowed_tools"),
  str("append_system_prompt"),
  { name: "env", kind: "env-map", required: false },
];

const SCHEMA: SchemaTable = {
  // Claude Code version the table was checked against (the #450 runs).
  claudeCodeVersion: "2.1.287",
  caseYamlSchemaVersion: "1.1",
  defaultEvalDir: "evals",
  promptMdKeys: [str("schema_version"), str("name"), ...COMMON_TOP, ...RUN_SETTINGS],
  caseYamlTopLevelKeys: [
    str("schema_version", true),
    str("name", true),
    ...COMMON_TOP,
    obj("execution"),
    obj("context"),
    obj("graders"),
  ],
  caseYamlExecutionKeys: [str("prompt"), ...RUN_SETTINGS],
  caseYamlContextKeys: [str("scaffold_script"), str("history_file"), list("add_dirs")],
  graderCommonKeys: [
    str("name"),
    str("type", true),
    num("weight", { def: 1 }),
    {
      name: "arm",
      kind: "string",
      required: false,
      oneOf: ["with-only", "both"],
    },
  ],
  graderTypes: [
    {
      type: "regex",
      keys: [
        str("pattern", true),
        str("flags"),
        { name: "match", kind: "string", required: false, default: "contains" },
        obj("target", "last_message"),
      ],
    },
    {
      type: "tool_used",
      keys: [
        str("tool", true),
        str("input_match"),
        num("min", { def: 1 }),
        num("max"),
      ],
    },
    {
      type: "tool_order",
      keys: [obj("before", undefined, true), obj("after", undefined, true)],
    },
    {
      type: "file_exists",
      keys: [
        str("path", true),
        { name: "exists", kind: "boolean", required: false, default: true },
      ],
    },
    { type: "llm", keys: [str("criteria"), obj("focus", "last_message")] },
    { type: "baseline", keys: [str("baseline_file", true), str("criteria")] },
  ],
  targetKeywords: ["last_message", "trace", "files", "mock_calls"],
  envKeyPattern: "^EVAL_[A-Z0-9_]*$",
  toolsNeedingGrant: ["Bash", "Write", "Edit", "WebFetch", "WebSearch"],
};

/** The schema table. The only place limits and key names live. Used by EVAL002, EVAL003. */
export const getSchema = (): SchemaTable => SCHEMA;
