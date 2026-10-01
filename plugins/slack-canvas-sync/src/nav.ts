/**
 * Navigation blocks: the generated callout at the top of each canvas that makes
 * a flat set of canvases read as a hierarchy (breadcrumb to the parents, links
 * to child canvases and related ones).
 *
 * The block is derived entirely from the directory tree and frontmatter, so it
 * is regenerated on every push and stripped on every pull; it never lives in a
 * local file and never causes a diff. It is recognized by its first line
 * (`NAV_BLOCK_HEADER`), not by position alone.
 */

import { hashText } from "../../../scripts/ts/hash.ts";
import type { FileEntry, Manifest } from "./manifest.ts";
import { NAV_BLOCK_HEADER, normalizeSections } from "./normalize.ts";
import type { UpdateSection } from "./slack-read.ts";

export interface NavFile {
  /** Path relative to the sync root, `/`-separated. */
  path: string;
  title: string;
  /** Whole-canvas link, or null when the canvas does not exist yet. */
  url: string | null;
  /** `related:` frontmatter values, relative to this file's directory. */
  related: string[];
}

export interface NavBlocks {
  /** Normalized navigation callout per path; "" when there is nothing to show. */
  blocks: Map<string, string>;
  /** Problems worth telling the user about, per path. */
  warnings: Map<string, string[]>;
}

/** Parse a `related:` value: `[a.md, b.md]`, `a.md, b.md`, or one path. */
export function parseRelated(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((item) => item.trim().replace(/^(["'])(.*)\1$/, "$2"))
    .filter((item) => item !== "");
}

/** Resolve a related path against its file's directory; null if it escapes the root. */
export function resolveRelated(fromPath: string, related: string): string | null {
  const parts = fromPath.split("/").slice(0, -1);
  for (const segment of related.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  const resolved = parts.join("/");
  return resolved.endsWith(".md") ? resolved : null;
}

/**
 * The canvas that sits above `path`: the nearest `index.md` in its own folder
 * (for ordinary files) or in an enclosing folder. Null for the top of the tree.
 */
export function parentOf(path: string, known: ReadonlySet<string>): string | null {
  const segments = path.split("/");
  const name = segments.pop();
  let depth = name === "index.md" ? segments.length - 1 : segments.length;
  for (; depth >= 0; depth -= 1) {
    const candidate = [...segments.slice(0, depth), "index.md"].join("/");
    if (candidate !== path && known.has(candidate)) return candidate;
  }
  return null;
}

function link(file: NavFile): string {
  const text = file.title.replace(/[[\]]/g, "\\$&");
  return file.url === null ? text : `[${text}](${file.url})`;
}

/**
 * Build the navigation callout for every file. Files without a parent, children,
 * or related links get none, so a lone note stays clean.
 */
export function buildNavBlocks(files: NavFile[]): NavBlocks {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const known = new Set(byPath.keys());
  const children = new Map<string, NavFile[]>();
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const parent = parentOf(file.path, known);
    if (parent !== null) children.set(parent, [...(children.get(parent) ?? []), file]);
  }

  const blocks = new Map<string, string>();
  const warnings = new Map<string, string[]>();
  for (const file of files) {
    const ancestors: NavFile[] = [];
    for (
      let up = parentOf(file.path, known);
      up !== null && !ancestors.some((a) => a.path === up);
      up = parentOf(up, known)
    ) {
      const ancestor = byPath.get(up);
      if (ancestor === undefined) break;
      ancestors.unshift(ancestor);
    }

    const related: NavFile[] = [];
    const problems: string[] = [];
    for (const raw of file.related) {
      const target = resolveRelated(file.path, raw);
      const found = target === null ? undefined : byPath.get(target);
      if (found === undefined) {
        problems.push(`related "${raw}" is not a synced file under the root`);
      } else if (found.path !== file.path && !related.includes(found)) {
        related.push(found);
      }
    }
    if (problems.length > 0) warnings.set(file.path, problems);

    const kids = children.get(file.path) ?? [];
    if (ancestors.length === 0 && kids.length === 0 && related.length === 0) {
      blocks.set(file.path, "");
      continue;
    }

    const lines = ["::: {.callout}", NAV_BLOCK_HEADER];
    if (ancestors.length > 0) {
      lines.push(
        [...ancestors.map(link), file.title.replace(/[[\]]/g, "\\$&")].join(" > "),
      );
    }
    if (kids.length > 0) {
      lines.push("", "**Children**", ...kids.map((kid) => `* ${link(kid)}`));
    }
    if (related.length > 0) {
      lines.push("", "**Related**", ...related.map((item) => `* ${link(item)}`));
    }
    lines.push(":::");
    blocks.set(file.path, normalizeSections(lines.join("\n"))[0] ?? "");
  }
  return { blocks, warnings };
}

/**
 * The link for an entry's canvas. Uses the recorded URL; for an entry without
 * one, borrows the workspace prefix from any other recorded URL (every canvas
 * link in a workspace is that prefix plus the canvas ID).
 */
export function canvasUrl(manifest: Manifest, entry: FileEntry): string | null {
  if (entry.canvas_url !== undefined) return entry.canvas_url;
  for (const other of Object.values(manifest.files)) {
    const url = other.canvas_url;
    if (url !== undefined && url.endsWith(other.canvas_id)) {
      return url.slice(0, url.length - other.canvas_id.length) + entry.canvas_id;
    }
  }
  return null;
}

export type NavAction = "none" | "insert" | "replace" | "delete";

export interface NavPlan {
  action: NavAction;
  /** The edit to make, or null when the block is already right. */
  edit: UpdateSection | null;
  /** The block was changed in Slack since the last push; rewriting discards that. */
  editedInSlack: boolean;
  /** Pass to `record --nav-hash` after applying: a hash, or "none". */
  recordValue: string;
}

/**
 * Decide what the canvas's navigation block needs. The block is compared by
 * hash against what was last written and last read back, not by text, so a
 * formatting difference in how Slack stores it can never cause endless rewrites.
 */
export function planNav(args: {
  desired: string;
  base: Pick<FileEntry, "nav_hash" | "nav_remote_hash"> | null;
  navId: string | null;
  navText: string | null;
  titleId: string;
}): NavPlan {
  const { desired, base, navId, navText } = args;
  const desiredHash = desired === "" ? undefined : hashText(desired);
  const remoteHash = navText === null ? undefined : hashText(navText);
  const editedInSlack =
    navId !== null &&
    base?.nav_remote_hash !== undefined &&
    remoteHash !== base.nav_remote_hash;
  const recordValue = desiredHash ?? "none";

  if (desired === "") {
    return navId === null
      ? { action: "none", edit: null, editedInSlack, recordValue }
      : {
          action: "delete",
          edit: { edit_type: "delete", section_id: navId },
          editedInSlack,
          recordValue,
        };
  }
  if (navId === null) {
    return {
      action: "insert",
      edit: { edit_type: "append", section_id: args.titleId, content: desired },
      editedInSlack: false,
      recordValue,
    };
  }
  const stale = base?.nav_hash !== desiredHash || editedInSlack || base?.nav_remote_hash === undefined;
  return stale
    ? {
        action: "replace",
        edit: { edit_type: "replace", section_id: navId, content: desired },
        editedInSlack,
        recordValue,
      }
    : { action: "none", edit: null, editedInSlack, recordValue };
}
