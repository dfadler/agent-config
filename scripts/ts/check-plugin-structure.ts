// Validate the declarative metadata this repo ships: plugin manifests, skill
// frontmatter, and agent frontmatter.
//
// The files that MUST parse and MUST agree with each other are the plugin's
// JSON manifest and the YAML frontmatter Claude Code reads to discover skills
// and agents. A skill whose `name:` drifts from its directory, or a manifest
// that stops being valid JSON, fails silently at load time rather than loudly
// in review.
//
// Checks, per plugin under ROOT/plugins/*/:
//   * .claude-plugin/plugin.json parses as JSON, has name/version/description,
//     and its `name` matches the plugin directory.
//   * a root-level SKILL.md (single-skill plugin) has the same frontmatter,
//     with `name` matching the plugin directory.
//   * every skills/*/SKILL.md has delimited frontmatter carrying `name` and a
//     non-empty `description`, and `name` matches the skill directory.
//   * every agents/*.md has the same, with `name` matching the filename.
//   * every *.sh or *.py shipped under a skill's scripts/ is executable.
//   * hooks/hooks.json, if present, parses as JSON, its top level is an
//     object, and every command rooted at ${CLAUDE_PLUGIN_ROOT}/ names an
//     existing executable file.
//   * every command row in scripts/plugin-hooks.sh (what setup.sh registers in
//     ~/.claude/settings.json) resolves, via the ~/.claude/skills/<plugin>
//     link setup creates, to a file that exists under plugins/, and no
//     PLUGIN_HOOK_LEGACY_CMDS row does (a retired path must not be live).
//     Skipped when ROOT has no scripts/plugin-hooks.sh.
//
// Frontmatter is read with the flat `key: value` and block-scalar rules this
// repo uses (no YAML parser: zero runtime dependencies). Anything more
// structured belongs in a real YAML parser, not here.
import {
  accessSync,
  constants,
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { cliError, EXIT_FAILURE, EXIT_USAGE } from "./lib/exit-codes.ts";
import { err, ok } from "./lib/result.ts";
import { run, type Main } from "./lib/run.ts";

export const USAGE = `Usage: check-plugin-structure.ts [-h|--help] [ROOT]

Validate plugin manifests, skill frontmatter, and agent frontmatter under
ROOT/plugins (default: .).

  -h, --help   Show this message and exit.
`;

const SUCCESS =
  "✓ Plugin manifests, skill frontmatter, and agent frontmatter are consistent.\n";

// ---------------------------------------------------------------- frontmatter

const SPACE = "[ \\t\\r\\n\\f\\v]";
const DELIMITER = new RegExp(`^---${SPACE}*$`);
const trim = (s: string): string => s.replace(new RegExp(`^${SPACE}+|${SPACE}+$`, "g"), "");

const lineList = (text: string): readonly string[] => {
  const lines = text.split("\n");
  return lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
};

/**
 * True when the frontmatter carries `key` with a non-empty EFFECTIVE value.
 *
 * "Effective" is the subtlety: several YAML spellings look like a value but
 * resolve to null, and an empty description is exactly the silent drift this
 * check exists to catch. Rejected accordingly:
 *   key:                 (nothing)
 *   key: "" / key: ''    (explicit empty scalar)
 *   key: # comment       (a comment is not a value)
 *   key: |               (block opener with no indented body under it)
 *   key: null|Null|NULL|~   (the YAML Core schema's null spellings)
 *
 * The null match is deliberately case-SENSITIVE and exact: `NuLl` and
 * `nullable` are ordinary strings and must still pass.
 */
export const frontmatterHas = (text: string, key: string): boolean => {
  const lines = lineList(text);
  if (lines[0] !== "---") return false;
  const prefix = `${key}:`;
  let found = false;
  let inBlock = false;
  for (const line of lines.slice(1)) {
    if (DELIMITER.test(line)) return found;
    if (inBlock) {
      if (new RegExp(`^${SPACE}*$`).test(line)) continue;
      if (new RegExp(`^${SPACE}+`).test(line)) {
        found = true;
        inBlock = false;
        continue;
      }
      inBlock = false; // dedented back to a sibling key without any content
    }
    if (!line.startsWith(prefix)) continue;
    // In YAML a " #" (space-hash) begins a comment in a plain scalar.
    const value = trim(
      line.slice(prefix.length).replace(new RegExp(`${SPACE}+#.*$`), ""),
    );
    if (/^[|>][0-9+-]*$/.test(value)) {
      inBlock = true;
      continue;
    }
    if (["", '""', "''", "null", "Null", "NULL", "~"].includes(value)) continue;
    if (!value.startsWith("#")) found = true;
  }
  return found;
};

/** The trimmed raw text after `key:` on its first line in the frontmatter, or "". */
export const frontmatterValue = (text: string, key: string): string => {
  const lines = lineList(text);
  if (lines[0] !== "---") return "";
  const prefix = `${key}:`;
  for (const line of lines.slice(1)) {
    if (DELIMITER.test(line)) return "";
    if (line.startsWith(prefix)) return trim(line.slice(prefix.length));
  }
  return "";
};

// ----------------------------------------------------------------- filesystem

const kindOf = (path: string): "file" | "dir" | "other" => {
  try {
    const st = statSync(path); // follows symlinks, like bash -f / -d
    return st.isDirectory() ? "dir" : st.isFile() ? "file" : "other";
  } catch {
    return "other";
  }
};

const present = (path: string): boolean => {
  try {
    lstatSync(path); // a broken symlink is still a real, wrong entry
    return true;
  } catch {
    return false;
  }
};

const isExecutable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** Visible entries of `dir` (bash globs skip dotfiles), sorted; [] if unreadable. */
const entries = (dir: string): readonly string[] => {
  try {
    return readdirSync(dir)
      .filter((e) => !e.startsWith("."))
      .sort();
  } catch {
    return [];
  }
};

const subdirs = (dir: string): readonly string[] =>
  entries(dir).filter((e) => kindOf(`${dir}/${e}`) === "dir");

const readText = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

const STRERROR: Readonly<Record<string, string>> = {
  EISDIR: "Is a directory",
  ENOENT: "No such file or directory",
  EACCES: "Permission denied",
  ELOOP: "Too many levels of symbolic links",
};

const unreadable = (thrown: unknown): string => {
  const code =
    typeof thrown === "object" && thrown !== null && "code" in thrown
      ? String(thrown.code)
      : "";
  return `unreadable: ${STRERROR[code] ?? code}`;
};

// ------------------------------------------------------------------ JSON files

type Json = unknown;
const isRecord = (v: Json): v is Readonly<Record<string, Json>> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Parse a JSON object file; the `err` side is the one-line problem. */
const readJsonObject = (
  path: string,
): { readonly data: Readonly<Record<string, Json>> } | { readonly problem: string } => {
  const read = ((): { text: string } | { problem: string } => {
    try {
      return { text: readFileSync(path, "utf8") };
    } catch (thrown) {
      return { problem: unreadable(thrown) };
    }
  })();
  if ("problem" in read) return read;
  const parsed = ((): { v: Json } | undefined => {
    try {
      return { v: JSON.parse(read.text) };
    } catch {
      return undefined;
    }
  })();
  if (parsed === undefined) return { problem: "not valid JSON" };
  return isRecord(parsed.v)
    ? { data: parsed.v }
    : { problem: "top level is not a JSON object" };
};

/** Python-truthiness of a JSON value: null, false, 0, "", [] and {} are empty. */
const isEmpty = (v: Json): boolean =>
  v === undefined ||
  v === null ||
  v === false ||
  v === 0 ||
  v === "" ||
  (Array.isArray(v) && v.length === 0) ||
  (isRecord(v) && Object.keys(v).length === 0);

const repr = (v: Json): string =>
  typeof v === "string" ? `'${v}'` : JSON.stringify(v);

const checkManifest = (pluginDir: string, pluginName: string): readonly string[] => {
  const manifest = `${pluginDir}/.claude-plugin/plugin.json`;
  if (kindOf(manifest) !== "file") {
    return [`${pluginDir}: missing .claude-plugin/plugin.json`];
  }
  const r = readJsonObject(manifest);
  if ("problem" in r) return [`${manifest}: ${r.problem}`];
  const missing = ["name", "version", "description"].find((k) => isEmpty(r.data[k]));
  if (missing !== undefined) {
    return [`${manifest}: missing or empty '${missing}'`];
  }
  return r.data["name"] === pluginName
    ? []
    : [
        `${manifest}: name ${repr(r.data["name"])} does not match plugin directory '${pluginName}'`,
      ];
};

// Both command prefix forms Claude Code ships: quoted root (spaces-safe) and bare.
const ROOT_PREFIXES = ['"${CLAUDE_PLUGIN_ROOT}"/', "${CLAUDE_PLUGIN_ROOT}/"];

/**
 * Every "command" string anywhere in the tree. hooks.json nests commands at
 * arbitrary depth (the "hooks" wrapper, per-event groups, their inner lists),
 * so walk the whole tree instead of hard-coding the schema.
 */
const findCommands = (v: Json): readonly string[] =>
  Array.isArray(v)
    ? v.flatMap(findCommands)
    : isRecord(v)
      ? [
          ...(typeof v["command"] === "string" ? [v["command"]] : []),
          ...Object.values(v).flatMap(findCommands),
        ]
      : [];

const commandProblem = (pluginDir: string, cmd: string): string | undefined => {
  const prefix = ROOT_PREFIXES.find((p) => cmd.startsWith(p));
  if (prefix === undefined) return undefined;
  const rest = cmd.slice(prefix.length);
  const executable = rest.trim() === "" ? rest : (rest.trim().split(/\s+/)[0] ?? rest);
  const full = executable.startsWith("/") ? executable : `${pluginDir}/${executable}`;
  if (kindOf(full) !== "file") return `command path not found: ${cmd}`;
  if (!isExecutable(full)) return `command path not executable: ${cmd}`;
  return undefined;
};

const checkHooks = (pluginDir: string): readonly string[] => {
  const file = `${pluginDir}/hooks/hooks.json`;
  if (!present(file)) return [];
  const r = readJsonObject(file);
  if ("problem" in r) return [`${file}: ${r.problem}`];
  // Like the bash original, only the first bad command is reported.
  const problem = findCommands(r.data)
    .map((cmd) => commandProblem(pluginDir, cmd))
    .find((p) => p !== undefined);
  return problem === undefined ? [] : [`${file}: ${problem}`];
};

const checkFrontmatterDoc = (
  file: string,
  expected: string,
  label: string,
): readonly string[] => {
  const text = readText(file) ?? "";
  if (!frontmatterHas(text, "name")) {
    return [`${file}: frontmatter missing 'name' (or no leading '---' delimiter)`];
  }
  const declared = frontmatterValue(text, "name");
  return [
    ...(frontmatterHas(text, "description")
      ? []
      : [`${file}: frontmatter missing a non-empty 'description'`]),
    ...(declared === expected
      ? []
      : [`${file}: name '${declared}' does not match ${label} '${expected}'`]),
  ];
};

const checkScripts = (scriptsDir: string): readonly string[] =>
  [".sh", ".py"].flatMap((ext) =>
    entries(scriptsDir)
      .filter((e) => e.endsWith(ext))
      .map((e) => `${scriptsDir}/${e}`)
      .filter((s) => present(s) && kindOf(s) !== "other" && !isExecutable(s))
      .map((s) => `${s}: not executable (chmod +x)`),
  );

const checkPlugin = (pluginDir: string): readonly string[] => {
  const pluginName = pluginDir.slice(pluginDir.lastIndexOf("/") + 1);
  const rootSkill = `${pluginDir}/SKILL.md`;
  const skills = subdirs(`${pluginDir}/skills`).flatMap((name) => {
    const dir = `${pluginDir}/skills/${name}`;
    const md = `${dir}/SKILL.md`;
    return kindOf(md) === "file"
      ? [
          ...checkFrontmatterDoc(md, name, "skill directory"),
          ...checkScripts(`${dir}/scripts`),
        ]
      : [`${dir}: missing SKILL.md`];
  });
  const agents = entries(`${pluginDir}/agents`)
    .filter((e) => e.endsWith(".md"))
    .flatMap((e) =>
      checkFrontmatterDoc(`${pluginDir}/agents/${e}`, e.slice(0, -3), "filename"),
    );
  return [
    ...checkManifest(pluginDir, pluginName),
    ...checkHooks(pluginDir),
    ...(kindOf(rootSkill) === "file"
      ? [
          ...checkFrontmatterDoc(rootSkill, pluginName, "plugin directory"),
          ...checkScripts(`${pluginDir}/scripts`),
        ]
      : []),
    ...skills,
    ...agents,
  ];
};

// ------------------------------------------------------------ hook table

const HOME_MARK = "/__HOME__";

/**
 * Rows of [cmd, legacyCmd] from scripts/plugin-hooks.sh, or a problem string.
 * That file is bash arrays whose values interpolate $HOME, so rather than
 * re-parsing bash from TS (brittle: quoting, "|" in matchers) we let bash
 * evaluate it with a sentinel HOME and print one tab-separated row per hook.
 * Paths contain no tabs or newlines.
 */
const readHookTable = (
  file: string,
):
  | { readonly rows: readonly (readonly [string, string])[] }
  | { readonly problem: string } => {
  const r = spawnSync(
    "bash",
    [
      "-c",
      'source "$1"; for i in "${!PLUGIN_HOOK_CMDS[@]}"; do printf "%s\\t%s\\n" "${PLUGIN_HOOK_CMDS[$i]}" "${PLUGIN_HOOK_LEGACY_CMDS[$i]:-}"; done',
      "_",
      file,
    ],
    { encoding: "utf8", env: { PATH: process.env["PATH"] ?? "", HOME: HOME_MARK } },
  );
  if (r.status !== 0) return { problem: `could not evaluate (${r.stderr.trim()})` };
  return {
    rows: r.stdout
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => {
        const [cmd = "", legacy = ""] = l.split("\t");
        return [cmd, legacy] as const;
      }),
  };
};

