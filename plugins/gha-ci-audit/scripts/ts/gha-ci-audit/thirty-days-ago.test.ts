import { expect, it } from "vitest";
import { main } from "./thirty-days-ago.ts";
import { fakeIo } from "./test-io.ts";

it("prints the created>= timestamp", () => {
  const a = fakeIo();
  expect(main([], a.io, new Date("2025-03-31T12:34:56Z"))).toBe(0);
  expect(a.out()).toBe("2025-03-01T12:34:56Z\n");
});
