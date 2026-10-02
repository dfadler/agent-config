#!/usr/bin/env node
// Process wrapper for cli.ts: stdin in, stdout/stderr out, exit code set.
// Kept trivial; everything testable lives in cli.ts.
import { readFileSync } from "node:fs";
import { readsStdin, run } from "./cli.ts";

const argv = process.argv.slice(2);
const stdin = readsStdin(argv) && !process.stdin.isTTY ? readFileSync(0, "utf8") : "";
const result = run(argv, stdin, new Date().toISOString());
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.code;
