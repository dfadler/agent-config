/**
 * The list of canvases the user has to delete by hand.
 *
 * The Slack connector has no delete tool, so anything the sync leaves behind
 * (a removed file's canvas, a replaced canvas, a test canvas) is recorded here
 * and reported until the user clears it. The sync never deletes anything.
 */

import {
  SCRATCH_TITLE_PREFIX,
  type DeletionReason,
  type Manifest,
  type PendingDeletion,
} from "./manifest.ts";

/**
 * Steps for deleting a canvas, from Slack's help page
 * https://slack.com/help/articles/203950418-Use-a-canvas-in-Slack
 */
export const DELETE_STEPS =
  "In Slack, open the canvas, click the three dots icon, choose Delete canvas, then confirm. " +
  "Canvases you own can be restored for 24 hours after deletion.";

export class PendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PendingError";
  }
}

export function isScratchTitle(title: string | null): boolean {
  return title?.startsWith(SCRATCH_TITLE_PREFIX) === true;
}

/** Add a canvas to the list. Returns false when it was already listed. */
export function addPending(
  manifest: Manifest,
  item: {
    canvasId: string;
    title: string | null;
    reason: DeletionReason;
    canvasUrl?: string | undefined;
  },
  now: string,
): boolean {
  if (manifest.pending_manual_deletion.some((p) => p.canvas_id === item.canvasId)) {
    return false;
  }
  const entry: PendingDeletion = {
    canvas_id: item.canvasId,
    title: item.title,
    reason: item.reason,
    added_at: now,
    ...(item.canvasUrl === undefined ? {} : { canvas_url: item.canvasUrl }),
  };
  manifest.pending_manual_deletion.push(entry);
  return true;
}

/** Clear a canvas from the list. Returns false when it was not listed. */
export function resolvePending(manifest: Manifest, canvasId: string): boolean {
  const before = manifest.pending_manual_deletion.length;
  manifest.pending_manual_deletion = manifest.pending_manual_deletion.filter(
    (p) => p.canvas_id !== canvasId,
  );
  return manifest.pending_manual_deletion.length < before;
}

/**
 * Stop tracking a file whose local copy is gone and flag its canvas for manual
 * deletion. Callers check the file is really gone first.
 */
export function retireFile(
  manifest: Manifest,
  path: string,
  reason: "local-file-removed" | "superseded",
  now: string,
): PendingDeletion {
  const entry = manifest.files[path];
  if (entry === undefined) throw new PendingError(`${path} is not tracked`);
  manifest.files = Object.fromEntries(
    Object.entries(manifest.files).filter(([key]) => key !== path),
  );
  addPending(
    manifest,
    {
      canvasId: entry.canvas_id,
      title: entry.title,
      reason,
      canvasUrl: entry.canvas_url,
    },
    now,
  );
  const listed = manifest.pending_manual_deletion.find((p) => p.canvas_id === entry.canvas_id);
  if (listed === undefined) throw new PendingError("could not record the pending deletion");
  return listed;
}
