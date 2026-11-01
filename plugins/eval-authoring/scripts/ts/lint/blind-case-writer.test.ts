/** The blind-case-writer agent keeps a read-only allowlist and refuses to see the author's cases (#861). */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const body = readFileSync(
  new URL("../../../agents/blind-case-writer.md", import.meta.url),
  "utf8",
);

it("pins its tools allowlist to Read and Glob", () => {
  expect(/^tools:\s*(.*)$/m.exec(body)?.[1]?.trim()).toBe("Read, Glob");
});
it("forbids reading the author's cases and a paid run", () => {
  expect(body).toMatch(/Never read, list or search any `evals\/` directory/);
  expect(body).toMatch(/Never run\s+`claude plugin eval`/);
});
