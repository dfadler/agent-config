import { writeSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture fd writes instead of polluting test output; keep the rest of fs real.
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  writeSync: vi.fn(),
}));
import {
  cliError,
  EXIT_FAILURE,
  EXIT_INTERNAL,
  EXIT_OK,
  EXIT_USAGE,
} from "./exit-codes.ts";
import { err, ok } from "./result.ts";
import { execute, nodeEffects, run, type Effects, type Main } from "./run.ts";

interface Recorded {
  readonly effects: Effects;
  readonly out: string[];
  readonly errs: string[];
  readonly codes: number[];
}

const record = (): Recorded => {
  const out: string[] = [];
  const errs: string[] = [];
  const codes: number[] = [];
  return {
    out,
    errs,
    codes,
    effects: {
      stdout: (t) => out.push(t),
      stderr: (t) => errs.push(t),
      exit: (c) => codes.push(c),
      readFile: (p) => ok(`contents of ${p}`),
    },
  };
};

describe("execute", () => {
  it("writes ok text to stdout and exits EXIT_OK", () => {
    const r = record();
    execute(() => ok("hi\n"), [], {}, r.effects);
    expect(r).toMatchObject({ out: ["hi\n"], errs: [], codes: [EXIT_OK] });
  });

  it("writes the err message to stderr and exits with its code", () => {
    const r = record();
    execute(() => err(cliError(EXIT_USAGE, "bad")), [], {}, r.effects);
    expect(r).toMatchObject({ out: [], errs: ["bad\n"], codes: [EXIT_USAGE] });
  });

  it("passes argv, env and the readFile effect to main", () => {
    const r = record();
    const main: Main = (argv, env, io) => {
      const file = io.readFile("f");
      return file.tag === "ok"
        ? ok(`${argv.join(",")}|${env["K"] ?? "?"}|${file.value}`)
        : file;
    };
    execute(main, ["a", "b"], { K: "v" }, r.effects);
    expect(r.out).toEqual(["a,b|v|contents of f"]);
  });

  it("calls exit exactly once, after output", () => {
    const order: string[] = [];
    const effects: Effects = {
      stdout: () => order.push("stdout"),
      stderr: () => order.push("stderr"),
      exit: () => order.push("exit"),
      readFile: () => ok(""),
    };
    execute(() => err(cliError(EXIT_FAILURE, "x")), [], {}, effects);
    expect(order).toEqual(["stderr", "exit"]);
  });

  it("turns a throw from main into EXIT_INTERNAL", () => {
    const r = record();
    const boom: Main = () => {
      throw new Error("kaboom");
    };
    execute(boom, [], {}, r.effects);
    expect(r.errs).toEqual(["internal error: kaboom\n"]);
    expect(r.codes).toEqual([EXIT_INTERNAL]);
  });

  it("describes a non-Error throw", () => {
    const r = record();
    const boom: Main = () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "plain";
    };
    execute(boom, [], {}, r.effects);
    expect(r.errs).toEqual(["internal error: plain\n"]);
  });
});

// process.exit returns `never`, so the stand-in must not return: it throws.
const spyOnExit = () =>
  vi.spyOn(process, "exit").mockImplementation((): never => {
    throw new Error("exit called");
  });

describe("nodeEffects and run", () => {
  beforeEach(() => {
    vi.mocked(writeSync).mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("run feeds process argv/env and exits through process.exit", () => {
    const exit = spyOnExit();
    const stdout = vi.spyOn(nodeEffects, "stdout").mockImplementation(() => undefined);
    const main: Main = (argv, env) => ok(`${argv.join(",")}|${typeof env}`);
    const savedArgv = process.argv;
    process.argv = ["node", "script", "x", "y"];
    expect(() => {
      run(main);
    }).toThrow("exit called");
    process.argv = savedArgv;
    expect(exit).toHaveBeenCalledWith(EXIT_OK);
    expect(stdout).toHaveBeenCalledWith("x,y|object");
  });

  it("stdout and stderr write synchronously to fd 1 and 2", () => {
    nodeEffects.stdout("out");
    nodeEffects.stderr("err");
    expect(vi.mocked(writeSync).mock.calls).toEqual([
      [1, "out"],
      [2, "err"],
    ]);
  });

  it("nodeEffects.exit calls process.exit with the code", () => {
    const exit = spyOnExit();
    expect(() => {
      nodeEffects.exit(EXIT_USAGE);
    }).toThrow("exit called");
    expect(exit).toHaveBeenCalledWith(EXIT_USAGE);
  });

  it("nodeEffects.readFile reads a real file", () => {
    expect(nodeEffects.readFile("package.json").tag).toBe("ok");
  });
});
