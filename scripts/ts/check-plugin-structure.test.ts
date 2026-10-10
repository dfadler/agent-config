import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  frontmatterHas,
  frontmatterValue,
  main,
  USAGE,
} from "./check-plugin-structure.ts";
import { readTextFile } from "./lib/fs.ts";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const SCRIPT = join(import.meta.dirname, "check-plugin-structure.ts");

describe("frontmatterHas", () => {
  const fm = (description: string): string =>
    `---\nname: x\ndescription:${description}\n---\n\nBody\n`;

  it.each([
    ["a plain value", " a description"],
    ["a trailing comment", " a real description # note"],
    ["a block scalar with a body", " |\n  Multi-line\n  text."],
    ["NuLl (not an exact null spelling)", " NuLl"],
    ["nullable", " nullable"],
    ["a null-prefixed sentence", " null and void"],
  ])("accepts %s", (_label, description) => {
    expect(frontmatterHas(fm(description), "description")).toBe(true);
  });

  it.each([
    ["nothing", ""],
    ["a double-quoted empty string", ' ""'],
    ["a single-quoted empty string", " ''"],
    ["only a comment", " # TODO write this"],
    ["a block opener with no body", " |"],
    ["null", " null"],
    ["Null", " Null"],
    ["NULL", " NULL"],
    ["tilde", " ~"],
  ])("rejects %s", (_label, description) => {
    expect(frontmatterHas(fm(description), "description")).toBe(false);
  });

  it("rejects a block opener followed only by a sibling key", () => {
    const text = "---\nname: x\ndescription: |\nlicense: MIT\n---\n";
    expect(frontmatterHas(text, "description")).toBe(false);
  });

  it("rejects text with no leading delimiter, and empty text", () => {
    expect(frontmatterHas("# Just a heading\n", "name")).toBe(false);
    expect(frontmatterHas("", "name")).toBe(false);
  });

  it("does not read past the closing delimiter", () => {
    expect(frontmatterHas("---\nname: x\n---\ndescription: late\n", "description")).toBe(false);
  });
});

describe("frontmatterValue", () => {
  it("returns the trimmed raw value, quotes included", () => {
    expect(frontmatterValue('---\nname:  "q"  \n---\n', "name")).toBe('"q"');
  });

  it("returns empty when the key is absent or only after the delimiter", () => {
    expect(frontmatterValue("---\nother: 1\n---\nname: late\n", "name")).toBe("");
    expect(frontmatterValue("no frontmatter\nname: x\n", "name")).toBe("");
  });
});

