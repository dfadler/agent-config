// Default snapshot for the pr-babysit skill: `gh` only, node builtins only (a
// plugin installs on its own). Emits the JSON contract in
// skills/pr-babysit/SKILL.md. A project overrides it by supplying its own
// snapshot command that emits the same contract.
//
// Usage: pr-snapshot.ts [-h|--help] [--pr <number-or-url>]
// Exit codes: 0 ok, 1 gh failed, 2 bad usage.
import { spawnSync } from "node:child_process";

export const USAGE = `Usage: pr-snapshot.ts [-h|--help] [--pr <number-or-url>]

Print the pr-babysit snapshot JSON for every open PR in the current repo, or
for one PR with --pr. Needs an authenticated \`gh\`.
`;

/** Runs `gh` with args, returns stdout. Injected so tests need no network. */
export type Gh = (args: readonly string[]) => string;

export const realGh: Gh = (args) => {
  const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 64 << 20 });
  // `gh pr checks` exits non-zero for failing/pending checks but still prints.
  if (r.error || (r.status !== 0 && !r.stdout)) {
    throw new Error((r.error?.message ?? r.stderr.trim()) || `gh ${args[0] ?? ""} failed`);
  }
  return r.stdout;
};

// The one untyped boundary: gh's --json output has the documented shape.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters, @typescript-eslint/consistent-type-assertions
const json = <T>(gh: Gh, args: readonly string[]): T => JSON.parse(gh(args) || "null") as T;

interface Login { login: string }
interface Rollup { name?: string; context?: string; status?: string; conclusion?: string; state?: string }
interface RawPr {
  number: number; title: string; url: string; author?: Login; headRefName: string; baseRefName: string;
  headRefOid: string; isDraft: boolean; isCrossRepository: boolean; state: string;
  mergeStateStatus: string; mergeable: string; statusCheckRollup?: Rollup[];
}
interface RawRun { databaseId: number; workflowName: string; attempt: number; conclusion: string; url: string }
interface RawComment { id: number; user?: Login; body: string; html_url: string; created_at?: string; submitted_at?: string }
interface RawThread {
  id: string; isResolved: boolean; isOutdated: boolean; path?: string; line?: number;
  comments: { pageInfo: { hasNextPage: boolean }; nodes: { databaseId: number; author?: Login; body: string; url: string; createdAt: string }[] };
}
interface Threads { pageInfo: { hasNextPage: boolean }; nodes: RawThread[] }
interface GqlThreads { data: { repository: { pullRequest: { reviewThreads: Threads } } } }

const FIELDS =
  "number,title,url,author,headRefName,baseRefName,headRefOid,isDraft,isCrossRepository,state,mergeStateStatus,mergeable,statusCheckRollup";
const MAX_ATTEMPTS = 2; // rerunBudgetLeft: a run gets one rerun
const PAGE = 100; // a full page means there may be more

type Rec =
  | "skip" | "wait-ci" | "update-branch" | "resolve-conflicts"
  | "fix-ci" | "address-reviews" | "ready-to-merge" | "escalate";

const conclusionOf = (c: Rollup): string => (c.conclusion ?? c.state ?? "").toUpperCase();

const checkState = (c: Rollup): "pass" | "pending" | "fail" | "skip" => {
  // CheckRun has status/conclusion; StatusContext has only state.
  const concl = conclusionOf(c);
  if (c.status && c.status !== "COMPLETED") return "pending";
  if (["SUCCESS", "NEUTRAL"].includes(concl)) return "pass";
  if (["PENDING", "EXPECTED", ""].includes(concl)) return "pending";
  if (["SKIPPED", "STALE"].includes(concl)) return "skip";
  return "fail";
};

const requiredNames = (gh: Gh, pr: string): Set<string> => {
  try {
    return new Set((json<{ name: string }[] | null>(gh, ["pr", "checks", pr, "--required", "--json", "name"]) ?? []).map((c) => c.name));
  } catch {
    return new Set(); // no required checks configured
  }
};

const threadsOf = (gh: Gh, repo: string, n: number, self: string) => {
  const [owner = "", name = ""] = repo.split("/");
  const q = `query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p){reviewThreads(first:${String(PAGE)}){pageInfo{hasNextPage} nodes{id isResolved isOutdated path line comments(first:${String(PAGE)}){pageInfo{hasNextPage} nodes{databaseId author{login} body url createdAt}}}}}}}`;
  const rt = json<GqlThreads>(gh, ["api", "graphql", "-f", `query=${q}`, "-F", `o=${owner}`, "-F", `n=${name}`, "-F", `p=${String(n)}`])
    .data.repository.pullRequest.reviewThreads;
  const unresolved = rt.nodes.filter((t) => !t.isResolved).map((t) => {
    const comments = t.comments.nodes.map((c) => ({
      id: c.databaseId, author: c.author?.login ?? "ghost", body: c.body, url: c.url, createdAt: c.createdAt,
    }));
    return {
      threadId: t.id, path: t.path ?? null, line: t.line ?? null, isOutdated: t.isOutdated,
      truncated: t.comments.pageInfo.hasNextPage, needsAction: comments.at(-1)?.author !== self, comments,
    };
  });
  return { unresolved, truncated: rt.pageInfo.hasNextPage };
};

