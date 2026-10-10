// Set up the directory structure for one eval run (with_skill only).
//
// Usage: node setup-eval.ts <iteration_dir> <eval_name> <eval_id> <prompt>
// Example: node setup-eval.ts iteration-3 vite-audit 1 "Audit GitHub Actions for vitejs/vite..."
//
// Creates:
//   <iteration_dir>/<eval_name>/with_skill/outputs/
//   <iteration_dir>/<eval_name>/with_skill/eval_metadata.json
// Re-running into the same directory overwrites the metadata.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultIo, type Io } from "./common.ts";

export const main = (argv: string[], io: Io = defaultIo): number => {
  const [iterationDir, evalName, evalId, prompt, ...rest] = argv;
  if (iterationDir === undefined || evalName === undefined || evalId === undefined || prompt === undefined || rest.length > 0) {
    io.err("Usage: setup-eval.ts <iteration_dir> <eval_name> <eval_id> <prompt>\n");
    return 1;
  }
  const id = Number(evalId);
  if (!Number.isInteger(id)) {
    io.err(`eval_id must be an integer, got: ${evalId}\n`);
    return 1;
  }
  const dir = join(iterationDir, evalName, "with_skill");
  mkdirSync(join(dir, "outputs"), { recursive: true });
  const meta = { eval_id: id, eval_name: evalName, prompt, assertions: [] };
  writeFileSync(join(dir, "eval_metadata.json"), JSON.stringify(meta, null, 2) + "\n");
  io.out(`Created: ${join(dir, "eval_metadata.json")}\n`);
  return 0;
};

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
