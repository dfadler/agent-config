import { createHash } from "node:crypto";

/** Hex SHA-256 of a string. Used for content hashing in sync manifests. */
export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
