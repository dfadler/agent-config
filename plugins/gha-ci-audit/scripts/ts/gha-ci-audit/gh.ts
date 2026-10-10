// `gh api` access, injected everywhere so tests never touch the network.
import { spawnSync } from "node:child_process";

/** Run `gh api <args>` and return raw stdout; throws on any failure. */
export type Gh = (args: readonly string[]) => string;

/** A run payload can be large (100 runs); don't let spawnSync's 1 MB default truncate it. */
const MAX_BUFFER = 256 * 1024 * 1024;

export const realGh: Gh = (args) => {
  const r = spawnSync("gh", ["api", ...args], { encoding: "utf8", maxBuffer: MAX_BUFFER });
  if (r.error !== undefined) throw r.error;
  if (r.status !== 0) throw new Error(`gh api ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
};
