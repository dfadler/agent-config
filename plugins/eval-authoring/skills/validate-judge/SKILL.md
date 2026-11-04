---
name: validate-judge
description: Measure how well an `llm` grader agrees with human pass/fail labels (true-positive rate, true-negative rate, kappa) before trusting the case's scores or a delta. Use when asked "can I trust this judge", "does my llm grader agree with the replies I labelled", "check the rubric against known good and bad replies", or when a case's `llm` grader has `# good-reply:` and `# bad-reply:` lines that nothing has run yet. Paid but tiny (about $0.001 per label); runs only on the user's go-ahead in chat. Not for explaining a low score on a live run (diagnose-scores), running a suite (run-evals) or writing cases (author-cases).
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/../../scripts/ts/validate-judge.ts *), Bash(node ${CLAUDE_SKILL_DIR}/../../scripts/ts/judge-agreement.ts *)
argument-hint: "<plugin-path> <case> <grader> [labels.json]"
---

# Validate an `llm` grader

## Contract

- **Input:** `$ARGUMENTS`: a plugin path, a case name, the name of one of its `llm`
  graders, and optionally a labels file (a JSON array of
  `{"label": "PASS"|"FAIL", "reply": "...", "split": "dev"|"test"}`, written by a person).
- **Output:** the judge's agreement with the labels (agreement, kappa, TPR, TNR) with the
  label counts beside each rate, and what the number does and does not support.
- **Does not:** start the paid run without the user's go-ahead, edit the case or its
  rubric, label replies itself, or call a model directly.

`claude plugin eval` has no flag that grades a saved reply, so this skill builds a stand-in:
a throwaway probe plugin with one stub case per labelled reply. Each stub's scaffold writes
the reply to `reply.txt`, and its `llm` grader judges that file with the real grader's
criteria, so the judge sees the labelled text and nothing else. The agent turn in each stub
is a one-word reply and is not graded. The probe is an ordinary CLI run, so no model is
called outside it. The judge reads the reply as a file's contents
([docs: what a grader can look at](https://code.claude.com/docs/en/plugin-evals), the
`{ source: file, path: <path> }` value), not as Claude's final message, so the result is a
close stand-in for the real grader, not a measurement of it.

## Steps

1. **Get the labels.** With no labels file the script uses the case's own `# good-reply:`
   and `# bad-reply:` header lines: one PASS and one FAIL, enough to prove the judge can tell
   them apart but not to put a rate on it. For a rate, ask the user for more labelled replies
   (replies from `--keep-temp` runs are the best source, see
   [run-evals](../run-evals/SKILL.md)); about 6 to 10 is the least that gives a rough TPR and TNR
   for a small plugin, and a person must label them. Never label replies with the same judge,
   and do not write labels yourself to make the number look good.
2. **Split them.** Mark about half `"split": "dev"` and half `"test"`. Tune the rubric on
   `dev`; report the number from `test` only, and do not edit the rubric after seeing it.
   With no splits, say the number is not held out.
3. **Build the probe (free):**
   `node ${CLAUDE_SKILL_DIR}/../../scripts/ts/validate-judge.ts --plugin <plugin> --case <case> --grader <grader> [--labels FILE] [--split test] [--judge-model M] --out <dir>`
   with `<dir>` under the session scratchpad. Pass the `--judge-model` the real runs use:
   judge scores compare only at one judge. It prints the two commands below.
4. **Get the go-ahead, then run.** Say the label count and the cost (about $0.001 per label
   at haiku; the printed command caps it at `--max-cost-usd 1`), and that `--scaffold` runs
   the generated `fixture.sh` files as the user. Each only copies a data file, so open one
   if asked. A user who asked for this check in the conversation has given the go-ahead
   for the run; otherwise wait for a yes. Run the printed `claude plugin eval` command.
   `--threshold 0` is deliberate: a bad reply the judge correctly fails scores 0, and that is
   not a failed suite.
5. **Report (free):** run the printed `judge-agreement.ts` command and read the `all:` line.
   The per-case lines have one label each, so their kappa is `n/a`.

## Reading the result

- Quote the counts with the rates: "TPR 3 of 4, TNR 4 of 4", not "TPR 75%". With under 20 labels a
  rate is a rough guide; one flipped label moves it by 10 points or more.
- **TNR low** (the judge passes replies a person failed): the rubric is too loose. A delta
  built on it overstates the plugin. Tighten the FAIL conditions, rerun on `dev`.
- **TPR low** (the judge fails replies a person passed): the rubric is too strict, or the
  PASS condition depends on formatting. Both arms lose score; the delta shrinks toward 0.
- **Split votes** (some stub cases show PASS and FAIL votes): the rubric is unstable;
  see the `split-judge-votes` entry in [diagnose-scores](../diagnose-scores/SKILL.md).
- High agreement on a few labels means the judge handles those replies, not that it is
  right on replies it has not seen. Do not write "the judge is validated" from fewer than
  about 20 labels; write the counts.

## Gotchas

- A label set with no PASS or no FAIL is refused: one rate cannot be computed without both.
- The run costs a little even when the labels are few; the cap is a ceiling, not an estimate.
- The probe never touches the plugin's own cases or results; delete `<dir>` when done.
