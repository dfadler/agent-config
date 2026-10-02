import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
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
  assert.deepEqual(findViolations(skills), []);
});

test("a referenced skill with no Contract section is reported", () => {
  const skills = [skill("caller", "See p:callee."), skill("callee", "# Callee\n")];
  assert.deepEqual(findViolations(skills), [
    'plugins/p/skills/callee/SKILL.md: referenced by another skill but has no "## Contract" section',
  ]);
});

test("a Contract missing Input or Output names the missing label", () => {
  const skills = [
    skill("caller", "See p:callee."),
    skill("callee", "## Contract\n\n- **Input:** x\n- Output: prose, not the labelled form\n"),
  ];
  assert.deepEqual(findViolations(skills), [
    'plugins/p/skills/callee/SKILL.md: "## Contract" is missing a "**Output:**" line',
  ]);
});

test("a label that only appears in a later section does not count", () => {
  const skills = [
    skill("caller", "See p:callee."),
    skill("callee", "## Contract\n\n- **Input:** x\n\n## Notes\n\n- **Output:** y\n"),
  ];
  assert.equal(findViolations(skills).length, 1);
});

test("a reference to a skill that does not exist is reported", () => {
  const skills = [skill("caller", "See [`ghost`](../ghost/SKILL.md) and p:phantom.")];
  assert.deepEqual(findViolations(skills), [
    "plugins/p/skills/caller/SKILL.md: references p:ghost, which is not a skill in this repo",
    "plugins/p/skills/caller/SKILL.md: references p:phantom, which is not a skill in this repo",
  ]);
});

test("an unreferenced skill needs no contract", () => {
  assert.deepEqual(findViolations([skill("solo", "# Solo\n")]), []);
});

test("prose like 'Step 2: diagnose' is not read as a reference", () => {
  const a = skill("a", "Step 2: diagnose. Note: carefully.");
  assert.deepEqual(references(a, new Set(["p"])), []);
  assert.deepEqual(findViolations([a]), []);
});

test("a skill mentioning its own namespaced name is not a self-reference", () => {
  assert.deepEqual(findViolations([skill("a", "I am p:a.")]), []);
});

test("cross-plugin references resolve against the other plugin's skills", () => {
  const skills = [
    skill("a", "Uses q:b.", "p"),
    skill("b", CONTRACT, "q"),
  ];
  assert.deepEqual(findViolations(skills), []);
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
  const found = loadSkills(fixture()).map((s) => `${s.plugin}:${s.name}`).sort();
  assert.deepEqual(found, ["p:callee", "p:caller", "solo:solo"]);
});

test("main exits 0 on a clean tree, 1 on a violation, 2 on a bad root", () => {
  const root = fixture();
  const lines: string[] = [];
  assert.equal(main([root], () => undefined, (s) => lines.push(s)), 0);

  writeFileSync(join(root, "plugins", "p", "skills", "callee", "SKILL.md"), "# no contract\n");
  assert.equal(main([root], () => undefined, (s) => lines.push(s)), 1);
  assert.match(lines.join("\n"), /no "## Contract" section/);

  assert.equal(main([join(root, "missing")], () => undefined, (s) => lines.push(s)), 2);
});

test("main prints usage for --help", () => {
  let printed = "";
  assert.equal(main(["--help"], (s) => (printed += s), () => undefined), 0);
  assert.match(printed, /Usage: check-skill-contracts\.ts/);
});
