import { describe, expect, it } from "vitest";
import {
  cliError,
  EXIT_CONFIG,
  EXIT_DEPENDENCY,
  EXIT_FAILURE,
  EXIT_INTERNAL,
  EXIT_NETWORK,
  EXIT_INTERRUPTED,
  EXIT_OK,
  EXIT_PARTIAL,
  EXIT_TERMINATED,
  EXIT_TIMEOUT,
  EXIT_USAGE,
} from "./exit-codes.ts";

describe("exit codes", () => {
  it("match the shell taxonomy in shell-script-hygiene.md", () => {
    expect([
      EXIT_OK,
      EXIT_FAILURE,
      EXIT_USAGE,
      EXIT_CONFIG,
      EXIT_DEPENDENCY,
      EXIT_NETWORK,
      EXIT_TIMEOUT,
      EXIT_PARTIAL,
      EXIT_INTERNAL,
      EXIT_INTERRUPTED,
      EXIT_TERMINATED,
    ]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 20, 130, 143]);
  });

  it("cliError pairs a failure code with a message", () => {
    expect(cliError(EXIT_USAGE, "bad")).toEqual({ code: 2, message: "bad" });
  });
});
