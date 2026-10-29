/** Worker body for the lint hook: runs the (synchronous) lint off the parent's event loop. */
import { parentPort, workerData } from "node:worker_threads";
import { discoverRules } from "../lint/discover.ts";
import { lintPlugin } from "../lint/runner.ts";

const found = await discoverRules();
if (!found.ok) throw new Error(found.message);
parentPort?.postMessage(lintPlugin(String(workerData), found.rules));
