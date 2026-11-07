// PROTOTYPE, wipe me. Ticket #1041 of map #1034 (account switching in the Code tab).
//
// Question: can a tool start a session on a chosen Account after the user confirms,
// without signing the other Account out (rung 2)?
//
// Dry run by default: prints exactly what it would do and launches nothing.
//   node PROTOTYPE-launch.ts desktop work=~/.claude_work
//   node PROTOTYPE-launch.ts cli     personal=~/.claude_personal
// Add --go to be asked "y/N" and then launch. Add --new-instance (desktop) to try a second
// copy of the app next to a running one (live-test question 4; may misbehave).
//
// It never logs in, never reads a credential, and passes the child only the Config
// Directory (desktop, via `open --env`) or a credential-stripped environment (cli).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { probeEnv } from "./pick-account.ts";

const APP = "/Applications/Claude.app";
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [surface, spec] = args.filter((a) => !a.startsWith("--"));
const go = flags.has("--go");
const newInstance = flags.has("--new-instance");

const die = (m: string): never => {
  console.error(m);
  process.exit(2);
};

if ((surface !== "desktop" && surface !== "cli") || !spec || !/^[^=]+=.+$/.test(spec))
  die("usage: PROTOTYPE-launch.ts <desktop|cli> <label=dir | label=default> [--go] [--new-instance]");

const i = (spec ?? "").indexOf("=");
const label = (spec ?? "").slice(0, i);
const rawDir = (spec ?? "").slice(i + 1);
const dir = rawDir === "default" ? null : rawDir;
const env = probeEnv(process.env, dir);
const configDir = env["CLAUDE_CONFIG_DIR"] ?? null;

if (configDir !== null && !existsSync(configDir))
  die(`${configDir} does not exist. Refusing: claude would create it and it would look logged out.`);

// `pgrep` on the app path missed the main process; the app registry answers directly.
const appRunning = (
  spawnSync("lsappinfo", ["find", "bundleid=com.anthropic.claudefordesktop"], { encoding: "utf8" }).stdout ?? ""
).includes("ASN:");

const cmd =
  surface === "desktop"
    ? ["open", ...(newInstance ? ["-n"] : []), "-a", APP, ...(configDir ? ["--env", `CLAUDE_CONFIG_DIR=${configDir}`] : [])]
    : ["claude"];

console.log("--- state before ---");
console.log(`account:     ${label}`);
console.log(`surface:     ${surface}`);
console.log(`config dir:  ${configDir ?? "(default, CLAUDE_CONFIG_DIR unset)"}`);
console.log(`desktop app: ${surface === "desktop" ? (appRunning ? "RUNNING" : "not running") : "n/a"}`);
console.log(`command:     ${cmd.join(" ")}`);
console.log(
  surface === "cli"
    ? `env passed:  PATH-style vars kept, credential/provider vars removed (${Object.keys(env).length} names)`
    : "env passed:  only CLAUDE_CONFIG_DIR (open --env); nothing else from this shell",
);

if (surface === "desktop" && appRunning && !newInstance) {
  die(
    "\nThe app is running, so a launch would only focus it and the new CLAUDE_CONFIG_DIR would be ignored.\n" +
      "Quit the app yourself first (the docs say: set it, then quit and reopen), or pass --new-instance to test a second copy.",
  );
}

if (!go) {
  console.log("\nDry run. Nothing launched. Add --go to be asked to confirm.");
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(`\nStart ${surface} on "${label}"? [y/N] `);
rl.close();
if (answer.trim().toLowerCase() !== "y") die("Not confirmed. Nothing launched.");

const [bin = "", ...rest] = cmd;
const r = spawnSync(bin, rest, { stdio: "inherit", env });
console.log(`\n--- state after ---\nexit ${String(r.status)}. Now check which Account the session reports (/status), then use the run sheet.`);
