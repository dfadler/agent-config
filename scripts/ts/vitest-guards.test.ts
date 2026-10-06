import { describe, expect, it } from "vitest";
import {
  extractFlags,
  findV3Names,
  formatMissingFlags,
  formatV3Hits,
  missingFlags,
  normalizeFlag,
} from "./vitest-guards.ts";

const HELP = `
  --reporter <name>        Specify reporters
  --isolate                Run every test file in isolation. To disable isolation, use --no-isolate
  --fileParallelism        Use --no-file-parallelism to disable
  --maxWorkers <workers>   Maximum number of workers
  --sequence.shuffle.tests Run tests in a random order
  --sequence.seed <seed>   Set the randomization seed
  --mergeReports [path]    Path to a blob reports directory
`;

describe("normalizeFlag", () => {
  it("drops dashes and a no- prefix, and camelCases kebab names", () => {
    expect(normalizeFlag("--no-file-parallelism")).toBe("fileParallelism");
    expect(normalizeFlag("--merge-reports")).toBe("mergeReports");
    expect(normalizeFlag("--sequence.shuffle.tests")).toBe("sequence.shuffle.tests");
  });
});

describe("extractFlags", () => {
  it("finds flags in prose, code spans and =value forms, deduplicated", () => {
    const text = "Use `--repeats=100` or --repeats, then `--sequence.seed=<n>`.";
    expect(extractFlags(text)).toEqual(["--repeats", "--sequence.seed"]);
  });

  it("strips trailing punctuation, ignores a bare -- separator and mid-word dashes", () => {
    expect(extractFlags("npm test -- --bail. Also foo--bar and a -- b")).toEqual(["--bail"]);
  });

  it("skips other tools' flags", () => {
    expect(extractFlags("NODE_OPTIONS=--max-old-space-size=512 --maxWorkers")).toEqual([
      "--maxWorkers",
    ]);
  });
});

describe("missingFlags", () => {
  it("accepts flags the help lists, including no- and kebab aliases", () => {
    expect(
      missingFlags(
        ["--reporter", "--no-isolate", "--no-file-parallelism", "--merge-reports", "--sequence.seed"],
        HELP,
      ),
    ).toEqual([]);
  });

  it("reports a flag the help does not list, such as a v3 flag", () => {
    expect(missingFlags(["--poolOptions.threads.maxThreads", "--reporter"], HELP)).toEqual([
      "--poolOptions.threads.maxThreads",
    ]);
  });

  it("does not let a flag pass on a prefix match", () => {
    expect(missingFlags(["--sequence", "--maxWorker"], HELP)).toEqual(["--sequence", "--maxWorker"]);
  });
});

describe("findV3Names", () => {
  it("flags each v3 name with its line number", () => {
    const text = [
      "ok",
      "use poolOptions.threads.maxThreads",
      "set VITEST_MAX_FORKS=2",
      "singleThread: true",
      "singleFork too, maxForks",
    ].join("\n");
    expect(findV3Names("a.md", text).map((h) => h.line)).toEqual([2, 3, 4, 5]);
  });

  it.each(["removed", "not in Vitest 4", "RENAMED to maxWorkers"])(
    "allows a line that also says %s",
    (note) => {
      expect(findV3Names("a.md", `maxThreads was ${note}`)).toEqual([]);
    },
  );

  it("does not let a note on a neighbouring line excuse a hit", () => {
    expect(findV3Names("a.md", "poolOptions was removed\nmaxThreads: 2")).toEqual([
      { file: "a.md", line: 2, text: "maxThreads: 2" },
    ]);
  });

  it("ignores v4 names", () => {
    expect(findV3Names("a.md", "maxWorkers and VITEST_MAX_WORKERS")).toEqual([]);
  });
});

describe("formatting", () => {
  it("returns undefined when there is nothing to report", () => {
    expect(formatV3Hits([])).toBeUndefined();
    expect(formatMissingFlags([])).toBeUndefined();
  });

  it("names file, line and text of each v3 hit", () => {
    expect(formatV3Hits([{ file: "a.md", line: 3, text: "maxForks" }])).toContain("a.md:3: maxForks");
  });

  it("names file and flag of each missing flag", () => {
    expect(formatMissingFlags([{ file: "a.md", flag: "--gone" }])).toContain("a.md: --gone");
  });
});
