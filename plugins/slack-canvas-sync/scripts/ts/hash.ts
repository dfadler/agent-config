import { createHash } from "node:crypto";

/**
 * Hex SHA-256 of a string, used for content hashing in the sync manifest.
 *
 * Deliberately local to the plugin: a plugin is installed on its own, so its
 * scripts must not import from the repository's top-level scripts/ts/.
 */
export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
