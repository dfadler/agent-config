/**
 * An in-memory stand-in for one Slack canvas, for hermetic tests.
 *
 * It models only what the connector exposes: read the canvas as markdown with
 * its section IDs, apply edits against that read, and (separately) edits made
 * in the Slack UI. No network, no workspace.
 */

import {
  normalizeLocal,
  normalizeRemote,
  normalizeSections,
  renderSections,
  type Normalized,
} from "../src/normalize.ts";
import { applyPlan, planFile, type Applied, type Plan, type RemoteOp } from "../src/plan.ts";
import { snapshotFile, type FileEntry } from "../src/manifest.ts";

interface Section {
  id: string;
  text: string;
}

export class FakeCanvas {
  title: string;
  private sections: Section[];
  private nextId = 1;

  constructor(title: string, sections: string[] = []) {
    this.title = title;
    this.sections = sections.map((text) => this.make(text));
  }

  private make(text: string): Section {
    const id = `temp:C:VLO${String(this.nextId).padStart(6, "0")}`;
    this.nextId += 1;
    return { id, text };
  }

  /** What `slack_read_canvas` would return. */
  read(): { markdown: string; sectionIds: string[] } {
    return {
      markdown: `# ${this.title}\n\n${renderSections(this.texts())}`,
      sectionIds: this.sections.map((section) => section.id),
    };
  }

  texts(): string[] {
    return this.sections.map((section) => section.text);
  }

  /**
   * What `slack_update_canvas` would do: every op targets a section by the
   * index from `read()`, applied atomically against that snapshot. A replace
   * keeps the first resulting section's ID; anything else gets a new one.
   */
  apply(ops: RemoteOp[], readIds: string[]): void {
    const current = this.sections.map((section) => section.id);
    if (readIds.length !== current.length || readIds.some((id, i) => id !== current[i])) {
      throw new Error("canvas changed since it was read");
    }
    const replaced = new Map<number, string>();
    const deleted = new Set<number>();
    const inserted = new Map<number, string>();
    for (const op of ops) {
      if (op.type === "rename") this.title = op.title;
      else if (op.type === "replace") replaced.set(op.remoteIndex, op.text);
      else if (op.type === "delete") deleted.add(op.remoteIndex);
      else inserted.set(op.afterIndex, op.text);
    }

    const next: Section[] = [];
    const insertAfter = (index: number): void => {
      const text = inserted.get(index);
      if (text === undefined) return;
      for (const piece of normalizeSections(text)) next.push(this.make(piece));
    };
    insertAfter(-1);
    this.sections.forEach((section, i) => {
      if (!deleted.has(i)) {
        const text = replaced.get(i);
        if (text === undefined) {
          next.push(section);
        } else {
          const [first, ...rest] = normalizeSections(text);
          next.push({ id: section.id, text: first ?? "" });
          for (const piece of rest) next.push(this.make(piece));
        }
      }
      insertAfter(i);
    });
    this.sections = next;
  }

  /** An edit made by a person in the Slack UI. */
  uiEdit(index: number, text: string): void {
    const section = this.sections[index];
    if (section === undefined) throw new RangeError(`no section ${String(index)}`);
    section.text = text;
  }

  uiInsert(index: number, text: string): void {
    this.sections.splice(index, 0, this.make(text));
  }

  uiDelete(index: number): void {
    this.sections.splice(index, 1);
  }
}

export interface SyncResult {
  plan: Plan;
  applied: Applied;
  /** Local markdown after the run (title + normalized body). */
  localMarkdown: string;
  /** Manifest entry for the new state; null when conflicts blocked the run. */
  entry: FileEntry | null;
}

/**
 * One sync of one file, the way the push/pull skills will drive it: read
 * fresh, plan, apply canvas edits, rewrite local, snapshot. Conflicts stop
 * the run before anything is written.
 */
export function syncOnce(
  canvas: FakeCanvas,
  localMarkdown: string,
  base: FileEntry | null,
  canvasId = "FTEST000001",
  now = "2026-01-01T00:00:00.000Z",
): SyncResult {
  const read = canvas.read();
  const local: Normalized = normalizeLocal(localMarkdown);
  const remote: Normalized = normalizeRemote(read.markdown);
  const plan = planFile(base, local, remote);
  const applied = applyPlan(plan, local, remote);
  if (applied.conflicts.length > 0 || applied.titleConflict !== null) {
    return { plan, applied, localMarkdown, entry: null };
  }
  canvas.apply(applied.ops, read.sectionIds);
  const after = canvas.read();
  const title = applied.local.title;
  return {
    plan,
    applied,
    localMarkdown:
      (title === null ? "" : `# ${title}\n\n`) + applied.local.body,
    entry: snapshotFile({
      canvasId,
      title,
      sections: applied.local.sections,
      sectionIds: after.sectionIds,
      now,
    }),
  };
}
