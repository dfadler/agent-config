/**
 * Filesystem side of the sync: the sync root, its manifest, and the
 * scan / plan / record / pull steps the skills drive.
 *
 * Everything here works on one explicit root directory and refuses paths that
 * would leave it. State lives in `<root>/.canvas-sync/`, which ignores itself
 * (it holds canvas IDs and conflict copies), so it never reaches git.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { hashText } from "../../../scripts/ts/hash.ts";
import { isSyncEnabled, parseFrontmatter, renderLocalFile } from "./frontmatter.ts";
import {
  bodyHash,
  emptyManifest,
  readManifest,
  carriedFields,
  withNavFields,
  writeManifest,
  type Manifest,
  type PendingDeletion,
} from "./manifest.ts";
import {
  buildNavBlocks,
  canvasUrl,
  parseRelated,
  planNav,
  type NavAction,
  type NavBlocks,
  type NavFile,
} from "./nav.ts";
import { normalizeLocal, type Normalized } from "./normalize.ts";
import {
  DELETE_STEPS,
  addPending,
  isScratchTitle,
  resolvePending,
  retireFile,
} from "./pending.ts";
import { applyPlan, nextEntry, planFile, type Plan } from "./plan.ts";
import {
  parseRemoteRead,
  toUpdateBatches,
  withNavEdit,
  type UpdateSection,
} from "./slack-read.ts";
import { validate, type Issue } from "./validate.ts";

export const STATE_DIR = ".canvas-sync";
const MANIFEST_FILE = "manifest.json";
const CONFLICT_DIR = "conflicts";

export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncError";
  }
}

// --- paths ---

/** Validate a path relative to the root: `/`-separated, inside it, `.md`. */
export function checkRelPath(rel: string): string {
  const segments = rel.split("/");
  if (
    rel === "" ||
    rel.startsWith("/") ||
    rel.includes("\\") ||
    rel.includes("\0") ||
    segments.some((segment) => segment === ".." || segment === "." || segment === "")
  ) {
    throw new SyncError(`path "${rel}" must be a relative path inside the sync root`);
  }
  if (segments[0] === STATE_DIR) {
    throw new SyncError(`path "${rel}" is inside the state directory`);
  }
  if (!rel.endsWith(".md")) throw new SyncError(`path "${rel}" is not a .md file`);
  return rel;
}

function absPath(root: string, rel: string): string {
  return join(root, ...checkRelPath(rel).split("/"));
}

function realRoot(root: string): string {
  if (!existsSync(root)) throw new SyncError(`sync root does not exist: ${root}`);
  return realpathSync(resolve(root));
}

/** Refuse to write through a symlink that leads outside the root. */
function assertInside(root: string, target: string): void {
  let probe = dirname(target);
  while (!existsSync(probe)) probe = dirname(probe);
  const real = realpathSync(probe);
  const base = realRoot(root);
  if (real !== base && !real.startsWith(base + sep)) {
    throw new SyncError(`refusing to write outside the sync root: ${target}`);
  }
}

function writeInside(root: string, target: string, content: string): void {
  assertInside(root, target);
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  writeFileSync(temp, content, "utf8");
  renameSync(temp, target);
}

// --- manifest on disk ---

function stateFile(root: string, ...parts: string[]): string {
  return join(root, STATE_DIR, ...parts);
}

export function loadManifest(root: string): Manifest {
  realRoot(root);
  const file = stateFile(root, MANIFEST_FILE);
  return existsSync(file) ? readManifest(readFileSync(file, "utf8")) : emptyManifest();
}

export function saveManifest(root: string, manifest: Manifest): void {
  const ignore = stateFile(root, ".gitignore");
  if (!existsSync(ignore)) {
    writeInside(root, ignore, "# Local sync state: canvas IDs and conflict copies.\n*\n");
  }
  writeInside(root, stateFile(root, MANIFEST_FILE), writeManifest(manifest));
}

// --- discovery ---