/** Map a registered command's script path to its location in the repo. */
const repoPathOf = (root: string, cmd: string): string | undefined => {
  const path = /"([^"]+)"/.exec(cmd)?.[1] ?? cmd;
  const prefix = `${HOME_MARK}/.claude/skills/`;
  return path.startsWith(prefix) ? `${root}/plugins/${path.slice(prefix.length)}` : undefined;
};

const checkHookTable = (root: string): readonly string[] => {
  const file = `${root}/scripts/plugin-hooks.sh`;
  if (!present(file)) return [];
  const t = readHookTable(file);
  if ("problem" in t) return [`${file}: ${t.problem}`];
  const live = new Set(t.rows.map(([cmd]) => repoPathOf(root, cmd)));
  return t.rows.flatMap(([cmd, legacy]) => {
    const target = repoPathOf(root, cmd);
    const old = legacy === "" ? undefined : repoPathOf(root, legacy);
    return [
      ...(target === undefined
        ? [`${file}: hook command not under ~/.claude/skills: ${cmd}`]
        : kindOf(target) === "file"
          ? []
          : [`${file}: registered hook has no file: ${cmd} (expected ${target})`]),
      ...(old !== undefined && (live.has(old) || kindOf(old) === "file")
        ? [`${file}: legacy command is still live (retire the file): ${legacy}`]
        : []),
    ];
  });
};

// ------------------------------------------------------------------------ CLI

export const main: Main = (argv) => {
  const first = argv[0];
  if (first === "-h" || first === "--help") return ok(USAGE);
  const root = first ?? ".";
  if (kindOf(root) !== "dir") {
    return err(cliError(EXIT_USAGE, `::error::ROOT does not exist: ${root}`));
  }
  const plugins = subdirs(`${root}/plugins`);
  if (plugins.length === 0) {
    return err(
      cliError(EXIT_FAILURE, `::error::no plugins found under ${root}/plugins/`),
    );
  }
  const errors = [
    ...plugins.flatMap((p) => checkPlugin(`${root}/plugins/${p}`)),
    ...checkHookTable(root),
  ];
  return errors.length > 0
    ? err(
        cliError(
          EXIT_FAILURE,
          `::error::Plugin structure validation failed:\n${errors.map((e) => `  ${e}`).join("\n")}`,
        ),
      )
    : ok(SUCCESS);
};

if (import.meta.main) run(main);
