import { describe, expect, it } from "vitest";
import { buildSnapshot, main, type Gh } from "./pr-snapshot.ts";

type Over = Record<string, unknown>;
const pr = (o: Over = {}) => ({
  number: 7, title: "t", url: "u", author: { login: "me" }, headRefName: "b", baseRefName: "main",
  headRefOid: "abc", isDraft: false, isCrossRepository: false, state: "OPEN",
  mergeStateStatus: "CLEAN", mergeable: "MERGEABLE",
  statusCheckRollup: [{ name: "ci", status: "COMPLETED", conclusion: "SUCCESS" }], ...o,
});

const RUNS = "run list --commit abc -R o/r --limit 100 --json databaseId,workflowName,attempt,conclusion,url";
const ISSUES = "api repos/o/r/issues/7/comments?per_page=100";
const REVIEWS = "api repos/o/r/pulls/7/reviews?per_page=100";

/** A `gh` shim: matches on the args joined by space, throws on anything unplanned. */
const shim = (prs: unknown[], extra: Record<string, unknown> = {}): Gh => (args) => {
  const key = args.join(" ");
  const table: Record<string, unknown> = {
    "api user --jq .login": "me\n",
    "repo view --json nameWithOwner": { nameWithOwner: "o/r" },
    "pr checks 7 --required --json name": [{ name: "ci" }],
    [RUNS]: [],
    [ISSUES]: [],
    [REVIEWS]: [],
    ...extra,
  };
  if (args[0] === "pr" && args[1] === "list") return JSON.stringify(prs);
  if (args[0] === "pr" && args[1] === "view") return JSON.stringify(prs[0]);
  if (args[0] === "api" && args[1] === "graphql") {
    const rt = extra.threads ?? { pageInfo: { hasNextPage: false }, nodes: [] };
    return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: rt } } } });
  }
  if (!(key in table)) throw new Error(`unexpected gh ${key}`);
  const v = table[key];
  return typeof v === "string" ? v : JSON.stringify(v);
};

const thread = (last: string, resolved = false) => ({
  id: "T1", isResolved: resolved, isOutdated: false, path: "a.ts", line: 3,
  comments: { pageInfo: { hasNextPage: false }, nodes: [{ databaseId: 1, author: { login: last }, body: "x", url: "u", createdAt: "2026-01-01T00:00:00Z" }] },
});
const threads = (...nodes: unknown[]) => ({ threads: { pageInfo: { hasNextPage: false }, nodes } });
/** Assert the first PR of a snapshot built from `g` matches `want`. */
const is = (g: Gh, want: object) => {
  expect(buildSnapshot(g).prs[0]).toMatchObject(want);
};
const ghComment = (id: number, login: string, at: string) => ({ id, user: { login }, body: "b", html_url: "u", created_at: at });