describe("main against a fixture tree", () => {
  let root = "";
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "plugin-structure-"));
    plugin("demo");
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const put = (rel: string, text: string, mode = 0o644): string => {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    chmodSync(path, mode);
    return path;
  };
  const plugin = (name: string): void => {
    put(
      `plugins/${name}/.claude-plugin/plugin.json`,
      JSON.stringify({ name, version: "0.1.0", description: "fixture plugin" }),
    );
  };
  const doc = (name: string, description = "fixture"): string =>
    `---\nname: ${name}\ndescription: ${description}\n---\n\nBody\n`;
  const skill = (dir: string, name = dir): string =>
    put(`plugins/demo/skills/${dir}/SKILL.md`, doc(name));
  const agent = (file: string, name = file): string =>
    put(`plugins/demo/agents/${file}.md`, doc(name));

  const check = (...argv: string[]) =>
    main(argv.length === 0 ? [root] : argv, {}, { readFile: readTextFile });
  const failure = (): string => {
    const r = check();
    if (r.tag === "ok") throw new Error(`expected failure, got: ${r.value}`);
    expect(r.error.code).toBe(1);
    return r.error.message;
  };
  const hooks = (json: string): void => {
    put("plugins/demo/hooks/hooks.json", json);
  };
  const nestedHook = (command: string): string =>
    JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command }] }] } });

  it("passes on a well-formed plugin", () => {
    skill("my-skill");
    agent("my-agent");
    const r = check();
    expect(r.tag).toBe("ok");
    expect(r.tag === "ok" && r.value).toContain("consistent");
  });

  describe("manifest", () => {
    const manifest = "plugins/demo/.claude-plugin/plugin.json";

    it("fails when missing", () => {
      rmSync(join(root, manifest));
      expect(failure()).toContain("missing .claude-plugin/plugin.json");
    });

    it("fails when not valid JSON", () => {
      put(manifest, '{ "name": "demo",, }');
      expect(failure()).toContain("plugin.json: not valid JSON");
    });

    it("fails when the top level is not an object", () => {
      put(manifest, "[]");
      expect(failure()).toContain("plugin.json: top level is not a JSON object");
    });

    it("fails when a required key is missing or empty", () => {
      put(manifest, '{ "name": "demo", "version": "0.1.0" }');
      expect(failure()).toContain("missing or empty 'description'");
      put(manifest, '{ "name": "demo", "version": "", "description": "x" }');
      expect(failure()).toContain("missing or empty 'version'");
    });

    it("fails when the name does not match the plugin directory", () => {
      put(manifest, '{ "name": "stale", "version": "1", "description": "x" }');
      expect(failure()).toContain("name 'stale' does not match plugin directory 'demo'");
    });
  });

  describe("skills and agents", () => {
    it("passes a single-skill plugin with a root SKILL.md", () => {
      put("plugins/demo/SKILL.md", doc("demo"));
      expect(check().tag).toBe("ok");
    });

    it("fails when a root SKILL.md name does not match the plugin directory", () => {
      put("plugins/demo/SKILL.md", doc("other"));
      expect(failure()).toContain("does not match plugin directory 'demo'");
    });

    it("fails when a skill directory has no SKILL.md", () => {
      mkdirSync(join(root, "plugins/demo/skills/empty-skill"), { recursive: true });
      expect(failure()).toContain("empty-skill: missing SKILL.md");
    });

    it("fails when a skill name does not match its directory", () => {
      skill("my-skill", "wrong-name");
      expect(failure()).toContain("does not match skill directory 'my-skill'");
    });

    it("fails when an agent name does not match its filename", () => {
      agent("my-agent", "wrong-name");
      expect(failure()).toContain("does not match filename 'my-agent'");
    });

    it("fails when SKILL.md has no frontmatter delimiter", () => {
      put("plugins/demo/skills/no-fm/SKILL.md", "# Just a heading\n");
      expect(failure()).toContain("frontmatter missing 'name'");
    });

    it("fails when the description is empty", () => {
      put("plugins/demo/skills/blank/SKILL.md", "---\nname: blank\ndescription:\n---\n");
      expect(failure()).toContain("non-empty 'description'");
    });

    it("accepts a block-scalar description and a trailing comment", () => {
      put(
        "plugins/demo/skills/block/SKILL.md",
        "---\nname: block\ndescription: |\n  Multi-line\n---\n",
      );
      put(
        "plugins/demo/skills/trailing/SKILL.md",
        "---\nname: trailing\ndescription: real # note\n---\n",
      );
      expect(check().tag).toBe("ok");
    });

    it("reports every offender, not just the first", () => {
      skill("skill-a", "wrong-a");
      skill("skill-b", "wrong-b");
      const message = failure();
      expect(message).toContain("skill-a");
      expect(message).toContain("skill-b");
    });
  });

  describe("shipped skill scripts", () => {
    it("fails when a script is not executable, passes once it is", () => {
      skill("scripted");
      const script = put("plugins/demo/skills/scripted/scripts/tool.sh", "#!/bin/sh\n");
      expect(failure()).toContain(`${script}: not executable (chmod +x)`);
      chmodSync(script, 0o755);
      expect(check().tag).toBe("ok");
    });

    it("also checks .py scripts and a root-skill plugin's scripts/", () => {
      put("plugins/demo/SKILL.md", doc("demo"));
      put("plugins/demo/scripts/tool.py", "#!/usr/bin/env python3\n");
      expect(failure()).toContain("tool.py: not executable");
    });
  });

  describe("hooks/hooks.json", () => {
    it("passes when absent or well-formed", () => {
      expect(check().tag).toBe("ok");
      hooks('{ "hooks": { "SessionStart": [] } }');
      expect(check().tag).toBe("ok");
    });

    it("fails when not valid JSON", () => {
      hooks('{ "hooks":, }');
      expect(failure()).toContain("hooks/hooks.json: not valid JSON");
    });

    it("fails when the top level is not an object", () => {
      hooks("[]");
      expect(failure()).toContain("top level is not a JSON object");
    });

    it("fails when hooks.json is a directory", () => {
      mkdirSync(join(root, "plugins/demo/hooks/hooks.json"), { recursive: true });
      expect(failure()).toContain("hooks/hooks.json: unreadable: Is a directory");
    });

    it("fails when hooks.json is a broken symlink", () => {
      mkdirSync(join(root, "plugins/demo/hooks"), { recursive: true });
      symlinkSync(
        join(root, "plugins/demo/hooks/gone.json"),
        join(root, "plugins/demo/hooks/hooks.json"),
      );
      expect(failure()).toContain("hooks/hooks.json");
    });

    it("passes an executable command in the flat format", () => {
      put("plugins/demo/scripts/run.sh", "#!/bin/sh\n", 0o755);
      hooks('{ "SessionStart": [ { "command": "${CLAUDE_PLUGIN_ROOT}/scripts/run.sh --flag" } ] }');
      expect(check().tag).toBe("ok");
    });

    it("passes the real nested format with a quoted-root command", () => {
      put("plugins/demo/scripts/run.sh", "#!/bin/sh\n", 0o755);
      hooks(nestedHook('"${CLAUDE_PLUGIN_ROOT}"/scripts/run.sh'));
      expect(check().tag).toBe("ok");
    });

    it("fails a nested command whose path does not exist", () => {
      hooks(nestedHook('"${CLAUDE_PLUGIN_ROOT}"/scripts/ghost.sh'));
      const message = failure();
      expect(message).toContain("command path not found");
      expect(message).toContain("scripts/ghost.sh");
    });

    it("fails a command that exists but is not executable", () => {
      put("plugins/demo/scripts/noexec.sh", "#!/bin/sh\n", 0o644);
      hooks('{ "SessionStart": [ { "command": "${CLAUDE_PLUGIN_ROOT}/scripts/noexec.sh" } ] }');
      expect(failure()).toContain("command path not executable");
    });

    it("ignores commands that do not start with the plugin root", () => {
      hooks('{ "SessionStart": [ { "command": "/usr/bin/env bash" } ] }');
      expect(check().tag).toBe("ok");
    });
  });

  describe("scripts/plugin-hooks.sh table", () => {
    const table = (cmd: string, legacy: string): void => {
      put(
        "scripts/plugin-hooks.sh",
        `PLUGIN_HOOK_CMDS=(\n  "${cmd.replaceAll('"', '\\"')}"\n)\nPLUGIN_HOOK_LEGACY_CMDS=(\n  "${legacy}"\n)\n`,
      );
    };
    const LIVE = 'node "$HOME/.claude/skills/demo/scripts/ts/h.ts"';
    const OLD = "$HOME/.claude/skills/demo/scripts/old.sh";

    it("passes when the registered file exists and the legacy one does not", () => {
      put("plugins/demo/scripts/ts/h.ts", "");
      table(LIVE, OLD);
      expect(check().tag).toBe("ok");
    });

    it("fails when a registered hook has no file", () => {
      table(LIVE, OLD);
      expect(failure()).toContain("registered hook has no file");
    });

    it("fails when a registered hook is outside ~/.claude/skills", () => {
      table('node "/opt/x.ts"', OLD);
      expect(failure()).toContain("not under ~/.claude/skills");
    });

    it("fails when a legacy path still exists on disk", () => {
      put("plugins/demo/scripts/ts/h.ts", "");
      put("plugins/demo/scripts/old.sh", "");
      table(LIVE, OLD);
      expect(failure()).toContain("legacy command is still live");
    });
  });

  describe("arguments and tree-level failures", () => {
    it("-h and --help print usage and succeed without touching ROOT", () => {
      for (const flag of ["-h", "--help"]) {
        const r = main([flag, join(root, "absent")], {}, { readFile: readTextFile });
        expect(r.tag === "ok" && r.value).toBe(USAGE);
      }
    });

    it("exits 2 when ROOT does not exist", () => {
      const r = check(join(root, "no-such-dir"));
      expect(r.tag === "err" && r.error.code).toBe(2);
      expect(r.tag === "err" && r.error.message).toContain("ROOT does not exist");
    });

    it("exits 1 when there are no plugins", () => {
      rmSync(join(root, "plugins"), { recursive: true });
      mkdirSync(join(root, "plugins"));
      const r = check();
      expect(r.tag === "err" && r.error.code).toBe(1);
      expect(r.tag === "err" && r.error.message).toContain("no plugins found");
    });

    it("handles a plugin directory name containing quotes (no code is built from paths)", () => {
      plugin("it's \"odd\"");
      expect(check().tag).toBe("ok");
    });
  });
});

describe("end to end (spawns node)", () => {
  const exec = (...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

  it("the repo's own plugin tree is consistent (exit 0, stdout line)", () => {
    const r = exec(REPO_ROOT);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("consistent");
  });

  it("defaults ROOT to the current directory", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("exit 2 with the error on stderr for a missing ROOT", () => {
    const r = exec(join(REPO_ROOT, "no-such-dir"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("::error::ROOT does not exist");
  });

  it("-h exits 0 with usage on stdout", () => {
    const r = exec("-h");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Usage: check-plugin-structure.ts");
  });

  it("exit 1 with the findings on stderr", () => {
    const dir = mkdtempSync(join(tmpdir(), "plugin-structure-e2e-"));
    try {
      mkdirSync(join(dir, "plugins", "bare"), { recursive: true });
      const r = exec(dir);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("::error::Plugin structure validation failed:");
      expect(r.stderr).toContain("bare: missing .claude-plugin/plugin.json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
