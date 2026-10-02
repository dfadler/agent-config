import { cliError, EXIT_USAGE, type CliError } from "./exit-codes.ts";
import { andThen, err, ok, type Result } from "./result.ts";

/** One accepted flag. `name` is the long form (`--name`); `short` is `-s`. */
export interface FlagSpec {
  readonly name: string;
  readonly short?: string;
  /** Takes a value (`--name v`, `--name=v`, `-s v`). Default: boolean switch. */
  readonly valued?: boolean;
}

/** What a command accepts. `usage` is printed for `-h`/`--help` and usage errors. */
export interface ArgSpec {
  readonly usage: string;
  readonly flags?: readonly FlagSpec[];
  readonly minPositionals?: number;
  readonly maxPositionals?: number;
}

/** A flag's parsed value: its text, or `true` for a boolean switch. */
export type FlagValue = string | true;

/** Parsed flags by long name; read with `flags["out"]` (may be undefined). */
export interface Flags {
  readonly [name: string]: FlagValue;
}

/** Parsed argv. `help` means `-h`/`--help` was present: print `usage`, exit 0. */
export type Parsed =
  | { readonly kind: "help"; readonly usage: string }
  | {
      readonly kind: "args";
      /** Keyed by long flag name; a repeated flag keeps its last value. */
      readonly flags: Flags;
      readonly positionals: readonly string[];
    };

interface Acc {
  readonly flags: Flags;
  readonly positionals: readonly string[];
}

const withFlag = (
  flags: Flags,
  name: string,
  value: FlagValue,
): Flags => ({ ...flags, [name]: value });

const usageError = (spec: ArgSpec, problem: string): Result<CliError, never> =>
  err(cliError(EXIT_USAGE, `${problem}\n\n${spec.usage}`));

const findFlag = (spec: ArgSpec, key: string): FlagSpec | undefined =>
  (spec.flags ?? []).find(
    (f) => key === `--${f.name}` || (f.short !== undefined && key === `-${f.short}`),
  );

const step = (
  spec: ArgSpec,
  args: readonly string[],
  acc: Acc,
): Result<CliError, Acc> => {
  const head = args[0];
  const tail: readonly string[] = args.slice(1);
  if (head === undefined) return ok(acc);
  // `--` ends flag parsing; everything after it is positional.
  if (head === "--") {
    return ok({ ...acc, positionals: [...acc.positionals, ...tail] });
  }
  // A lone `-` (conventionally stdin) is positional.
  if (!head.startsWith("-") || head === "-") {
    return step(spec, tail, { ...acc, positionals: [...acc.positionals, head] });
  }
  const eq = head.startsWith("--") ? head.indexOf("=") : -1;
  const key = eq === -1 ? head : head.slice(0, eq);
  const inline = eq === -1 ? undefined : head.slice(eq + 1);
  const flag = findFlag(spec, key);
  if (flag === undefined) return usageError(spec, `unknown option: ${key}`);
  if (flag.valued !== true) {
    return inline === undefined
      ? step(spec, tail, {
          ...acc,
          flags: withFlag(acc.flags, flag.name, true),
        })
      : usageError(spec, `option ${key} does not take a value`);
  }
  if (inline !== undefined) {
    return step(spec, tail, {
      ...acc,
      flags: withFlag(acc.flags, flag.name, inline),
    });
  }
  const value = tail[0];
  const rest: readonly string[] = tail.slice(1);
  return value === undefined
    ? usageError(spec, `option ${key} requires a value`)
    : step(spec, rest, {
        ...acc,
        flags: withFlag(acc.flags, flag.name, value),
      });
};

const checkCounts =
  (spec: ArgSpec) =>
  (acc: Acc): Result<CliError, Parsed> => {
    const n = acc.positionals.length;
    if (spec.minPositionals !== undefined && n < spec.minPositionals) {
      return usageError(spec, `expected at least ${String(spec.minPositionals)} argument(s), got ${String(n)}`);
    }
    if (spec.maxPositionals !== undefined && n > spec.maxPositionals) {
      return usageError(spec, `expected at most ${String(spec.maxPositionals)} argument(s), got ${String(n)}`);
    }
    return ok({ kind: "args", flags: acc.flags, positionals: acc.positionals });
  };

/**
 * Parse argv (without the node/script entries). Supports `-h`/`--help`,
 * boolean and valued flags (`--name v`, `--name=v`, `-s v`; no bundled short
 * flags), positionals, and `--`.
 *
 * Help wins: `-h`/`--help` anywhere before a `--` returns `{ kind: "help" }`
 * before anything else is validated, so usage is always reachable.
 */
export const parseArgs = (
  spec: ArgSpec,
  argv: readonly string[],
): Result<CliError, Parsed> => {
  const dashes = argv.indexOf("--");
  const flagArgs = dashes === -1 ? argv : argv.slice(0, dashes);
  if (flagArgs.some((a) => a === "-h" || a === "--help")) {
    return ok({ kind: "help", usage: spec.usage });
  }
  return andThen(checkCounts(spec))(
    step(spec, argv, { flags: {}, positionals: [] }),
  );
};
