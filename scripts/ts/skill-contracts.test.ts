import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { main } from "./check-skill-contracts.ts";
import { findViolations, loadSkills, references, type Skill } from "./skill-contracts.ts";

const CONTRACT = "## Contract\n\n- **Input:** a PR number\n- **Output:** a report\n";

function skill(name: string, body: string, plugin = "p"): Skill {
  return { plugin, name, path: `plugins/${plugin}/skills/${name}/SKILL.md`, body };
}

test("a referenced skill with a full contract passes", () => {
  const skills = [
    skill("caller", "Hands off to [`callee`](../callee/SKILL.md)."),
    skill("callee", `# Callee\n\n${CONTRACT}\n## Other\n`),
  ];
  expect(findViolations(skills)).toEqual([]);
});

test("a referenced skill with no Contract section is reported", () => {
  const skills = [skill("caller", "See p:callee."), skill("callee", "# Callee\n")];
  expect(findViolations(skills)).toEqual([
    'plugins/p/skills/callee/SKILL.md: referenced by another skill but has no "## Contract" section',
  ]);
});

test("a Contract missing Input or Output names the missing label", () => {
  const skills = [
    skill("caller", "See p:callee."),
    skill("callee", "## Contract\n\n- **Input:** x\n- Output: prose, not the labelled form\n"),
  ];
  expect(findViolations(skills)).toEqual([
    'plugins/p/skills/callee/SKILL.md: "## Contract" is missing a "**Output:**" line',
  ]);
});

test("a label that only appears in a later section does not count", () => {
  const skills = [
    skill("caller", "See p:callee."),
    skill("callee", "## Contract\n\n- **Input:** x\n\n## Notes\n\n- **Output:** y\n"),
  ];
  expect(findViolations(skills)).toHaveLength(1);
});

test("a reference to a skill that does not exist is reported", () => {
  const skills = [skill("caller", "See [`ghost`](../ghost/SKILL.md) and p:phantom.")];
  expect(findViolations(skills)).toEqual([
    "plugins/p/skills/caller/SKILL.md: references p:ghost, which is not a skill in this repo",
    "plugins/p/skills/caller/SKILL.md: references p:phantom, which is not a skill in this repo",
  ]);
});

test("an unreferenced skill needs no contract", () => {
  expect(findViolations([skill("solo", "# Solo\n")])).toEqual([]);
});

test("prose like 'Step 2: diagnose' is not read as a reference", () => {
  const a = skill("a", "Step 2: diagnose. Note: carefully.");
  expect(references(a, new Set(["p"]), new Set(["a"]))).toEqual([]);
  expect(findViolations([a])).toEqual([]);
});

test("a token like node:fs is not a reference, since fs is not a skill", () => {
  expect(findViolations([skill("a", "Imports `node:fs` and runs `test:ci`.")])).toEqual([]);
});

test("a misspelled namespace on a real skill name is reported, not dropped", () => {
  const skills = [skill("caller", "See `pp:callee`."), skill("callee", CONTRACT)];
  expect(findViolations(skills)).toEqual([
    "plugins/p/skills/caller/SKILL.md: references pp:callee, which is not a skill in this repo",
  ]);
});

test("Input and Output labels mentioned mid-sentence do not satisfy the contract", () => {
  const skills = [
    skill("caller", "See p:callee."),
    skill("callee", "## Contract\n\nThe fields are **Input:** x and **Output:** y\n"),
  ];
  expect(findViolations(skills)).toEqual([
    'plugins/p/skills/callee/SKILL.md: "## Contract" is missing a "**Input:**" line',
    'plugins/p/skills/callee/SKILL.md: "## Contract" is missing a "**Output:**" line',
  ]);
});

test("a contract written with * bullets and indentation still passes", () => {
  const skills = [
    skill("caller", "See p:callee."),
    skill("callee", "## Contract\n\n  * **Input:** x\n  * **Output:** y\n"),
  ];
  expect(findViolations(skills)).toEqual([]);
});

test("a skill mentioning its own namespaced name is not a self-reference", () => {
  expect(findViolations([skill("a", "I am p:a.")])).toEqual([]);
});

test("cross-plugin references resolve against the other plugin's skills", () => {
  const skills = [skill("a", "Uses q:b.", "p"), skill("b", CONTRACT, "q")];
  expect(findViolations(skills)).toEqual([]);
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "skill-contracts-"));
  const skills = join(root, "plugins", "p", "skills");
  mkdirSync(join(skills, "caller"), { recursive: true });
  mkdirSync(join(skills, "callee"), { recursive: true });
  writeFileSync(join(skills, "caller", "SKILL.md"), "See [`callee`](../callee/SKILL.md).\n");
  writeFileSync(join(skills, "callee", "SKILL.md"), CONTRACT);
  mkdirSync(join(root, "plugins", "solo"), { recursive: true });
  writeFileSync(join(root, "plugins", "solo", "SKILL.md"), "# Root-level skill\n");
  return root;
}

test("loadSkills finds nested and root-level skills", () => {
  const found = loadSkills(fixture())
    .map((s) => `${s.plugin}:${s.name}`)
    .sort();
  expect(found).toEqual(["p:callee", "p:caller", "solo:solo"]);
});

test("main exits 0 on a clean tree, 1 on a violation, 2 on a bad root", () => {
  const root = fixture();
  const lines: string[] = [];
  const quiet = () => undefined;
  expect(main([root], quiet, (s) => lines.push(s))).toBe(0);

  writeFileSync(join(root, "plugins", "p", "skills", "callee", "SKILL.md"), "# no contract\n");
  expect(main([root], quiet, (s) => lines.push(s))).toBe(1);
  expect(lines.join("\n")).toMatch(/no "## Contract" section/);

  expect(main([join(root, "missing")], quiet, (s) => lines.push(s))).toBe(2);
});

test("main prints usage for --help", () => {
  let printed = "";
  expect(
    main(
      ["--help"],
      (s) => (printed += s),
      () => undefined,
    ),
  ).toBe(0);
  expect(printed).toMatch(/Usage: check-skill-contracts\.ts/);
});
