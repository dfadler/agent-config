/**
 * Turns a `slack_read_canvas` result into what the sync needs, and turns plan
 * operations back into `slack_update_canvas` section edits.
 *
 * The read result carries `section_id_mapping`: an ordered map of Slack
 * section ID to that section's markdown. The first entry is the title; the
 * rest are the body, one entry per block.
 */

import { NAV_BLOCK_HEADER, normalizeSections, type Normalized, renderSections } from "./normalize.ts";
import type { RemoteOp } from "./plan.ts";

export class ReadError extends Error {
  constructor(message: string) {
    super(`unusable canvas read: ${message}`);
    this.name = "ReadError";
  }
}

export interface RemoteRead {
  canvasId: string;
  /** Title and body sections, nav block removed. */
  content: Normalized;
  /** Slack section ID of each entry in `content.sections`. */
  sectionIds: string[];
  titleId: string;
  /** Section ID of the generated navigation callout, when present. */
  navId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseRemoteRead(input: unknown): RemoteRead {
  if (!isRecord(input)) throw new ReadError("expected a JSON object");
  const canvasId = input["canvas_id"];
  if (typeof canvasId !== "string" || canvasId === "") {
    throw new ReadError("canvas_id is missing");
  }
  const mapping = input["section_id_mapping"];
  if (!isRecord(mapping)) throw new ReadError("section_id_mapping is missing");

  const entries = Object.entries(mapping);
  const [first, ...rest] = entries;
  if (first === undefined) throw new ReadError("section_id_mapping is empty");
  const [titleId, titleText] = first;
  const titleMatch = /^#[ \t]+(.+?)[ \t]*$/.exec(
    typeof titleText === "string" ? titleText : "",
  );
  if (titleMatch === null) {
    throw new ReadError("the first section is not a title line");
  }

  const sections: string[] = [];
  const ids: string[] = [];
  for (const [id, text] of rest) {
    if (typeof text !== "string") {
      throw new ReadError(`section ${id} has no markdown text`);
    }
    const blocks = normalizeSections(text);
    if (blocks.length > 1) {
      throw new ReadError(
        `section ${id} holds ${String(blocks.length)} blocks, so edits cannot be mapped to sections safely`,
      );
    }
    // An empty paragraph normalizes to nothing and is simply not tracked.
    const [block] = blocks;
    if (block === undefined) continue;
    sections.push(block);
    ids.push(id);
  }

  let navId: string | null = null;
  if (sections[0]?.startsWith(`::: {.callout}\n${NAV_BLOCK_HEADER}`) === true) {
    sections.shift();
    navId = ids.shift() ?? null;
  }

  return {
    canvasId,
    content: {
      title: titleMatch[1] ?? null,
      sections,
      body: renderSections(sections),
    },
    sectionIds: ids,
    titleId,
    navId,
  };
}

/** One entry of `slack_update_canvas`'s `sections` argument. */
export interface UpdateSection {
  edit_type: "replace" | "append" | "delete";
  section_id: string;
  content?: string;
}

/** Slack accepts at most this many operations per update call. */
export const MAX_OPS_PER_CALL = 100;

function idAt(read: RemoteRead, index: number): string {
  const id = read.sectionIds[index];
  if (id === undefined) {
    throw new ReadError(`no section at index ${String(index)}`);
  }
  return id;
}

/**
 * Map plan operations onto the section IDs of the read they were planned
 * against. Inserting at the very start appends after the navigation block, or
 * after the title when there is none. Returned in batches the connector will
 * accept; each batch is atomic, and a plan only spans several batches when it
 * is very large.
 */
export function toUpdateBatches(ops: RemoteOp[], read: RemoteRead): UpdateSection[][] {
  const edits: UpdateSection[] = ops.map((op): UpdateSection => {
    switch (op.type) {
      case "rename":
        return {
          edit_type: "replace",
          section_id: read.titleId,
          content: `# ${op.title}`,
        };
      case "replace":
        return {
          edit_type: "replace",
          section_id: idAt(read, op.remoteIndex),
          content: op.text,
        };
      case "delete":
        return { edit_type: "delete", section_id: idAt(read, op.remoteIndex) };
      case "insert_after":
        return {
          edit_type: "append",
          section_id:
            op.afterIndex < 0
              ? (read.navId ?? read.titleId)
              : idAt(read, op.afterIndex),
          content: op.text,
        };
    }
  });
  const batches: UpdateSection[][] = [];
  for (let i = 0; i < edits.length; i += MAX_OPS_PER_CALL) {
    batches.push(edits.slice(i, i + MAX_OPS_PER_CALL));
  }
  return batches;
}
