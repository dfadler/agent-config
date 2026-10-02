import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  checkScript,
  declaresStrictSet,
  firstStatement,
  formatViolations,
  headerLines,
  isSourcedOnly,
  type Violation,
} from "./shell-set-flags.ts";

const kinds = (file: string, text: string, executable = true): string[] =>
  checkScript(file, text, executable).map((v) => v.kind);

describe("checkScript: set flags", () => {
  it("passes when set -uo pipefail is the first statement", () => {
    expect(kinds("ok.sh", "#!/bin/bash\nset -uo pipefail\n\necho hi\n")).toEqual([]);
  });

  it("passes when set -euo pipefail is the first statement", () => {
    expect(kinds("ok.sh", "#!/bin/bash\nset -euo pipefail\n\necho hi\n")).toEqual([]);
  });

  it("passes when a long header comment precedes the set line", () => {
    const text = [
      "#!/bin/bash",
      "#",
      ...Array.from({ length: 20 }, () => "# more rationale..."),
      "set -euo pipefail",
      "echo hi",
    ].join("\n");
    expect(kinds("long-header.sh", text)).toEqual([]);
  });

  it("fails when a shebanged script has no set flags at all", () => {
    expect(kinds("missing.sh", "#!/bin/bash\n\necho hi\n")).toEqual(["missing-set-flags"]);
  });

  it("fails when set appears after a real statement", () => {
    expect(kinds("late.sh", "#!/bin/bash\necho hi\nset -euo pipefail\n")).toEqual([
      "missing-set-flags",
    ]);
  });

  it("fails on 'set -eu pipefail': no -o, so pipefail never takes effect", () => {
    expect(kinds("no-o.sh", "#!/bin/bash\nset -eu pipefail\necho hi\n")).toEqual([
      "missing-set-flags",
    ]);
  });

  it("fails on 'set -eo pipefail': no -u", () => {
    expect(kinds("no-u.sh", "#!/bin/bash\nset -eo pipefail\necho hi\n")).toEqual([
      "missing-set-flags",
    ]);
  });

  it("fails on an empty file and a comments-only file", () => {
    expect(kinds("empty.sh", "", true)).toEqual(["missing-set-flags"]);
    expect(kinds("c.sh", "# nothing\n")).toEqual(["missing-set-flags"]);
  });

  it("does not accept trailing text on the set line", () => {
    expect(kinds("t.sh", "set -euo pipefail # why\n")).toEqual(["missing-set-flags"]);
  });
});

describe("checkScript: no shebang and sourced-only", () => {
  it("a file with no shebang and no marker is NOT exempt", () => {
    expect(kinds("lib.sh", "# a library, maybe sourced\nhelper() { echo hi; }\n", false)).toEqual([
      "missing-set-flags",
    ]);
  });

  it("a no-shebang file passes when set -uo pipefail is its first real statement", () => {
    expect(kinds("lib.sh", "# a library\nset -uo pipefail\nhelper() { echo hi; }\n", false)).toEqual(
      [],
    );
  });

  it("a no-shebang file whose first line is real code does not skip that line", () => {
    expect(kinds("lib.sh", "set -uo pipefail\necho hi\n", false)).toEqual([]);
    expect(kinds("lib.sh", "echo hi\nset -uo pipefail\n", false)).toEqual(["missing-set-flags"]);
  });

  it("the marker exempts a no-shebang file from the set-flags check", () => {
    expect(kinds("lib.sh", "# sourced-only\nhelper() { echo hi; }\n", false)).toEqual([]);
  });

  it("the marker exempts a shebanged, non-executable file with no set flags", () => {
    expect(kinds("lib.sh", "#!/bin/bash\n# sourced-only\nhelper() { echo hi; }\n", false)).toEqual(
      [],
    );
  });

  it("a marker after the first real statement does not count", () => {
    expect(kinds("late-marker.sh", "#!/bin/bash\necho hi\n# sourced-only\n")).toEqual([
      "missing-set-flags",
    ]);
  });

  it("near-miss markers do not grant the exemption", () => {
    for (const marker of ["#sourced-only", "# sourced-only ", "#  sourced-only", "# Sourced-only"]) {
      expect(kinds("near-miss.sh", `${marker}\nhelper() { echo hi; }\n`)).toEqual([
        "missing-set-flags",
      ]);
    }
  });
});

