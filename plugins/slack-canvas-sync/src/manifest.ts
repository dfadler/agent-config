/**
 * The sync manifest: what the last successful sync recorded for each file.
 *
 * It holds hashes, never content. Canvas IDs and the workspace host live only
 * here, in a gitignored local file, and must never reach tracked files,
 * issues, or PRs.
 */

import { hashText } from "../../../scripts/ts/hash.ts";

export const MANIFEST_VERSION = 1;

export type DeletionReason = "test" | "local-file-removed" | "superseded";

function isDeletionReason(value: string): value is DeletionReason {
  return (
    value === "test" || value === "local-file-removed" || value === "superseded"
  );
}

/** Hash of a whole body, derived from its per-section hashes. */
export function bodyHashOfHashes(hashes: string[]): string {
  return hashText(hashes.join("\n"));
}

/** Hash of a whole normalized body, given its sections. */
export function bodyHash(sections: string[]): string {
  return bodyHashOfHashes(sections.map(hashText));
}

export interface SectionSnapshot {
  hash: string;
  /**
   * Slack's section ID when last read. Informational only: IDs are
   * `temp:`-prefixed with unproven lifetime, so matching never relies on them.
   */
  section_id?: string;
}

export interface FileEntry {
  canvas_id: string;
  title: string | null;
  /** Hash of the whole normalized body, for a cheap "anything changed?". */
  body_hash: string;
  sections: SectionSnapshot[];
  last_synced_at: string;
}

/** A canvas the user has to delete by hand (the connector cannot). */
export interface PendingDeletion {
  canvas_id: string;
  title: string | null;
  reason: DeletionReason;
  added_at: string;
}

export interface Manifest {
  version: typeof MANIFEST_VERSION;
  /** Workspace host, e.g. for building canvas links. Local only. */
  workspace: string | null;
  /** Keyed by path relative to the sync root, using `/` separators. */
  files: Record<string, FileEntry>;
  pending_manual_deletion: PendingDeletion[];
}

export class ManifestError extends Error {
  constructor(message: string) {
    super(`invalid manifest: ${message}`);
    this.name = "ManifestError";
  }
}

export function emptyManifest(): Manifest {
  return {
    version: MANIFEST_VERSION,
    workspace: null,
    files: {},
    pending_manual_deletion: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, where: string): string {
  if (typeof value !== "string" || value === "") {
    throw new ManifestError(`${where} must be a non-empty string`);
  }
  return value;
}

function strOrNull(value: unknown, where: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new ManifestError(`${where} must be a string or null`);
  }
  return value;
}

function parseSection(value: unknown, where: string): SectionSnapshot {
  if (!isRecord(value)) throw new ManifestError(`${where} must be an object`);
  const hash = str(value["hash"], `${where}.hash`);
  const id = value["section_id"];
  if (id === undefined) return { hash };
  return { hash, section_id: str(id, `${where}.section_id`) };
}

export function parseEntry(value: unknown, where: string): FileEntry {
  if (!isRecord(value)) throw new ManifestError(`${where} must be an object`);
  const sections = value["sections"];
  if (!Array.isArray(sections)) {
    throw new ManifestError(`${where}.sections must be an array`);
  }
  return {
    canvas_id: str(value["canvas_id"], `${where}.canvas_id`),
    title: strOrNull(value["title"], `${where}.title`),
    body_hash: str(value["body_hash"], `${where}.body_hash`),
    sections: sections.map((section: unknown, i) =>
      parseSection(section, `${where}.sections[${String(i)}]`),
    ),
    last_synced_at: str(value["last_synced_at"], `${where}.last_synced_at`),
  };
}

function parsePending(value: unknown, where: string): PendingDeletion {
  if (!isRecord(value)) throw new ManifestError(`${where} must be an object`);
  const reason = str(value["reason"], `${where}.reason`);
  if (!isDeletionReason(reason)) {
    throw new ManifestError(`${where}.reason "${reason}" is not recognized`);
  }
  return {
    canvas_id: str(value["canvas_id"], `${where}.canvas_id`),
    title: strOrNull(value["title"], `${where}.title`),
    reason,
    added_at: str(value["added_at"], `${where}.added_at`),
  };
}

/** Validate untrusted JSON (from disk or stdin) into a Manifest. */
export function parseManifest(json: unknown): Manifest {
  if (!isRecord(json)) throw new ManifestError("must be an object");
  if (json["version"] !== MANIFEST_VERSION) {
    throw new ManifestError(
      `version must be ${String(MANIFEST_VERSION)}, got ${JSON.stringify(json["version"])}`,
    );
  }
  const files = json["files"];
  if (!isRecord(files)) throw new ManifestError("files must be an object");
  const pending = json["pending_manual_deletion"];
  if (!Array.isArray(pending)) {
    throw new ManifestError("pending_manual_deletion must be an array");
  }
  const parsedFiles: Record<string, FileEntry> = {};
  for (const [path, entry] of Object.entries(files)) {
    parsedFiles[path] = parseEntry(entry, `files["${path}"]`);
  }
  return {
    version: MANIFEST_VERSION,
    workspace: strOrNull(json["workspace"], "workspace"),
    files: parsedFiles,
    pending_manual_deletion: pending.map((item: unknown, i) =>
      parsePending(item, `pending_manual_deletion[${String(i)}]`),
    ),
  };
}

/** Parse manifest file text. Empty text is a fresh manifest. */
export function readManifest(text: string): Manifest {
  if (text.trim() === "") return emptyManifest();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new ManifestError(
      error instanceof Error ? error.message : "not valid JSON",
    );
  }
  return parseManifest(json);
}

/** Stable, diff-friendly serialization (sorted file keys, trailing newline). */
export function writeManifest(manifest: Manifest): string {
  const files: Record<string, FileEntry> = {};
  for (const path of Object.keys(manifest.files).sort()) {
    const entry = manifest.files[path];
    if (entry !== undefined) files[path] = entry;
  }
  return `${JSON.stringify({ ...manifest, files }, null, 2)}\n`;
}

/** Record the result of a successful sync of one file. */
export function snapshotFile(args: {
  canvasId: string;
  title: string | null;
  sections: string[];
  sectionIds?: (string | undefined)[];
  now: string;
}): FileEntry {
  return {
    canvas_id: args.canvasId,
    title: args.title,
    body_hash: bodyHash(args.sections),
    sections: args.sections.map((text, i) => {
      const hash = hashText(text);
      const id = args.sectionIds?.[i];
      return id === undefined ? { hash } : { hash, section_id: id };
    }),
    last_synced_at: args.now,
  };
}