/** Every `.md` file under the root, as sorted relative paths. */
export function listMarkdown(root: string): string[] {
  const base = realRoot(root);
  const found: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}${entry.name}/`);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        found.push(`${prefix}${entry.name}`);
      }
    }
  };
  walk(base, "");
  return found.sort();
}

/** Canvas title for a file that has none of its own. */
export function defaultTitle(rel: string): string {
  const parts = rel.replace(/\.md$/, "").split("/");
  const name = parts[parts.length - 1] ?? rel;
  if (name === "index") return parts[parts.length - 2] ?? "Index";
  return name;
}

function readLocal(root: string, rel: string): { text: string; local: Normalized } {
  const file = absPath(root, rel);
  if (!existsSync(file)) throw new SyncError(`local file is missing: ${rel}`);
  const text = readFileSync(file, "utf8");
  if (!isSyncEnabled(parseFrontmatter(text))) {
    throw new SyncError(`${rel} has canvas_sync: false`);
  }
  return { text, local: normalizeLocal(text) };
}

// --- scan ---

export interface ScanFile {
  path: string;
  sync: boolean;
  title: string;
  state: "new" | "tracked";
  canvas_id: string | null;
  local_changed: boolean;
  /** The canvas's navigation block is out of date and needs a push. */
  nav_stale: boolean;
  validation_errors: number;
}

export interface ScanResult {
  files: ScanFile[];
  /** In the manifest but gone from disk. Never pushed; pull restores them. */
  missing: { path: string; canvas_id: string }[];
  pending_manual_deletion: Manifest["pending_manual_deletion"];
  /** Sync state or conflict copies that git tracks; they must not be. */
  tracked_in_git: string[];
}

/**
 * Files git tracks that hold canvas IDs or canvas content: anything under the
 * state directory, and conflict copies anywhere. Empty when the root is not in
 * a git repository or git is unavailable.
 */
export function trackedInGit(root: string): string[] {
  try {
    const out = execFileSync(
      "git",
      ["-C", realRoot(root), "ls-files", "-z", "--", STATE_DIR, "*.remote.md"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return out.split("\0").filter((path) => path !== "");
  } catch {
    return [];
  }
}

export function scan(root: string): ScanResult {
  const manifest = loadManifest(root);
  const paths = listMarkdown(root);
  const navBlocks = loadNav(root, manifest);
  const files = paths.map((path): ScanFile => {
    const text = readFileSync(absPath(root, path), "utf8");
    const sync = isSyncEnabled(parseFrontmatter(text));
    const local = normalizeLocal(text);
    const entry = manifest.files[path];
    const desired = navBlocks.blocks.get(path) ?? "";
    return {
      path,
      sync,
      title: local.title ?? defaultTitle(path),
      state: entry === undefined ? "new" : "tracked",
      canvas_id: entry?.canvas_id ?? null,
      local_changed:
        entry === undefined ||
        bodyHash(local.sections) !== entry.body_hash ||
        (local.title !== null && local.title !== entry.title),
      nav_stale:
        entry !== undefined &&
        sync &&
        (desired === "" ? undefined : hashText(desired)) !== entry.nav_hash,
      validation_errors: validate(text).filter((issue) => issue.severity === "error").length,
    };
  });
  const onDisk = new Set(paths);
  return {
    files,
    missing: Object.entries(manifest.files)
      .filter(([path]) => !onDisk.has(path))
      .map(([path, entry]) => ({ path, canvas_id: entry.canvas_id }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    pending_manual_deletion: manifest.pending_manual_deletion,
    tracked_in_git: trackedInGit(root),
  };
}

// --- pending manual deletion ---

export interface PendingList {
  pending: Manifest["pending_manual_deletion"];
  /** How to delete a canvas in Slack. */
  delete_steps: string;
  tracked_in_git: string[];
}

export function pendingList(root: string): PendingList {
  return {
    pending: loadManifest(root).pending_manual_deletion,
    delete_steps: DELETE_STEPS,
    tracked_in_git: trackedInGit(root),
  };
}

export function pendingAdd(
  root: string,
  item: Parameters<typeof addPending>[1],
  now: string,
): { added: boolean } {
  const manifest = loadManifest(root);
  const added = addPending(manifest, item, now);
  if (added) saveManifest(root, manifest);
  return { added };
}

export function pendingResolve(root: string, canvasId: string): { resolved: boolean } {
  const manifest = loadManifest(root);
  const resolved = resolvePending(manifest, canvasId);
  if (resolved) saveManifest(root, manifest);
  return { resolved };
}

/**
 * Stop tracking a file whose local copy is gone and flag its canvas for manual
 * deletion. Refuses while the file still exists so a live note is never
 * orphaned by mistake.
 */
export function retirePath(
  root: string,
  rel: string,
  reason: "local-file-removed" | "superseded",
  now: string,
): PendingDeletion {
  if (existsSync(absPath(root, rel))) {
    throw new SyncError(`${rel} still exists; remove or move it first`);
  }
  const manifest = loadManifest(root);
  const item = retireFile(manifest, rel, reason, now);
  saveManifest(root, manifest);
  return item;
}

// --- plan ---

export interface ChunkCounts {
  same: number;
  push: number;
  pull: number;
  converged: number;
  conflict: number;
}

function countChunks(plan: Plan): ChunkCounts {
  const counts: ChunkCounts = { same: 0, push: 0, pull: 0, converged: 0, conflict: 0 };
  for (const chunk of plan.chunks) counts[chunk.kind] += 1;
  return counts;
}

/** Identifies a canvas read, to detect a change between read and write. */
export function readFingerprint(input: unknown): string {
  const read = parseRemoteRead(input);
  return hashText(
    JSON.stringify([
      read.titleId,
      read.navId,
      read.content.title,
      read.sectionIds,
      read.content.sections,
    ]),
  );
}

export interface PlanResult {
  path: string;
  kind: "create" | "update";
  status: Plan["status"] | "new";
  /** Why nothing should be applied, or null when it is safe to proceed. */
  blocked: "validation" | "conflict" | null;
  validation: Issue[];
  chunks: ChunkCounts | null;
  /** For `create`: the arguments for `slack_create_canvas`. */
  create: { title: string; content: string } | null;
  /** For `update`: batches of `slack_update_canvas` section edits. */
  batches: UpdateSection[][];
  /** Identifies the read this plan was made from; compare before writing. */
  read_fingerprint: string | null;
  conflicts: { local: string[]; remote: string[] }[];
  title_conflict: { local: string | null; remote: string | null } | null;
  /** The canvas's navigation block, for an existing canvas. */
  nav: {
    action: NavAction;
    /** Changed in Slack since the last push; applying discards that edit. */
    edited_in_slack: boolean;
    /** Pass to `record --nav-hash` after applying this plan. */
    record_value: string;
    warnings: string[];
  } | null;
}

/** Navigation blocks for every synced file under the root. */
export function loadNav(root: string, manifest: Manifest): NavBlocks {
  const files: NavFile[] = [];
  for (const path of listMarkdown(root)) {
    const text = readFileSync(absPath(root, path), "utf8");
    const frontmatter = parseFrontmatter(text);
    if (!isSyncEnabled(frontmatter)) continue;
    const entry = manifest.files[path];
    files.push({
      path,
      title: normalizeLocal(text).title ?? defaultTitle(path),
      url: entry === undefined ? null : canvasUrl(manifest, entry),
      related: parseRelated(frontmatter.fields["related"]),
    });
  }
  return buildNavBlocks(files);
}

/**
 * Plan pushing one file. `read` is the `slack_read_canvas` result for the
 * file's canvas, or null for a file with no canvas yet.
 */
export function planPush(root: string, rel: string, read: unknown): PlanResult {
  const { text, local } = readLocal(root, rel);
  const validation = validate(text);
  const manifest = loadManifest(root);
  const base = manifest.files[rel] ?? null;
  const blockedByValidation = validation.some((issue) => issue.severity === "error");

  if (read === null) {
    if (base !== null) {
      throw new SyncError(`${rel} has a canvas; its current read is required`);
    }
    return {
      path: rel,
      kind: "create",
      status: "new",
      blocked: blockedByValidation ? "validation" : null,
      validation,
      chunks: null,
      create: blockedByValidation
        ? null
        : { title: local.title ?? defaultTitle(rel), content: local.body },
      batches: [],
      read_fingerprint: null,
      conflicts: [],
      title_conflict: null,
      nav: null,
    };
  }

  const remote = parseRemoteRead(read);
  if (base !== null && base.canvas_id !== remote.canvasId) {
    throw new SyncError(`${rel} is tracked as a different canvas than the one read`);
  }
  const plan = planFile(base, local, remote.content);
  const applied = applyPlan(plan, local, remote.content);
  const conflicted = applied.conflicts.length > 0 || applied.titleConflict !== null;
  const blocked = blockedByValidation ? "validation" : conflicted ? "conflict" : null;

  const navBlocks = loadNav(root, manifest);
  const nav = planNav({
    desired: navBlocks.blocks.get(rel) ?? "",
    base,
    navId: remote.navId,
    navText: remote.navText,
    titleId: remote.titleId,
  });
  return {
    path: rel,
    kind: "update",
    status: plan.status,
    blocked,
    validation,
    chunks: countChunks(plan),
    create: null,
    batches:
      blocked === null ? withNavEdit(toUpdateBatches(applied.ops, remote), nav.edit) : [],
    read_fingerprint: readFingerprint(read),
    conflicts: applied.conflicts.map((c) => ({ local: c.local, remote: c.remote })),
    title_conflict: applied.titleConflict,
    nav: {
      action: nav.action,
      edited_in_slack: nav.editedInSlack,
      record_value: nav.recordValue,
      warnings: navBlocks.warnings.get(rel) ?? [],
    },
  };
}

// --- record ---

export interface RecordResult {
  path: string;
  recorded: boolean;
  /** What is still pending after this step. */
  remaining: ChunkCounts;
  problem: string | null;
}

/**
 * Record a finished step in the manifest, from a fresh read of the canvas.
 * After a push nothing local may remain unsent; after a pull nothing remote
 * may remain untaken. Anything else is drift: the manifest is left alone and
 * the problem is reported rather than retried.
 */
export function recordStep(
  root: string,
  rel: string,
  read: unknown,
  after: "push" | "pull",
  now: string,
  canvasUrl?: string,
  navHash?: string,
): RecordResult {
  const { local } = readLocal(root, rel);
  const manifest = loadManifest(root);
  const base = manifest.files[rel] ?? null;
  const remote = parseRemoteRead(read);
  const plan = planFile(base, local, remote.content);
  const remaining = countChunks(plan);
  const leftover = after === "push" ? remaining.push : remaining.pull;
  const titleLeft = plan.title === (after === "push" ? "push" : "pull");
  let problem: string | null = null;
  if (remaining.conflict > 0 || plan.title === "conflict") {
    problem = "the file and the canvas still conflict";
  } else if (leftover > 0 || titleLeft) {
    problem =
      after === "push"
        ? "the canvas does not match the file after the push (drift); not recording"
        : "the file does not match the canvas after the pull; not recording";
  }
  if (problem !== null) return { path: rel, recorded: false, remaining, problem };

  const stepped = nextEntry({
    base,
    plan,
    local,
    remoteIds: remote.sectionIds,
    canvasId: remote.canvasId,
    now,
  });
  const withUrl = canvasUrl === undefined ? stepped : { ...stepped, canvas_url: canvasUrl };
  // After a push, remember what the canvas's navigation block looks like now
  // (so a later edit in Slack is noticed) and what we meant it to say. A pull
  // changes neither.
  const entry =
    after === "push"
      ? withNavFields(withUrl, {
          hash: navHash === undefined ? withUrl.nav_hash : navHash === "none" ? undefined : navHash,
          remote: remote.navText === null ? undefined : hashText(remote.navText),
        })
      : withUrl;
  manifest.files[rel] = entry;
  // A scratch canvas will need deleting by hand eventually; say so up front.
  if (base === null && isScratchTitle(remote.content.title)) {
    addPending(
      manifest,
      {
        canvasId: remote.canvasId,
        title: remote.content.title,
        reason: "test",
        canvasUrl: entry.canvas_url,
      },
      now,
    );
  }
  saveManifest(root, manifest);
  return { path: rel, recorded: true, remaining, problem: null };
}

// --- pull ---

export interface PullResult {
  path: string;
  status: Plan["status"] | "restore";
  applied: boolean;
  blocked: "conflict" | null;
  /** Where the canvas's version was saved for a human to compare. */
  conflict_file: string | null;
  chunks: ChunkCounts | null;
  conflicts: { local: string[]; remote: string[] }[];
  title_conflict: { local: string | null; remote: string | null } | null;
}

/**
 * Pull one file's canvas changes into the local file. Without `apply` this
 * only reports. Conflicts write nothing to the file; the canvas's version is
 * saved under the state directory instead.
 */
export function pullStep(
  root: string,
  rel: string,
  read: unknown,
  apply: boolean,
  now: string,
): PullResult {
  const remote = parseRemoteRead(read);
  const manifest = loadManifest(root);
  const base = manifest.files[rel] ?? null;
  if (base !== null && base.canvas_id !== remote.canvasId) {
    throw new SyncError(`${rel} is tracked as a different canvas than the one read`);
  }
  const file = absPath(root, rel);

  if (!existsSync(file)) {
    // Restore: the file is gone, so take the canvas wholesale.
    if (apply) {
      writeInside(root, file, renderLocalFile(null, remote.content.title, remote.content.body));
      const restored = normalizeLocal(readFileSync(file, "utf8"));
      manifest.files[rel] = {
        ...nextEntry({
          base: null,
          plan: planFile(null, restored, remote.content),
          local: restored,
          remoteIds: remote.sectionIds,
          canvasId: remote.canvasId,
          now,
        }),
        ...carriedFields(base),
      };
      saveManifest(root, manifest);
    }
    return {
      path: rel,
      status: "restore",
      applied: apply,
      blocked: null,
      conflict_file: null,
      chunks: null,
      conflicts: [],
      title_conflict: null,
    };
  }

  const { text, local } = readLocal(root, rel);
  const plan = planFile(base, local, remote.content);
  const result = applyPlan(plan, local, remote.content);
  const chunks = countChunks(plan);
  const conflicts = result.conflicts.map((c) => ({ local: c.local, remote: c.remote }));

  if (conflicts.length > 0 || result.titleConflict !== null) {
    let conflictFile: string | null = null;
    if (apply) {
      conflictFile = [STATE_DIR, CONFLICT_DIR, `${rel}.remote.md`].join("/");
      writeInside(
        root,
        join(root, ...conflictFile.split("/")),
        renderLocalFile(null, remote.content.title, remote.content.body),
      );
    }
    return {
      path: rel,
      status: "conflict",
      applied: false,
      blocked: "conflict",
      conflict_file: conflictFile,
      chunks,
      conflicts,
      title_conflict: result.titleConflict,
    };
  }

  const takesRemote = chunks.pull > 0 || plan.title === "pull";
  if (apply) {
    if (takesRemote) {
      writeInside(root, file, renderLocalFile(text, result.local.title, result.local.body));
    }
    manifest.files[rel] = nextEntry({
      base,
      plan: planFile(base, result.local, remote.content),
      local: result.local,
      remoteIds: remote.sectionIds,
      canvasId: remote.canvasId,
      now,
    });
    saveManifest(root, manifest);
  }
  return {
    path: rel,
    status: plan.status,
    applied: apply && takesRemote,
    blocked: null,
    conflict_file: null,
    chunks,
    conflicts: [],
    title_conflict: null,
  };
}
