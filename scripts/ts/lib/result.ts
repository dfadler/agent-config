/** Successful outcome carrying a value. */
export interface Ok<out A> {
  readonly tag: "ok";
  readonly value: A;
}

/** Failed outcome carrying an error value (not necessarily an `Error`). */
export interface Err<out E> {
  readonly tag: "err";
  readonly error: E;
}

/** Either a success (`ok`) or a failure (`err`); discriminate on `tag`. */
export type Result<E, A> = Err<E> | Ok<A>;

/** Wrap a success value. */
export const ok = <A>(value: A): Ok<A> => ({ tag: "ok", value });

/** Wrap a failure value. */
export const err = <E>(error: E): Err<E> => ({ tag: "err", error });

/** Transform the success value; failures pass through untouched. */
export const map =
  <A, B>(f: (a: A) => B) =>
  <E>(r: Result<E, A>): Result<E, B> =>
    r.tag === "ok" ? ok(f(r.value)) : r;

/** Transform the error value; successes pass through untouched. */
export const mapErr =
  <E, F>(f: (e: E) => F) =>
  <A>(r: Result<E, A>): Result<F, A> =>
    r.tag === "err" ? err(f(r.error)) : r;

/** Sequence a fallible step after a success (monadic bind / flatMap). */
export const andThen =
  <A, E2, B>(f: (a: A) => Result<E2, B>) =>
  <E1>(r: Result<E1, A>): Result<E1 | E2, B> =>
    r.tag === "ok" ? f(r.value) : r;

/** Collapse a Result into one value by handling both cases. */
export const match =
  <E, A, B>(onErr: (e: E) => B, onOk: (a: A) => B) =>
  (r: Result<E, A>): B =>
    r.tag === "ok" ? onOk(r.value) : onErr(r.error);

/**
 * Turn an array of Results into a Result of an array. Returns the first
 * `err` in order (short-circuit) or all values in order.
 */
export const collect = <E, A>(
  results: readonly Result<E, A>[],
): Result<E, readonly A[]> => {
  const first = results.find((r) => r.tag === "err");
  const values: readonly A[] = results.flatMap((r): readonly A[] =>
    r.tag === "ok" ? [r.value] : [],
  );
  return first ?? ok(values);
};

/**
 * Boundary adapter: run `f`, converting a thrown value into `err` via
 * `onThrow`. Use only where third-party or platform code may throw.
 */
export const fromThrowable = <E, A>(
  f: () => A,
  onThrow: (thrown: unknown) => E,
): Result<E, A> => {
  try {
    return ok(f());
  } catch (thrown: unknown) {
    return err(onThrow(thrown));
  }
};

/**
 * Compile-time exhaustiveness check for switches over a union: the argument
 * is `never` only when every case is handled. Throws if reached at runtime.
 */
export const assertNever = (value: never): never => {
  // Unreachable when the types hold, so a throw is the right tool here.
  // eslint-disable-next-line functional/no-throw-statements
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
};