describe("checkScript: executable bit", () => {
  it("fails when a shebanged script is not executable", () => {
    expect(kinds("not-exec.sh", "#!/bin/bash\nset -uo pipefail\necho hi\n", false)).toEqual([
      "non-executable",
    ]);
  });

  it("reports both violation types independently when a script has neither", () => {
    expect(kinds("broken.sh", "#!/bin/bash\necho hi\n", false)).toEqual([
      "non-executable",
      "missing-set-flags",
    ]);
  });

  it("a no-shebang file is never checked for the executable bit", () => {
    expect(kinds("lib.sh", "# a library\nhelper() { echo hi; }\n", false)).toEqual([
      "missing-set-flags",
    ]);
  });

  it("a marked no-shebang file is exempt from the executable-bit check too", () => {
    expect(kinds("lib.sh", "# sourced-only\nhelper() { echo hi; }\n", false)).toEqual([]);
  });
});

describe("pieces", () => {
  it("headerLines stops at the first real statement and keeps a comments-only file whole", () => {
    expect(headerLines(["#!/bin/sh", "", "# c", "echo", "# later"])).toEqual(["#!/bin/sh", "", "# c"]);
    expect(headerLines(["# a", "# b"])).toEqual(["# a", "# b"]);
  });

  it("isSourcedOnly and firstStatement", () => {
    expect(isSourcedOnly(["#!/bin/sh", "# sourced-only", "x"])).toBe(true);
    expect(firstStatement(["#!/bin/sh", "", "# c", "echo hi"], true)).toBe("echo hi");
    expect(firstStatement(["# c"], false)).toBeUndefined();
  });

  it("declaresStrictSet needs both u and o", () => {
    expect(declaresStrictSet("set -uo pipefail")).toBe(true);
    expect(declaresStrictSet("set -euo pipefail")).toBe(true);
    expect(declaresStrictSet("set -ou pipefail")).toBe(true);
    expect(declaresStrictSet("set -e pipefail")).toBe(false);
    expect(declaresStrictSet("set -uo")).toBe(false);
    expect(declaresStrictSet(undefined)).toBe(false);
  });
});

describe("formatViolations", () => {
  it("is undefined when clean", () => {
    expect(formatViolations([])).toBeUndefined();
  });

  it("lists a file under both headings when it violates both checks", () => {
    const v: readonly Violation[] = [
      { file: "broken.sh", kind: "non-executable" },
      { file: "broken.sh", kind: "missing-set-flags" },
    ];
    const text = formatViolations(v) ?? "";
    expect(text.match(/broken\.sh/g)).toHaveLength(2);
    expect(text).toContain("not marked executable");
    expect(text).toContain("Missing 'set -uo pipefail'");
  });

  it("omits the heading of a kind with no offenders", () => {
    const text = formatViolations([{ file: "a.sh", kind: "missing-set-flags" }]) ?? "";
    expect(text).not.toContain("not marked executable");
  });
});

describe("properties", () => {
  const filler = fc.array(
    fc.oneof(
      fc.constant(""),
      fc.constant("   "),
      fc.string({ maxLength: 20 }).map((s) => `# ${s.replaceAll(/[\n\r]/g, " ")}`),
    ),
    { maxLength: 15 },
  );
  const body = fc.constantFrom(
    "set -uo pipefail",
    "set -euo pipefail",
    "set -eu pipefail",
    "set -e",
    "echo hi",
  );

  it("blank and comment lines before the first statement never change the verdict", () => {
    fc.assert(
      fc.property(filler, body, fc.boolean(), fc.boolean(), (pad, stmt, shebang, executable) => {
        const first = shebang ? ["#!/bin/bash"] : [];
        const plain = [...first, stmt, "echo rest"].join("\n");
        const padded = [...first, ...pad, stmt, "echo rest"].join("\n");
        // A padding comment can never be the exact marker: they all start "# " + text,
        // so exclude the one value that would be (empty text is "# ").
        fc.pre(!pad.includes("# sourced-only"));
        expect(checkScript("f.sh", padded, executable)).toEqual(checkScript("f.sh", plain, executable));
      }),
    );
  });

  it("the sourced-only marker anywhere in the header always exempts", () => {
    fc.assert(
      fc.property(filler, filler, body, fc.boolean(), (before, after, stmt, executable) => {
        const text = [...before, "# sourced-only", ...after, stmt].join("\n");
        expect(checkScript("f.sh", text, executable)).toEqual([]);
      }),
    );
  });

  it("the executable bit only matters for shebanged, unmarked files", () => {
    fc.assert(
      fc.property(body, fc.boolean(), (stmt, shebang) => {
        const text = `${shebang ? "#!/bin/bash\n" : ""}${stmt}\n`;
        const exec = checkScript("f.sh", text, true).map((v) => v.kind);
        const noExec = checkScript("f.sh", text, false).map((v) => v.kind);
        expect(exec).not.toContain("non-executable");
        expect(noExec.includes("non-executable")).toBe(shebang);
        expect(noExec.filter((k) => k !== "non-executable")).toEqual(exec);
      }),
    );
  });
});
