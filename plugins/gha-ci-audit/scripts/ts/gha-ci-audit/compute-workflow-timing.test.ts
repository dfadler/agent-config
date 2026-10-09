import { describe, expect, it } from "vitest";
import { computeWorkflowTiming, main } from "./compute-workflow-timing.ts";
import { fakeIo } from "./test-io.ts";

const r = (s: string | null, e: string | null) => ({ s, e });

describe("computeWorkflowTiming", () => {
  it("returns avg and p90 minutes", () => {
    expect(
      computeWorkflowTiming([
        r("2025-01-01T10:00:00Z", "2025-01-01T10:06:00Z"),
        r("2025-01-01T10:00:00Z", "2025-01-01T10:04:00Z"),
      ]),
    ).toBe("5.0  6.0");
  });

  it("takes p90 from the sorted upper tail", () => {
    const runs = Array.from({ length: 10 }, (_, i) =>
      r("2025-01-01T10:00:00Z", `2025-01-01T10:${String(i + 1).padStart(2, "0")}:00Z`),
    );
    expect(computeWorkflowTiming(runs)).toBe("5.5  10.0");
  });

  it("skips runs with a null timestamp (regression for #305)", () => {
    expect(
      computeWorkflowTiming([
        r(null, "2025-01-01T10:06:00Z"),
        r("2025-01-01T10:00:00Z", "2025-01-01T10:04:00Z"),
      ]),
    ).toBe("4.0  4.0");
  });

  it.each([[[]], ["not a list"], [[r("2025-01-01T10:06:00Z", "2025-01-01T10:00:00Z")]]])(
    "reports no data for %j",
    (runs) => {
      expect(computeWorkflowTiming(runs)).toBe("?  ?");
    },
  );
});

describe("main", () => {
  it("prints the result for stdin JSON", () => {
    const a = fakeIo(JSON.stringify([r("2025-01-01T10:00:00Z", "2025-01-01T10:04:00Z")]));
    expect(main([], a.io)).toBe(0);
    expect(a.out()).toBe("4.0  4.0\n");
  });

  it("treats invalid JSON as no data and still exits 0", () => {
    const a = fakeIo("not valid json");
    expect(main([], a.io)).toBe(0);
    expect(a.out()).toBe("?  ?\n");
  });
});