describe("buildSnapshot", () => {
  it("emits the contract envelope and ready-to-merge for a clean PR", () => {
    const s = buildSnapshot(shim([pr()]), undefined, new Date("2026-01-02T00:00:00Z"));
    expect(s).toMatchObject({ generatedAt: "2026-01-02T00:00:00.000Z", repo: "o/r", selfLogin: "me", pacingHint: "long" });
    is(shim([pr()]), { recommendation: "ready-to-merge", skipped: null, checks: [{ name: "ci", state: "pass", required: true }] });
  });

  it.each([
    [{ state: "CLOSED" }, "not-open"],
    [{ isDraft: true }, "draft"],
    [{ isCrossRepository: true }, "cross-repo-fork"],
  ])("skips %j as %s", (over, reason) => {
    is(shim([pr(over)]), { recommendation: "skip", skipped: { reason } });
  });

  it("routes merge state: DIRTY, BEHIND, UNKNOWN", () => {
    is(shim([pr({ mergeStateStatus: "DIRTY", mergeable: "CONFLICTING" })]), { recommendation: "resolve-conflicts" });
    is(shim([pr({ mergeStateStatus: "BEHIND" })]), { recommendation: "update-branch" });
    is(shim([pr({ mergeable: "UNKNOWN" })]), { recommendation: "wait-ci" });
  });

  it("distinguishes real failure from CANCELLED and pending", () => {
    const roll = (conclusion: string, status = "COMPLETED") =>
      shim([pr({ mergeStateStatus: "BLOCKED", statusCheckRollup: [{ name: "ci", status, conclusion }] })]);
    is(roll("FAILURE"), { recommendation: "fix-ci" });
    is(roll("CANCELLED"), { recommendation: "escalate" });
    is(roll("", "IN_PROGRESS"), { recommendation: "wait-ci" });
  });

  it("flags failed runs with a rerun budget by attempt", () => {
    const runs = [
      { databaseId: 1, workflowName: "CI", attempt: 1, conclusion: "failure", url: "u" },
      { databaseId: 2, workflowName: "CI", attempt: 2, conclusion: "failure", url: "u" },
      { databaseId: 3, workflowName: "CI", attempt: 1, conclusion: "cancelled", url: "u" },
    ];
    is(shim([pr()], { [RUNS]: runs }), { failedRuns: [{ runId: 1, rerunBudgetLeft: true }, { runId: 2, rerunBudgetLeft: false }] });
  });

  it("address-reviews only when the last thread comment is not mine", () => {
    is(shim([pr()], threads(thread("rev"))), { recommendation: "address-reviews" });
    is(shim([pr()], threads(thread("me"))), { recommendation: "ready-to-merge" });
    is(shim([pr()], threads(thread("rev", true))), { unresolvedThreads: [] });
  });

  it("general comments need action until I reply; review bodies count", () => {
    is(
      shim([pr()], {
        [ISSUES]: [ghComment(1, "rev", "2026-01-01")],
        [REVIEWS]: [
          { id: 2, user: { login: "rev" }, body: "b", html_url: "u", submitted_at: "2026-01-02" },
          { id: 3, user: { login: "rev" }, body: "", html_url: "u", submitted_at: "2026-01-03" },
        ],
      }),
      { recommendation: "address-reviews", generalComments: [{ id: 1 }, { id: 2 }] },
    );
    is(shim([pr()], { [ISSUES]: [ghComment(1, "rev", "2026-01-01"), ghComment(2, "me", "2026-01-02")] }), {
      recommendation: "ready-to-merge",
      generalComments: [{ id: 1, needsAction: false }],
    });
  });

  it("never ready-to-merge when truncated", () => {
    const t = { pageInfo: { hasNextPage: true }, nodes: [] };
    is(shim([pr()], { threads: t }), { threadsTruncated: true, recommendation: "escalate" });
    const full = Array.from({ length: 100 }, (_, i) => ghComment(i, "me", "2026-01-01"));
    is(shim([pr()], { [ISSUES]: full }), { generalCommentsTruncated: true, recommendation: "escalate" });
  });

  it("degrades a per-PR gh failure to snapshot-error with detail", () => {
    const ok = shim([pr()]);
    const g: Gh = (a) => {
      if (a[0] === "run") throw new Error("boom");
      return ok(a);
    };
    is(g, { recommendation: "escalate", skipped: { reason: "snapshot-error", detail: "boom" } });
  });

  it("pacingHint is short while anything is actionable", () => {
    expect(buildSnapshot(shim([pr({ mergeStateStatus: "BEHIND" })])).pacingHint).toBe("short");
  });

  it("--pr snapshots only that PR", () => {
    expect(buildSnapshot(shim([pr()]), "7").prs).toHaveLength(1);
  });
});

describe("main", () => {
  it("prints help, rejects bad usage, wraps gh failure, prints JSON", () => {
    expect(main(["--help"], shim([]))).toMatchObject({ code: 0 });
    expect(main(["--bogus"], shim([])).code).toBe(2);
    expect(main(["--pr"], shim([])).code).toBe(2);
    const bad: Gh = () => {
      throw new Error("no auth");
    };
    expect(main([], bad)).toMatchObject({ code: 1, err: "pr-snapshot: no auth\n" });
    expect(JSON.parse(main(["--pr", "7"], shim([pr()])).out)).toMatchObject({ repo: "o/r" });
  });
});
