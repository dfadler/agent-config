import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pipe } from "./pipe.ts";
import {
  andThen,
  assertNever,
  collect,
  err,
  fromThrowable,
  map,
  mapErr,
  match,
  ok,
  type Result,
} from "./result.ts";

const arbResult: fc.Arbitrary<Result<string, number>> = fc.oneof(
  fc.integer().map((n) => ok(n)),
  fc.string().map((s) => err(s)),
);

const inc = (n: number): number => n + 1;
const dbl = (n: number): number => n * 2;
const safeRecip = (n: number): Result<string, number> =>
  n === 0 ? err("div0") : ok(1 / n);
const safeHalf = (n: number): Result<string, number> =>
  n % 2 === 0 ? ok(n / 2) : err("odd");

describe("pipe", () => {
  it("applies functions left to right", () => {
    expect(pipe(3)).toBe(3);
    expect(pipe(3, inc)).toBe(4);
    expect(pipe(3, inc, dbl)).toBe(8);
    expect(pipe(3, inc, dbl, String)).toBe("8");
    expect(pipe(3, inc, dbl, inc, String)).toBe("9");
  });

  it("matches nested application", () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        expect(pipe(n, inc, dbl)).toBe(dbl(inc(n)));
      }),
    );
  });
});

describe("map (functor laws)", () => {
  it("preserves identity", () => {
    fc.assert(
      fc.property(arbResult, (r) => {
        expect(pipe(r, map((x: number) => x))).toEqual(r);
      }),
    );
  });

  it("composes", () => {
    fc.assert(
      fc.property(arbResult, (r) => {
        expect(pipe(r, map(inc), map(dbl))).toEqual(
          pipe(
            r,
            map((x: number) => dbl(inc(x))),
          ),
        );
      }),
    );
  });

  it("applies the function to successes", () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        expect(pipe(ok(n), map(inc))).toEqual(ok(inc(n)));
      }),
    );
  });

  it("leaves errors untouched", () => {
    expect(pipe(err("e"), map(inc))).toEqual(err("e"));
  });
});

describe("mapErr", () => {
  it("preserves identity and leaves successes untouched", () => {
    fc.assert(
      fc.property(arbResult, (r) => {
        expect(pipe(r, mapErr((e: string) => e))).toEqual(r);
      }),
    );
    expect(pipe(ok(1), mapErr((e: string) => e.length))).toEqual(ok(1));
  });

  it("transforms the error", () => {
    expect(pipe(err("abc"), mapErr((e: string) => e.length))).toEqual(err(3));
  });
});

describe("andThen (monad laws)", () => {
  it("has ok as left identity", () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        expect(pipe(ok(n), andThen(safeRecip))).toEqual(safeRecip(n));
      }),
    );
  });

  it("has ok as right identity", () => {
    fc.assert(
      fc.property(arbResult, (r) => {
        expect(pipe(r, andThen((x: number) => ok(x)))).toEqual(r);
      }),
    );
  });

  it("is associative", () => {
    fc.assert(
      fc.property(arbResult, (r) => {
        expect(pipe(r, andThen(safeRecip), andThen(safeHalf))).toEqual(
          pipe(
            r,
            andThen((x: number) => pipe(safeRecip(x), andThen(safeHalf))),
          ),
        );
      }),
    );
  });

  it("short-circuits on the first error", () => {
    expect(pipe(ok(0), andThen(safeRecip), andThen(safeHalf))).toEqual(
      err("div0"),
    );
  });
});

describe("match", () => {
  it("handles both cases", () => {
    const f = match((e: string) => `bad:${e}`, (n: number) => `ok:${String(n)}`);
    expect(f(ok(1))).toBe("ok:1");
    expect(f(err("x"))).toBe("bad:x");
  });
});

describe("collect", () => {
  it("returns all values when every element is ok", () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), (xs) => {
        expect(collect(xs.map((x) => ok(x)))).toEqual(ok(xs));
      }),
    );
  });

  it("returns the first error in order", () => {
    fc.assert(
      fc.property(fc.array(arbResult), (rs) => {
        const firstErr = rs.find((r) => r.tag === "err");
        const out = collect(rs);
        if (firstErr === undefined) {
          expect(out.tag).toBe("ok");
        } else {
          expect(out).toEqual(firstErr);
        }
      }),
    );
  });

  it("is ok of empty for empty input", () => {
    expect(collect([])).toEqual(ok([]));
  });

  it("is idempotent when re-collected via ok", () => {
    fc.assert(
      fc.property(fc.array(arbResult), (rs) => {
        const once = collect(rs);
        expect(once.tag === "ok" ? collect(once.value.map((x) => ok(x))) : once)
          .toEqual(once);
      }),
    );
  });
});

describe("fromThrowable", () => {
  it("wraps a return value", () => {
    expect(fromThrowable(() => 1, String)).toEqual(ok(1));
  });

  it("wraps a thrown value, including non-Errors", () => {
    const boom = (): number => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- exercising non-Error throws
      throw "raw";
    };
    expect(fromThrowable(boom, (t) => `caught:${String(t)}`)).toEqual(
      err("caught:raw"),
    );
  });
});

describe("assertNever", () => {
  it("throws when reached at runtime", () => {
    // Reflect.apply takes untyped args, the only assertion-free way to bypass `never`.
    expect(() => {
      Reflect.apply(assertNever, undefined, [1]);
    }).toThrow("Unhandled case: 1");
  });
});
