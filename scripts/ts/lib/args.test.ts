import { describe, expect, it } from "vitest";
import { parseArgs, type ArgSpec, type Flags } from "./args.ts";
import { EXIT_USAGE } from "./exit-codes.ts";
import { err, ok } from "./result.ts";

const spec: ArgSpec = {
  usage: "Usage: tool [-h] [-q] [-o FILE] FILES...",
  flags: [
    { name: "quiet", short: "q" },
    { name: "out", short: "o", valued: true },
    { name: "long-only" },
  ],
  minPositionals: 1,
  maxPositionals: 3,
};

const usageErr = (problem: string) =>
  err({ code: EXIT_USAGE, message: `${problem}\n\n${spec.usage}` });

const args = (flags: Flags, positionals: readonly string[]) =>
  ok({ kind: "args", flags, positionals });

describe("parseArgs", () => {
  it("returns help for -h and --help, with the usage text", () => {
    const help = ok({ kind: "help", usage: spec.usage });
    expect(parseArgs(spec, ["-h"])).toEqual(help);
    expect(parseArgs(spec, ["--help"])).toEqual(help);
  });

  it("checks help before validating anything else", () => {
    const help = ok({ kind: "help", usage: spec.usage });
    expect(parseArgs(spec, ["--bogus", "--help"])).toEqual(help);
    expect(parseArgs(spec, ["-h"])).toEqual(help); // zero positionals
  });

  it("does not treat -h after -- as help", () => {
    expect(parseArgs(spec, ["--", "-h"])).toEqual(args({}, ["-h"]));
  });

  it("collects positionals and treats a lone - as positional", () => {
    expect(parseArgs(spec, ["a", "-", "b"])).toEqual(args({}, ["a", "-", "b"]));
  });

  it("parses boolean flags by long and short name", () => {
    expect(parseArgs(spec, ["-q", "--long-only", "a"])).toEqual(
      args({ quiet: true, "long-only": true }, ["a"]),
    );
  });

  it("parses valued flags as separate, =, and short forms; last wins", () => {
    expect(parseArgs(spec, ["--out", "x", "a"])).toEqual(
      args({ out: "x" }, ["a"]),
    );
    expect(parseArgs(spec, ["--out=y=z", "a"])).toEqual(
      args({ out: "y=z" }, ["a"]),
    );
    expect(parseArgs(spec, ["-o", "p", "-o", "q", "a"])).toEqual(
      args({ out: "q" }, ["a"]),
    );
  });

  it("treats everything after -- as positional", () => {
    expect(parseArgs(spec, ["a", "--", "-q", "--out"])).toEqual(
      args({}, ["a", "-q", "--out"]),
    );
  });

  it("rejects an unknown option", () => {
    expect(parseArgs(spec, ["--nope", "a"])).toEqual(
      usageErr("unknown option: --nope"),
    );
    expect(parseArgs(spec, ["-x=1", "a"])).toEqual(
      usageErr("unknown option: -x=1"),
    );
  });

  it("rejects a valued flag with no value", () => {
    expect(parseArgs(spec, ["a", "--out"])).toEqual(
      usageErr("option --out requires a value"),
    );
  });

  it("rejects a value on a boolean flag", () => {
    expect(parseArgs(spec, ["--quiet=1", "a"])).toEqual(
      usageErr("option --quiet does not take a value"),
    );
  });

  it("enforces positional bounds", () => {
    expect(parseArgs(spec, [])).toEqual(
      usageErr("expected at least 1 argument(s), got 0"),
    );
    expect(parseArgs(spec, ["a", "b", "c", "d"])).toEqual(
      usageErr("expected at most 3 argument(s), got 4"),
    );
  });

  it("accepts anything when the spec declares no flags or bounds", () => {
    expect(parseArgs({ usage: "u" }, ["x", "y"])).toEqual(args({}, ["x", "y"]));
    expect(parseArgs({ usage: "u" }, ["-q"])).toEqual(
      err({ code: EXIT_USAGE, message: "unknown option: -q\n\nu" }),
    );
  });
});
