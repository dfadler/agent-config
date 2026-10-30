/** The grader-red-team agent stays read-only and names the probe that check-replies.ts provides (#859). */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const body = readFileSync(new URL("../../../agents/grader-red-team.md", import.meta.url), "utf8");
const checkReplies = readFileSync(new URL("../check-replies.ts", import.meta.url), "utf8");

it("has no Edit or Write in its tools allowlist", () => {
  expect(/^tools:\s*(.*)$/m.exec(body)?.[1]).not.toMatch(/\b(Edit|Write)\b/);
});
it("names the --probe command that check-replies.ts implements", () => {
  expect(body).toMatch(/check-replies\.ts --probe/);
  expect(checkReplies).toMatch(/probe: \{ type: "string" \}/);
});
it("forbids a paid run and never clears an llm grader", () => {
  expect(body).toMatch(/Never run `claude plugin eval`/);
  expect(body).toMatch(/Never clear one/);
});
it("never gives a bare Clean to a case with an llm or baseline grader", () => {
  expect(body).toMatch(/any `llm` or `baseline` grader never gets a bare `Clean`/);
  expect(body).toMatch(/`Clean \(free graders\); llm: needs a run`/);
});
it("passes the reply on stdin in a quoted heredoc, never as a shell argument", () => {
  expect(body).toMatch(/--reply - <PLUGIN_ROOT> <<'__REPLY__'/);
  expect(body).not.toMatch(/--reply '/);
});
it("headless allowlist has a fixed prefix with no wildcard before the script", () => {
  const rule = /"(Bash\(node [^"]*check-replies\.ts[^"]*\))"/.exec(body)?.[1];
  expect(rule).toBeDefined();
  expect(rule).not.toMatch(/node \*/);
  expect(rule).toMatch(/^Bash\(node plugins\/eval-authoring\/scripts\/ts\/check-replies\.ts --probe \*\)$/);
});
