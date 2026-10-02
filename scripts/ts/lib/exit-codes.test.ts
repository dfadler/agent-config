import { describe, expect, it } from "vitest";
import {
  cliError,
  EXIT_CONFIG,
  EXIT_DEPENDENCY,
  EXIT_FAILURE,
  EXIT_INTERNAL,
  EXIT_NETWORK,
  EXIT_OK,
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
      EXIT_INTERNAL,
    ]).toEqual([0, 1, 2, 3, 4, 5, 6, 20]);
  });

  it("cliError pairs a failure code with a message", () => {
    expect(cliError(EXIT_USAGE, "bad")).toEqual({ code: 2, message: "bad" });
  });
});
