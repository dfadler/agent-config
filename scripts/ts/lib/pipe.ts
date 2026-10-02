/**
 * Left-to-right function composition: `pipe(x, f, g)` is `g(f(x))`.
 * Overloads cover up to five steps; wrap longer chains in a named function.
 */
export function pipe<A>(a: A): A;
export function pipe<A, B>(a: A, ab: (a: A) => B): B;
export function pipe<A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C;
export function pipe<A, B, C, D>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
): D;
export function pipe<A, B, C, D, E>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
): E;
export function pipe(
  a: unknown,
  ...fns: readonly ((x: unknown) => unknown)[]
): unknown {
  return fns.reduce((acc, fn) => fn(acc), a);
}
