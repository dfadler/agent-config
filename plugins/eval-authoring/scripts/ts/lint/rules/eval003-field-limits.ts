import type { Field, FieldSpec } from "../../parser/index.ts";
import { graderLabel } from "../helpers.ts";
import { fromDocs } from "../sources.ts";
import type { Problem, Rule } from "../types.ts";

const range = (spec: FieldSpec): string =>
  spec.min !== undefined && spec.max !== undefined
    ? `${String(spec.min)} to ${String(spec.max)}`
    : spec.max !== undefined
      ? `at most ${String(spec.max)}`
      : `at least ${String(spec.min ?? 0)}`;

/** A number field against its schema limits; nothing when it is inside them. */
const limitProblem = (
  spec: FieldSpec | undefined,
  field: Field<number>,
): readonly Problem[] => {
  if (spec === undefined) return [];
  const { value } = field;
  const low = spec.min !== undefined && value < spec.min;
  const high = spec.max !== undefined && value > spec.max;
  return low || high
    ? [
        {
          message: `'${spec.name}' is ${String(value)}; allowed: ${range(spec)}.`,
          fix: `Set '${spec.name}' to ${range(spec)}.`,
          loc: field.loc,
        },
      ]
    : [];
};

/** EVAL003: field values and limits, read from the schema table. */
export const rule: Rule = {
  id: "EVAL003",
  severity: "error",
  title:
    "env key, runs, max_turns, timeout_seconds, weight, grader type or arm outside the schema",
  source: fromDocs("the case.yaml, prompt.md and grader field tables"),
  checkCase: (c, { schema }) => {
    const spec = (name: string): FieldSpec | undefined =>
      schema.promptMdKeys.find((s) => s.name === name);
    const envKey = new RegExp(schema.envKeyPattern);
    const arms =
      schema.graderCommonKeys.find((s) => s.name === "arm")?.oneOf ?? [];
    const types = schema.graderTypes.map((t) => t.type);

    const env: readonly Problem[] = c.env.value
      .filter((e) => !envKey.test(e.key))
      .map((e) => ({
        message: `env key '${e.key}' does not match ${schema.envKeyPattern}.`,
        fix: `Rename it to start with EVAL_ and use only A-Z, 0-9 and _ (for example EVAL_${e.key.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}).`,
        loc: e.loc,
      }));

    const limits: readonly Problem[] = [
      ...limitProblem(spec("runs"), c.runs),
      ...limitProblem(spec("max_turns"), c.maxTurns),
      ...limitProblem(spec("timeout_seconds"), c.timeoutSeconds),
    ];

    const graders: readonly Problem[] = c.graders.flatMap(
      (g): readonly Problem[] => [
        ...(g.weight.value > 0
          ? []
          : [
              {
                message: `${graderLabel(g)} has weight ${String(g.weight.value)}, which is not positive.`,
                fix: "Set `weight` to a number above 0 (the default is 1), or remove the grader.",
                loc: g.weight.loc,
              },
            ]),
        ...(g.type === "unknown"
          ? [
              {
                message:
                  g.rawType.value === undefined
                    ? `${graderLabel(g)} has no \`type\`.`
                    : `${graderLabel(g)} has unknown type '${g.rawType.value}'.`,
                fix: `Set \`type\` to one of ${types.join(", ")}.`,
                loc: g.rawType.explicit ? g.rawType.loc : g.origin.loc,
              },
            ]
          : []),
        ...(g.arm.value === undefined || arms.includes(g.arm.value)
          ? []
          : [
              {
                message: `${graderLabel(g)} has unknown arm '${g.arm.value}'.`,
                fix: `Set \`arm\` to one of ${arms.join(", ")}, or remove it.`,
                loc: g.arm.loc,
              },
            ]),
      ],
    );

    return [...env, ...limits, ...graders];
  },
};
