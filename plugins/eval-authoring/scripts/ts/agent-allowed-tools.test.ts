import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// #885: a `*` before the script name lets `node -e '<js>' lint/cli.ts` or `node --import ...`
// match. The permissions docs (https://code.claude.com/docs/en/permissions#wildcard-patterns)
// say `*` matches any text including spaces and that everything before the first `*` is
// matched as written, so a pattern is safe only if `node <script>` comes before any `*`.
const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Why a `Bash(...)` specifier is unpinned, or "" if its `node` script is fixed. */
const nodePatternProblem = (specifier: string): string => {
  if (!specifier.startsWith("node ")) return "";
  const script = specifier.slice("node ".length).split(" ")[0] ?? "";
  if (script.includes("*")) return `wildcard in the script path '${script}'`;
  if (script.startsWith("-")) return `node option '${script}' before the script`;
  if (!/\.(ts|js|mjs|cjs)$/.test(script)) return `'${script}' is not a pinned script file`;
  return "";
};

/** `Bash(...)` specifiers inside every fenced block that passes `--allowedTools`. */
const allowedBashSpecifiers = (markdown: string): string[] =>
  markdown
    .split("```")
    .filter((block) => block.includes("--allowedTools"))
    .flatMap((block) => [...block.matchAll(/"Bash\(([^"]*)\)"/g)].map((m) => m[1] ?? ""));

const agentsDir = join(pluginRoot, "agents");
const agents = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));

describe("agent --allowedTools Bash patterns", () => {
  it("finds the headless recipes (so the checks below are not vacuous)", () => {
    const withRecipe = agents.filter(
      (f) => allowedBashSpecifiers(readFileSync(join(agentsDir, f), "utf8")).length > 0,
    );
    expect(withRecipe).toEqual(expect.arrayContaining(["case-reviewer.md", "grader-red-team.md"]));
  });

  it.each(agents)("%s pins every node script with no wildcard before it", (file) => {
    const specifiers = allowedBashSpecifiers(readFileSync(join(agentsDir, file), "utf8"));
    const problems = specifiers.map((s) => [s, nodePatternProblem(s)]).filter(([, p]) => p);
    expect(problems).toEqual([]);
  });

  it("the per-case grants pin every node script too", () => {
    const grants = readFileSync(join(pluginRoot, "evals", "grants.yaml"), "utf8");
    const specifiers = [...grants.matchAll(/"Bash\(([^"]*)\)"/g)].map((m) => m[1] ?? "");
    expect(specifiers.filter((s) => s.startsWith("node ")).length).toBeGreaterThan(0);
    expect(specifiers.map((s) => [s, nodePatternProblem(s)]).filter(([, p]) => p)).toEqual([]);
  });

  it("flags the patterns from #885", () => {
    expect(nodePatternProblem("node *lint/cli.ts*")).toMatch(/wildcard/);
    expect(nodePatternProblem("node -e * lint/cli.ts")).toMatch(/option/);
    expect(nodePatternProblem("node plugins/x/lint/cli.ts *")).toBe("");
    expect(nodePatternProblem("git log*")).toBe("");
  });
});
