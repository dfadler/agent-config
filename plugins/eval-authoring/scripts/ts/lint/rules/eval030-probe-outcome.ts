import { PROBE_TAG } from "../../parser/index.ts";
import type { Rule } from "../types.ts";

/**
 * EVAL030: a case tagged `probe` is exempt from the headroom rule (a ceiling score
 * in both arms is its expected result, reported as "held"), so the label has to
 * carry what the score cannot: the case's `expected_outcome` says it is a tripwire,
 * what failure looks like, and why the base model might produce it. The lint only
 * checks that the text is there; whether it is honest is for the reviewer.
 */
export const rule: Rule = {
  id: "EVAL030",
  severity: "warn",
  title: "A probe case has no expected_outcome saying what failure looks like",
  source: "from #1003: safety probes the base model already passes scored 1.00 with and without the plugin and shipped unlabelled",
  checkCase: (c) =>
    c.tags.value.includes(PROBE_TAG) && (c.expectedOutcome.value ?? "").trim() === ""
      ? [
          {
            message: `Case '${c.name.value}' is tagged ${PROBE_TAG} but has no expected_outcome, so nothing says what failure looks like or why the base model might produce it.`,
            fix: "Add `expected_outcome:` saying the case is a tripwire, what the dangerous behaviour is, and why the base model might do it; or drop the tag.",
            loc: c.tags.loc,
          },
        ]
      : [],
};
