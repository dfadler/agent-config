/** The author-cases skill must tell the model to write `schema_version: "1.1"` (#572). */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("author-cases SKILL.md instructs writing schema_version 1.1", () => {
  const body = readFileSync(
    new URL("../../../skills/author-cases/SKILL.md", import.meta.url),
    "utf8",
  );
  expect(body).toMatch(/schema_version: "1\.1"/);
});