const generalOf = (gh: Gh, repo: string, n: number, self: string) => {
  const issue = json<RawComment[]>(gh, ["api", `repos/${repo}/issues/${String(n)}/comments?per_page=${String(PAGE)}`]);
  const reviews = json<RawComment[]>(gh, ["api", `repos/${repo}/pulls/${String(n)}/reviews?per_page=${String(PAGE)}`]);
  const shape = (c: RawComment) => ({
    id: c.id, author: c.user?.login ?? "ghost", body: c.body, url: c.html_url, createdAt: c.created_at ?? c.submitted_at ?? "",
  });
  const all = [
    ...issue.map(shape),
    // A review with no body is just inline comments, which threads already cover.
    ...reviews.filter((r) => r.body).map(shape),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lastSelf = all.findLast((c) => c.author === self)?.createdAt ?? "";
  return {
    comments: all.filter((c) => c.author !== self).map((c) => ({ ...c, needsAction: c.createdAt > lastSelf })),
    truncated: issue.length >= PAGE || reviews.length >= PAGE,
  };
};

const failedRunsOf = (gh: Gh, repo: string, sha: string) =>
  json<RawRun[]>(gh, ["run", "list", "--commit", sha, "-R", repo, "--limit", String(PAGE), "--json", "databaseId,workflowName,attempt,conclusion,url"])
    .filter((r) => ["failure", "timed_out", "startup_failure"].includes(r.conclusion))
    .map((r) => ({
      runId: r.databaseId, workflow: r.workflowName, runAttempt: r.attempt, conclusion: r.conclusion.toUpperCase(),
      url: r.url, rerunBudgetLeft: r.attempt < MAX_ATTEMPTS,
    }));

const snapshotPr = (gh: Gh, repo: string, self: string, p: RawPr) => {
  const base = {
    number: p.number, title: p.title, url: p.url, author: p.author?.login ?? "ghost",
    headRefName: p.headRefName, baseRefName: p.baseRefName, headSha: p.headRefOid, isDraft: p.isDraft,
  };
  const skip = (reason: string, detail?: string, recommendation: Rec = "skip") => ({
    ...base, skipped: { reason, ...(detail ? { detail } : {}) }, recommendation,
  });
  if (p.state !== "OPEN") return skip("not-open");
  if (p.isDraft) return skip("draft");
  if (p.isCrossRepository) return skip("cross-repo-fork");
  try {
    const required = requiredNames(gh, String(p.number));
    const checks = (p.statusCheckRollup ?? []).map((c) => ({
      name: c.name ?? c.context ?? "", state: checkState(c),
      conclusion: (conclusionOf(c) || (c.status ?? "").toUpperCase()),
      required: required.has(c.name ?? c.context ?? ""),
    }));
    const failedRuns = failedRunsOf(gh, repo, p.headRefOid);
    const th = threadsOf(gh, repo, p.number, self);
    const gc = generalOf(gh, repo, p.number, self);
    const ms = p.mergeStateStatus;
    const mergeable = p.mergeable === "MERGEABLE" && ["CLEAN", "UNSTABLE", "HAS_HOOKS"].includes(ms);
    const realFail = checks.some((c) => c.state === "fail" && c.conclusion !== "CANCELLED");
    const actionable = th.unresolved.some((t) => t.needsAction) || gc.comments.some((c) => c.needsAction);
    const truncated = th.truncated || gc.truncated || th.unresolved.some((t) => t.truncated);
    const recommendation: Rec =
      ms === "UNKNOWN" || p.mergeable === "UNKNOWN" ? "wait-ci"
      : ms === "DIRTY" ? "resolve-conflicts"
      : ms === "BEHIND" ? "update-branch"
      : actionable ? "address-reviews"
      : realFail ? "fix-ci"
      : checks.some((c) => c.state === "pending") ? "wait-ci"
      : mergeable && !truncated ? "ready-to-merge"
      : "escalate";
    return {
      ...base, skipped: null, recommendation,
      verdict: {
        mergeStateStatus: ms, mergeable,
        headline: mergeable ? `mergeable (${ms})` : `not mergeable (${ms})`,
        remedy: mergeable ? null : `resolve ${ms} state`,
      },
      checks, failedRuns,
      unresolvedThreads: th.unresolved, threadsTruncated: th.truncated,
      generalComments: gc.comments, generalCommentsTruncated: gc.truncated,
    };
  } catch (e) {
    return skip("snapshot-error", e instanceof Error ? e.message : String(e), "escalate");
  }
};

export const buildSnapshot = (gh: Gh, pr?: string, now: Date = new Date()) => {
  const self = gh(["api", "user", "--jq", ".login"]).trim();
  const repo = json<{ nameWithOwner: string }>(gh, ["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
  const raw = pr
    ? [json<RawPr>(gh, ["pr", "view", pr, "--json", FIELDS])]
    : json<RawPr[]>(gh, ["pr", "list", "--state", "open", "--limit", String(PAGE), "--json", FIELDS]);
  const prs = raw.map((p) => snapshotPr(gh, repo, self, p));
  const busy: Rec[] = ["wait-ci", "update-branch", "resolve-conflicts", "fix-ci", "address-reviews"];
  return {
    generatedAt: now.toISOString(), repo, selfLogin: self, prs,
    pacingHint: prs.some((p) => busy.includes(p.recommendation)) ? "short" : "long",
  };
};

export const main = (argv: readonly string[], gh: Gh = realGh): { code: number; out: string; err: string } => {
  if (argv.includes("-h") || argv.includes("--help")) return { code: 0, out: USAGE, err: "" };
  if (argv.length > 0 && !(argv[0] === "--pr" && argv.length === 2)) return { code: 2, out: "", err: USAGE };
  try {
    return { code: 0, out: JSON.stringify(buildSnapshot(gh, argv[1]), null, 2) + "\n", err: "" };
  } catch (e) {
    return { code: 1, out: "", err: `pr-snapshot: ${e instanceof Error ? e.message : String(e)}\n` };
  }
};

if (import.meta.main) {
  const r = main(process.argv.slice(2));
  process.stdout.write(r.out);
  process.stderr.write(r.err);
  process.exitCode = r.code;
}
