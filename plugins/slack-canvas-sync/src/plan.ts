/**
 * Turn a three-way diff into concrete work: edits to send to the canvas,
 * the new local content, and any conflicts left for a human.
 */

import { hashText } from "../../../scripts/ts/hash.ts";
import { diff3, diff3Scalar, type Chunk, type ChunkKind } from "./diff3.ts";
import type { FileEntry } from "./manifest.ts";
import { renderSections, type Normalized } from "./normalize.ts";

export type PlanStatus = "in-sync" | "push" | "pull" | "mixed" | "conflict";

export interface Plan {
  status: PlanStatus;
  /** Three-way result for the canvas title. */
  title: ChunkKind;
  /** Covers every section of base, local and remote exactly once. */
  chunks: Chunk[];
}

/**
 * Edits for `slack_update_canvas`. Indexes refer to the sections of the
 * canvas as read for this plan, so all ops apply against one snapshot;
 * the caller maps an index to Slack's section ID from that same read.
 */
export type RemoteOp =
  | { type: "rename"; title: string }
  | { type: "replace"; remoteIndex: number; text: string }
  | { type: "delete"; remoteIndex: number }
  /** `afterIndex` of -1 inserts at the start of the body. */
  | { type: "insert_after"; afterIndex: number; text: string };

export interface Conflict {
  chunk: Chunk;
  local: string[];
  remote: string[];
}

export interface Applied {
  /** Edits to make to the canvas. */
  ops: RemoteOp[];
  /** The local file after pulling remote-only changes. */
  local: Normalized;
  conflicts: Conflict[];
  titleConflict: { local: string | null; remote: string | null } | null;
}

function hashes(sections: string[]): string[] {
  return sections.map(hashText);
}

/**
 * Compare local and remote content against what the last sync recorded.
 * `base` is null for a file that has never been synced, which makes every
 * section new on whichever side has it.
 */
export function planFile(
  base: FileEntry | null,
  local: Normalized,
  remote: Normalized,
): Plan {
  const chunks = diff3(
    base === null ? [] : base.sections.map((section) => section.hash),
    hashes(local.sections),
    hashes(remote.sections),
  );
  const title = diff3Scalar(base?.title ?? null, local.title, remote.title);

  const kinds = new Set<ChunkKind>([title, ...chunks.map((c) => c.kind)]);
  const push = kinds.has("push");
  const pull = kinds.has("pull");
  let status: PlanStatus = "in-sync";
  if (kinds.has("conflict")) status = "conflict";
  else if (push && pull) status = "mixed";
  else if (push) status = "push";
  else if (pull) status = "pull";
  return { status, title, chunks };
}

function opsForPush(
  chunk: Chunk,
  localSections: string[],
  ops: RemoteOp[],
): void {
  const incoming = localSections.slice(chunk.local.start, chunk.local.end);
  const existing = chunk.remote.end - chunk.remote.start;
  const paired = Math.min(incoming.length, existing);
  for (let k = 0; k < paired; k += 1) {
    ops.push({
      type: "replace",
      remoteIndex: chunk.remote.start + k,
      text: incoming[k] ?? "",
    });
  }
  for (let k = paired; k < existing; k += 1) {
    ops.push({ type: "delete", remoteIndex: chunk.remote.start + k });
  }
  if (incoming.length > paired) {
    // One op for the whole run: inserting several sections after the same
    // anchor one by one could land them in reverse order.
    ops.push({
      type: "insert_after",
      afterIndex: chunk.remote.start + paired - 1,
      text: incoming.slice(paired).join("\n\n"),
    });
  }
}

/** Resolve a plan into canvas edits, new local content and conflicts. */
export function applyPlan(
  plan: Plan,
  local: Normalized,
  remote: Normalized,
): Applied {
  const ops: RemoteOp[] = [];
  const sections: string[] = [];
  const conflicts: Conflict[] = [];

  if (plan.title === "push" && local.title !== null) {
    ops.push({ type: "rename", title: local.title });
  }

  for (const chunk of plan.chunks) {
    const localSlice = local.sections.slice(chunk.local.start, chunk.local.end);
    const remoteSlice = remote.sections.slice(
      chunk.remote.start,
      chunk.remote.end,
    );
    if (chunk.kind === "pull") {
      sections.push(...remoteSlice);
      continue;
    }
    sections.push(...localSlice);
    if (chunk.kind === "push") {
      opsForPush(chunk, local.sections, ops);
    } else if (chunk.kind === "conflict") {
      conflicts.push({ chunk, local: localSlice, remote: remoteSlice });
    }
  }

  const title = plan.title === "pull" ? remote.title : local.title;
  return {
    ops,
    local: { title, sections, body: renderSections(sections) },
    conflicts,
    titleConflict:
      plan.title === "conflict"
        ? { local: local.title, remote: remote.title }
        : null,
  };
}
