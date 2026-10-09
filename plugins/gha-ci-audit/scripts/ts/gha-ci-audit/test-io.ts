// Test helpers: an `Io` that records output and serves a fixed stdin, and a
// typed JSON-object reader (no `any`).
import { readFileSync } from "node:fs";
import { isObject, type Io } from "./common.ts";

export const fakeIo = (stdin = ""): { io: Io; out: () => string; err: () => string } => {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { out: (s) => out.push(s), err: (s) => err.push(s), stdin: () => stdin },
    out: () => out.join(""),
    err: () => err.join(""),
  };
};

export const readObj = (path: string): Record<string, unknown> => {
  const v: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isObject(v)) throw new Error(`${path}: not a JSON object`);
  return v;
};
