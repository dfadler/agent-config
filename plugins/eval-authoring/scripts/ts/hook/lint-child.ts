/** Child-process body for the lint hook: runs the (synchronous) lint off the parent's event loop and prints the outcome as JSON on stdout. */
import { discoverRules } from "../lint/discover.ts";
import { lintPlugin } from "../lint/runner.ts";

const found = await discoverRules();
if (!found.ok) throw new Error(found.message);
process.stdout.write(JSON.stringify(lintPlugin(String(process.argv[2]), found.rules)));
