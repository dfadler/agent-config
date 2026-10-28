// PreToolUse hook (Bash): ask before `gh pr create`, `gh issue create`,
// `gh issue comment` or `git push` aimed at a repo the user does not own, such
// as a fork's parent (#722). The allowlist is the owner of `origin` plus the
// owners in GH_PROTECTED_REMOTE_ALLOW (comma-separated). Set
// GH_PROTECTED_REMOTE_OVERRIDE=1 to skip the check. It asks, never denies, and
// fails open: any internal problem means "no opinion". Standalone: node builtins only.
import { spawnSync } from "node:child_process";

export type Run = (
  cmd: string,
  args: readonly string[],
  cwd?: string,
) => { readonly status: number; readonly stdout: string };
export type Env = Readonly<Record<string, string | undefined>>;

const GH_CMD = /^gh\s+(pr\s+create|issue\s+create|issue\s+comment)\b/;
const GIT_PUSH = /^git\s+(?:-C\s+\S+\s+)?push\b/;

/** `owner` from an https or ssh GitHub remote URL. */
export const ownerOf = (url: string): string | undefined =>
  /github\.com[:/]([^/\s]+)\/[^/\s]+/.exec(url.trim())?.[1];

const gitIn = (dir?: string): string[] => (dir === undefined ? [] : ["-C", dir]);

const words = (s: string): string[] => s.split(/\s+/).filter((w) => w !== "");

/** The `-R`/`--repo` value in a gh command, as `owner/name`. */
const repoFlag = (w: readonly string[]): string | undefined => {
  const i = w.findIndex((x) => x === "-R" || x === "--repo");
  if (i !== -1) return w[i + 1];
  return w.find((x) => x.startsWith("--repo="))?.slice(7);
};

/** A reason to ask, or undefined when the command is fine. */
export const checkCommand = (
  command: string,
  run: Run,
  env: Env,
): string | undefined => {
  if (/^(1|true|yes)$/.test(env["GH_PROTECTED_REMOTE_OVERRIDE"] ?? "")) {
    return undefined;
  }
  const extra = (env["GH_PROTECTED_REMOTE_ALLOW"] ?? "")
    .split(",")
    .map((o) => o.trim().toLowerCase())
    .filter((o) => o !== "");
  // Owners we may publish to: the owner of `origin` in `dir` (the hook's cwd
  // when undefined) plus the env allowlist. Undefined: no baseline to compare with.
  const allowedIn = (dir?: string): Set<string> | undefined => {
    const u = run("git", [...gitIn(dir), "remote", "get-url", "origin"]);
    const origin = u.status === 0 ? ownerOf(u.stdout) : undefined;
    return origin === undefined
      ? undefined
      : new Set([origin.toLowerCase(), ...extra]);
  };
  let allowed = allowedIn();
  if (allowed === undefined) return undefined;
  // ponytail: splits on ; & | only, so a command hidden in a subshell is not seen.
  for (const part of command.split(/&&|\|\||;|\|/).map((p) => p.trim())) {
    const w = words(part);
    let target: string | undefined;
    if (GH_CMD.test(part)) {
      const flag = repoFlag(w);
      if (flag !== undefined) {
        target = flag.split("/").at(-2);
      } else {
        const v = run("gh", [
          "repo",
          "view",
          "--json",
          "owner,isFork,parent",
          "--jq",
          // gh pr create in a fork opens the PR on the parent.
          part.startsWith("gh pr create")
            ? ".parent.owner.login // .owner.login"
            : ".owner.login",
        ]);
        target = v.status === 0 ? v.stdout.trim() : undefined;
      }
    } else if (GIT_PUSH.test(part)) {
      const dir = w[1] === "-C" ? w[2] : undefined;
      const a = allowedIn(dir);
      if (a === undefined) continue;
      allowed = a;
      const rest = w.slice(w.indexOf("push") + 1);
      const i = rest.indexOf("--repo");
      const repo =
        i !== -1
          ? rest[i + 1]
          : rest.find((x) => x.startsWith("--repo="))?.slice(7);
      let remote = repo ?? rest.find((x) => !x.startsWith("-"));
      if (remote === undefined) {
        // Bare push: the branch's push target, else origin.
        const pt = run("git", [
          ...gitIn(dir),
          "rev-parse",
          "--abbrev-ref",
          "@{push}",
        ]);
        remote = (pt.status === 0 ? pt.stdout.trim().split("/")[0] : "") || "origin";
      }
      const u = /^[\w.-]+$/.test(remote)
        ? run("git", [...gitIn(dir), "remote", "get-url", "--push", remote])
        : { status: 0, stdout: remote };
      target = u.status === 0 ? ownerOf(u.stdout) : undefined;
    } else continue;
    if (
      target !== undefined &&
      target !== "" &&
      !allowed.has(target.toLowerCase())
    ) {
      return `This would publish to '${target}', not an owner you control (${[...allowed].join(", ")}). Confirm the target is intended; set GH_PROTECTED_REMOTE_OVERRIDE=1 or add the owner to GH_PROTECTED_REMOTE_ALLOW to skip this check.`;
    }
  }
  return undefined;
};

const realRun: Run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, [...args], { encoding: "utf8", timeout: 10_000, cwd });
  return { status: r.status ?? 1, stdout: r.stdout };
};

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === "object" && v !== null;

/** stdin JSON in, stdout JSON out ("" = no opinion). Never throws. */
export const runHook = (raw: string, run: Run, env: Env): string => {
  try {
    const e: unknown = JSON.parse(raw);
    if (!isRecord(e) || e["tool_name"] !== "Bash") return "";
    const input = e["tool_input"];
    const command = isRecord(input) ? input["command"] : undefined;
    if (typeof command !== "string") return "";
    // Resolve remotes in the event's repository, not the hook process's cwd.
    const cwd = typeof e["cwd"] === "string" ? e["cwd"] : undefined;
    const reason = checkCommand(command, (c, a) => run(c, a, cwd), env);
    return reason === undefined
      ? ""
      : `${JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "ask",
            permissionDecisionReason: reason,
          },
        })}\n`;
  } catch {
    return "";
  }
};

if (import.meta.main) {
  const chunks: string[] = [];
  for await (const c of process.stdin) chunks.push(String(c));
  process.stdout.write(runHook(chunks.join(""), realRun, process.env));
}
