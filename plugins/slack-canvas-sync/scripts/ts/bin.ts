#!/usr/bin/env node
// Process wrapper for cli.ts: stdin in, stdout/stderr out, exit code set.
// Kept trivial; everything testable lives in cli.ts.
import { readFileSync } from "node:fs";
import { run } from "./cli.ts";

const stdin = process.stdin.isTTY ? "" : readFileSync(0, "utf8");
const result = run(process.argv.slice(2), stdin, new Date().toISOString());
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.code;
