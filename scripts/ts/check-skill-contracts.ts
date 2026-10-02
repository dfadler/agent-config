// Fail when a skill that another skill references has no documented
// input/output contract, or when a reference points at a skill that doesn't
// exist. See docs/skill-composition.md.
import { existsSync } from "node:fs";
import { findViolations, loadSkills } from "./skill-contracts.ts";

const USAGE = `Usage: check-skill-contracts.ts [-h|--help] [ROOT]

Check skill composition contracts under ROOT/plugins (default: .).

  -h, --help   Show this message and exit.
`;

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

/** Returns the process exit code; writes findings to `err`. */
export function main(
  argv: readonly string[],
  out: (s: string) => void,
  err: (s: string) => void,
): number {
  const [first] = argv;
  if (first === "-h" || first === "--help") {
    out(USAGE);
    return EXIT_OK;
  }
  const root = first ?? ".";
  if (!existsSync(`${root}/plugins`)) {
    err(`::error::no plugins/ directory under ROOT: ${root}`);
    return EXIT_USAGE;
  }
  const errors = findViolations(loadSkills(root));
  for (const e of errors) err(`::error::${e}`);
  return errors.length > 0 ? EXIT_FAILURE : EXIT_OK;
}

if (import.meta.main) {
  process.exitCode = main(
    process.argv.slice(2),
    (s) => process.stdout.write(s),
    (s) => process.stderr.write(`${s}\n`),
  );
}
