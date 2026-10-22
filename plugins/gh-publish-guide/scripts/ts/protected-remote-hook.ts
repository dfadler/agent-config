// PreToolUse(Bash) hook: ask before `gh pr create`, `gh issue create`,
// `gh issue comment` or `git push` targets a repo the user does not own, e.g.
// a fork's parent. An `ask`, never a deny; the user can approve it.
//
// Owned = repo owner is the authenticated gh user or listed in
// GH_PUBLISH_OWNERS (comma-separated, for orgs). Override: GH_PUBLISH_GUARD=off.
// Fails open (exit 0, no output) on anything it cannot determine.
//
// ponytail: splits the command on && ; | and matches the four verbs only;
// `git -C dir push`, aliases and `gh api` POSTs are not seen. Add when needed.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export interface Deps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdin: string;
  readonly run: (
    cwd: string,
    cmd: string,
    args: readonly string[],
  ) => { readonly status: number; readonly stdout: string };
  readonly out: (text: string) => void;
}

const GH_VERB = /^gh\s+(?:pr\s+create|issue\s+create|issue\s+comment)\b/;
const GIT_PUSH = /^git\s+push\b/;

/** owner/name from a GitHub remote URL (https or ssh), else undefined. */
export const slugOf = (url: string): string | undefined =>
  /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/.exec(url.trim())?.[1];

const repoFlag = (seg: string): string | undefined =>
  /(?:^|\s)(?:--repo[=\s]|-R\s*)(\S+)/.exec(seg)?.[1];

export const run = (d: Deps): number => {
  if (d.env["GH_PUBLISH_GUARD"] === "off") return 0;
  let cwd = "";
  let command = "";
  try {
    const i: unknown = JSON.parse(d.stdin);
    if (typeof i !== "object" || i === null) return 0;
    const ti: unknown = Reflect.get(i, "tool_input");
    const c: unknown = Reflect.get(i, "cwd");
    const cmd: unknown =
      typeof ti === "object" && ti !== null ? Reflect.get(ti, "command") : "";
    if (typeof cmd !== "string") return 0;
    command = cmd;
    cwd = typeof c === "string" ? c : "";
  } catch {
    return 0;
  }

  const me = d.run(cwd, "gh", ["api", "user", "--jq", ".login"]);
  if (me.status !== 0 || me.stdout.trim() === "") return 0;
  const owners = [
    me.stdout.trim(),
    ...(d.env["GH_PUBLISH_OWNERS"] ?? "").split(",").map((s) => s.trim()),
  ].map((s) => s.toLowerCase());

  for (const seg of command.split(/&&|;|\|/).map((s) => s.trim())) {
    let slug: string | undefined;
    let what: string;
    if (GH_VERB.test(seg)) {
      what = GH_VERB.exec(seg)?.[0] ?? "gh";
      slug = repoFlag(seg);
      if (slug === undefined) {
        const r = d.run(cwd, "gh", [
          "repo",
          "view",
          "--json",
          "nameWithOwner",
          "--jq",
          ".nameWithOwner",
        ]);
        slug = r.status === 0 ? r.stdout.trim() : undefined;
      }
    } else if (GIT_PUSH.test(seg)) {
      what = "git push";
      const positional = seg
        .split(/\s+/)
        .slice(2)
        .filter((a) => !a.startsWith("-"));
      const remote = positional[0] ?? "origin";
      const r = d.run(cwd, "git", ["remote", "get-url", "--push", remote]);
      slug = r.status === 0 ? slugOf(r.stdout) : slugOf(remote);
    } else continue;

    const owner = slug?.split("/")[0]?.toLowerCase();
    if (slug === undefined || owner === undefined || owner === "") continue;
    if (owners.includes(owner)) continue;
    d.out(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: `"${what}" targets ${slug}, which you do not own (possibly a fork's parent). Confirm, or set GH_PUBLISH_GUARD=off / add the owner to GH_PUBLISH_OWNERS.`,
        },
      })}\n`,
    );
    return 0;
  }
  return 0;
};

if (import.meta.main) {
  try {
    process.exitCode = run({
      env: process.env,
      stdin: readFileSync(0, "utf8"),
      run: (cwd, cmd, args) => {
        const r = spawnSync(cmd, [...args], {
          cwd: cwd || undefined,
          encoding: "utf8",
        });
        return { status: r.status ?? 1, stdout: r.stdout };
      },
      out: (t) => process.stdout.write(t),
    });
  } catch {
    process.exitCode = 0;
  }
}
