import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** One SKILL.md, reduced to what the composition check needs. */
export interface Skill {
  /** Plugin directory name, which is the skill's namespace. */
  plugin: string;
  /** Skill name: its directory, or the plugin name for a root-level SKILL.md. */
  name: string;
  /** Path relative to the repo root, for error messages. */
  path: string;
  body: string;
}

const SIBLING_LINK = /\]\(\.\.\/([a-z0-9-]+)\/SKILL\.md\)/g;
const HEADING_CONTRACT = /^## Contract\s*$/m;

/** Text of the `## Contract` section, or undefined when the skill has none. */
function contractSection(body: string): string | undefined {
  const start = HEADING_CONTRACT.exec(body);
  if (!start) return undefined;
  const rest = body.slice(start.index + start[0].length);
  const next = /^## /m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/**
 * Names (as `plugin:skill`) of the skills `skill` points at, either with a
 * relative sibling link or with a namespaced `plugin:skill` mention.
 *
 * A colon-delimited token is not always a skill reference (`node:fs`,
 * `Step 2: diagnose`, a CSS declaration), so a mention counts only when its
 * namespace is one of `plugins`, or when its skill part is the name of a real
 * skill in `skillNames`. The second case keeps a misspelled namespace such as
 * `screen-captuer:capture` visible as an unresolved reference instead of
 * silently dropping it.
 */
export function references(
  skill: Skill,
  plugins: ReadonlySet<string>,
  skillNames: ReadonlySet<string>,
): string[] {
  const found = new Set<string>();
  for (const m of skill.body.matchAll(SIBLING_LINK)) {
    found.add(`${skill.plugin}:${m[1] ?? ""}`);
  }
  for (const m of skill.body.matchAll(/\b([a-z][a-z0-9-]*):([a-z][a-z0-9-]*)\b/g)) {
    const [, plugin = "", name = ""] = m;
    if (plugins.has(plugin) || skillNames.has(name)) found.add(`${plugin}:${name}`);
  }
  found.delete(`${skill.plugin}:${skill.name}`);
  return [...found].sort();
}

/**
 * Composition rules:
 *   1. A reference to another skill in this repo must resolve to a real skill.
 *   2. A skill that another skill references must document a `## Contract`
 *      section naming its **Input** and its **Output**, so a caller knows the
 *      shape to hand it and the shape to expect back.
 */
export function findViolations(skills: readonly Skill[]): string[] {
  const byId = new Map(skills.map((s) => [`${s.plugin}:${s.name}`, s]));
  const plugins = new Set(skills.map((s) => s.plugin));
  const skillNames = new Set(skills.map((s) => s.name));
  const errors: string[] = [];
  const referenced = new Set<string>();

  for (const skill of skills) {
    for (const ref of references(skill, plugins, skillNames)) {
      if (byId.has(ref)) referenced.add(ref);
      else errors.push(`${skill.path}: references ${ref}, which is not a skill in this repo`);
    }
  }

  for (const id of [...referenced].sort()) {
    const skill = byId.get(id);
    if (!skill) continue;
    const section = contractSection(skill.body);
    if (section === undefined) {
      errors.push(`${skill.path}: referenced by another skill but has no "## Contract" section`);
      continue;
    }
    for (const label of ["Input", "Output"]) {
      // Anchored to a list item so a label mentioned mid-sentence doesn't count.
      if (!new RegExp(`^[ \\t]*[-*][ \\t]+\\*\\*${label}:\\*\\*[ \\t]*\\S`, "m").test(section)) {
        errors.push(`${skill.path}: "## Contract" is missing a "**${label}:**" line`);
      }
    }
  }
  return errors;
}

/** Read every plugin skill under `<root>/plugins`. */
export function loadSkills(root: string): Skill[] {
  const skills: Skill[] = [];
  const pluginsDir = join(root, "plugins");
  for (const plugin of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!plugin.isDirectory()) continue;
    const candidates: [string, string][] = [[plugin.name, join(pluginsDir, plugin.name, "SKILL.md")]];
    const skillsDir = join(pluginsDir, plugin.name, "skills");
    if (existsSync(skillsDir)) {
      for (const dir of readdirSync(skillsDir, { withFileTypes: true })) {
        if (dir.isDirectory()) candidates.push([dir.name, join(skillsDir, dir.name, "SKILL.md")]);
      }
    }
    for (const [name, file] of candidates) {
      if (!existsSync(file)) continue;
      skills.push({
        plugin: plugin.name,
        name,
        path: relative(root, file),
        body: readFileSync(file, "utf8"),
      });
    }
  }
  return skills;
}
