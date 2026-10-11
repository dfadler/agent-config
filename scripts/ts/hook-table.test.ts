import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allHookForms, HOOK_TABLE_FILE, parseHookTable } from "./hook-table.ts";

const row = "PreToolUse\tEdit|Write\tworktree-core\tworktree-core/a.ts\tworktree-core/old.sh";

describe("parseHookTable", () => {
  it("parses rows, skips comments and blanks, and maps - to no matcher", () => {
    const r = parseHookTable(`# c\n\n${row}\nStop\t-\tmh\tmh/s.ts\tmh/o.sh\n`);
    expect(r).toEqual({
      tag: "ok",
      value: [
        { event: "PreToolUse", matcher: "Edit|Write", feature: "worktree-core", script: "worktree-core/a.ts", legacy: "worktree-core/old.sh" },
        { event: "Stop", matcher: "", feature: "mh", script: "mh/s.ts", legacy: "mh/o.sh" },
      ],
    });
  });

  it.each([
    ["too few columns", "Stop\t-\tmh\n"],
    ["too many columns", `${row}\textra\n`],
    ["an empty column", "Stop\t\tmh\ta\tb\n"],
  ])("rejects %s with the line number", (_l, text) => {
    const r = parseHookTable(`# header\n${text}`);
    expect(r.tag === "err" && r.error).toContain("line 2");
  });

  it("builds the exec, shell and legacy forms under HOME", () => {
    const r = parseHookTable(`${row}\n`);
    const first = r.tag === "ok" ? r.value[0] : undefined;
    expect(first && allHookForms(first, "/h")).toEqual([
      { command: "node", args: ["/h/.claude/skills/worktree-core/a.ts"] },
      { command: 'node "/h/.claude/skills/worktree-core/a.ts"' },
      { command: "/h/.claude/skills/worktree-core/old.sh" },
    ]);
  });

  it("parses the real table", () => {
    const text = readFileSync(join(import.meta.dirname, "..", "..", HOOK_TABLE_FILE), "utf8");
    const r = parseHookTable(text);
    expect(r.tag === "ok" && r.value.length).toBeGreaterThanOrEqual(4);
  });
});
