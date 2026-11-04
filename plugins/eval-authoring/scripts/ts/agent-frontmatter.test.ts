/** Plugin subagents ignore hooks, mcpServers and permissionMode, so agents must not declare them (#773). */
import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

const agentsDir = new URL("../../agents/", import.meta.url);
const agents = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));

/** Top-level keys of the leading `---` block (indented lines and comments are skipped). */
const frontmatter = (markdown: string): Map<string, string> => {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(markdown)?.[1] ?? "";
  return new Map(
    [...block.matchAll(/^([A-Za-z][\w-]*):[ \t]*(.*)$/gm)].map((m) => [m[1] ?? "", m[2] ?? ""]),
  );
};

it("finds the three agents (so the checks below are not vacuous)", () => {
  expect(agents).toEqual(["blind-case-writer.md", "case-reviewer.md", "grader-red-team.md"]);
});

it.each(agents)("%s has name equal to its filename", (file) => {
  const fm = frontmatter(readFileSync(new URL(file, agentsDir), "utf8"));
  expect(fm.get("name")).toBe(file.replace(/\.md$/, ""));
});

it.each(agents)("%s declares no hooks, mcpServers or permissionMode", (file) => {
  const keys = [...frontmatter(readFileSync(new URL(file, agentsDir), "utf8")).keys()];
  expect(keys.filter((k) => ["hooks", "mcpServers", "permissionMode"].includes(k))).toEqual([]);
});
