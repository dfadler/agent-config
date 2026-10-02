/**
 * Just enough frontmatter handling for sync: flat `key: value` lines.
 * Anything structured (lists, nesting) is carried through untouched.
 */

export interface Frontmatter {
  /** The block between the `---` fences, or null when there is none. */
  raw: string | null;
  /** Flat `key: value` fields, quotes stripped. */
  fields: Record<string, string>;
  /** Everything after the frontmatter. */
  body: string;
}

export function parseFrontmatter(text: string): Frontmatter {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { raw: null, fields: {}, body: normalized };
  }
  const end = normalized.indexOf("\n---\n", 3);
  if (end === -1) return { raw: null, fields: {}, body: normalized };
  const raw = normalized.slice(4, end);
  const fields: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const match = /^([A-Za-z_][\w-]*):[ \t]*(.*?)[ \t]*$/.exec(line);
    if (match === null) continue;
    const value = (match[2] ?? "").replace(/^(["'])(.*)\1$/, "$2");
    fields[match[1] ?? ""] = value;
  }
  return { raw, fields, body: normalized.slice(end + "\n---\n".length) };
}

/** True unless the file opts out with `canvas_sync: false`. */
export function isSyncEnabled(frontmatter: Frontmatter): boolean {
  const value = frontmatter.fields["canvas_sync"];
  return value === undefined || !/^(false|no|off|0)$/i.test(value);
}

function quoteYaml(value: string): string {
  return /^[\w][\w .,/()-]*$/.test(value) ? value : JSON.stringify(value);
}

/**
 * Rebuild a local file around new content, keeping its frontmatter. The title
 * goes back where it came from: the frontmatter `title:` when the file has
 * one, otherwise a leading `# Heading`.
 */
export function renderLocalFile(
  original: string | null,
  title: string | null,
  body: string,
): string {
  const parsed = parseFrontmatter(original ?? "");
  let head = "";
  let titleInHeading = title !== null;

  if (parsed.raw !== null) {
    let lines = parsed.raw.split("\n");
    if (title !== null && lines.some((line) => /^title:/.test(line))) {
      lines = lines.map((line) =>
        /^title:/.test(line) ? `title: ${quoteYaml(title)}` : line,
      );
      titleInHeading = false;
    }
    head = `---\n${lines.join("\n")}\n---\n\n`;
  }
  if (titleInHeading && title !== null) head += `# ${title}\n\n`;
  return `${head}${body}`.replace(/\n*$/, "\n");
}
