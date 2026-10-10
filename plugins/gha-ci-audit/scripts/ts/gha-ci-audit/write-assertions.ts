// Populate assertions from evals.json into each eval's eval_metadata.json.
//
// Usage: node write-assertions.ts <iter_dir> <evals_json>
//
//   iter_dir    the iteration directory (e.g. .../iteration-5)
//   evals_json  path to evals/evals.json
//
// Reads each eval's assertions from evals_json and writes them into
// <iter_dir>/<dir_name>/with_skill/eval_metadata.json. Prints one line per
// eval: "Populated <name>: N assertions".
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultIo, isObject, str, type Io } from "./common.ts";

export const main = (argv: string[], io: Io = defaultIo): number => {
  const [iterDir, evalsJson, ...rest] = argv;
  if (iterDir === undefined || evalsJson === undefined || rest.length > 0) {
    io.err("Usage: write-assertions.ts <iter_dir> <evals_json>\n");
    return 1;
  }
  let evals: unknown[];
  try {
    const data: unknown = JSON.parse(readFileSync(evalsJson, "utf8"));
    const list = isObject(data) ? data["evals"] : undefined;
    if (!Array.isArray(list)) throw new Error("no \"evals\" array");
    evals = list;
  } catch (e) {
    io.err(`error: cannot read ${evalsJson}: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  for (const ev of evals.filter(isObject)) {
    const name = str(ev["dir_name"]);
    if (name === null || name === "") {
      io.err(`Missing dir_name for eval id ${String(ev["id"])}, skipping\n`);
      continue;
    }
    const metaPath = join(iterDir, name, "with_skill", "eval_metadata.json");
    if (!existsSync(metaPath)) {
      io.err(`Missing ${metaPath}, skipping\n`);
      continue;
    }
    const meta: unknown = JSON.parse(readFileSync(metaPath, "utf8"));
    if (!isObject(meta)) {
      io.err(`error: ${metaPath} is not a JSON object\n`);
      return 1;
    }
    const assertions: unknown[] = Array.isArray(ev["assertions"]) ? ev["assertions"] : [];
    writeFileSync(metaPath, JSON.stringify({ ...meta, assertions }, null, 2) + "\n");
    io.out(`Populated ${name}: ${String(assertions.length)} assertions\n`);
  }
  return 0;
};

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
