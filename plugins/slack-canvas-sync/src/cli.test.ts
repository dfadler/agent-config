import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE, run } from "./cli.ts";
import { snapshotFile } from "./manifest.ts";

const NOW = "2026-01-01T00:00:00.000Z";

function json(text: string): unknown {
  return JSON.parse(text);
}

function field(value: unknown, key: string): unknown {
  assert.ok(typeof value === "object" && value !== null);
  return Object.entries(value).find(([name]) => name === key)?.[1];
}

test("no arguments and --help print usage and succeed", () => {
  for (const argv of [[], ["--help"], ["-h"]]) {
    const result = run(argv, "", NOW);
    assert.equal(result.code, EXIT_OK);
    assert.match(result.stdout, /^Usage:/);
  }
});

test("an unknown command is a usage error", () => {
  const result = run(["frobnicate"], "", NOW);
  assert.equal(result.code, EXIT_USAGE);
  assert.match(result.stderr, /unknown command "frobnicate"/);
});

test("normalize returns title, sections and hashes", () => {
  const result = run(["normalize", "--side", "local"], "# T\n\n- a\n- b\n\ntext\n", NOW);
  assert.equal(result.code, EXIT_OK);
  const out = json(result.stdout);
  assert.equal(field(out, "title"), "T");
  assert.deepEqual(field(out, "sections"), ["* a\n* b", "text"]);
  assert.equal(Array.isArray(field(out, "hashes")), true);
});

test("normalize --side remote takes the first line as the title", () => {
  const result = run(["normalize", "--side", "remote"], "# Remote\n\nbody\n", NOW);
  assert.equal(field(json(result.stdout), "title"), "Remote");
});

test("normalize needs a valid --side", () => {
  assert.equal(run(["normalize"], "", NOW).code, EXIT_USAGE);
  assert.equal(run(["normalize", "--side", "both"], "", NOW).code, EXIT_USAGE);
});

test("validate exits 1 only when there are errors", () => {
  const clean = run(["validate"], "# fine\n", NOW);
  assert.equal(clean.code, EXIT_OK);
  assert.equal(field(json(clean.stdout), "ok"), true);

  const warning = run(["validate"], "#### deep\n", NOW);
  assert.equal(warning.code, EXIT_OK);

  const bad = run(["validate"], "* a\n  # nope\n", NOW);
  assert.equal(bad.code, EXIT_FAILURE);
  assert.equal(field(json(bad.stdout), "ok"), false);
});

function planInput(extra: Record<string, unknown>): string {
  return JSON.stringify({
    entry: snapshotFile({
      canvasId: "F1",
      title: "T",
      sections: ["a", "b"],
      now: NOW,
    }),
    ...extra,
  });
}

test("plan reports a push with canvas edits and the next manifest entry", () => {
  const result = run(
    ["plan"],
    planInput({
      local: "# T\n\na\n\nb changed\n",
      remote: "# T\n\na\n\nb\n",
      canvas_id: "F1",
      section_ids: ["temp:C:VLO1", "temp:C:VLO2"],
    }),
    NOW,
  );
  assert.equal(result.code, EXIT_OK);
  const out = json(result.stdout);
  assert.equal(field(out, "status"), "push");
  assert.deepEqual(field(out, "ops"), [
    { type: "replace", remoteIndex: 1, text: "b changed" },
  ]);
  const entry = field(out, "entry");
  assert.equal(field(entry, "canvas_id"), "F1");
  assert.equal(field(entry, "last_synced_at"), NOW);
});

test("plan with a conflict returns it and withholds the next entry", () => {
  const result = run(
    ["plan"],
    planInput({
      local: "# T\n\na\n\nb local\n",
      remote: "# T\n\na\n\nb remote\n",
      canvas_id: "F1",
    }),
    NOW,
  );
  const out = json(result.stdout);
  assert.equal(field(out, "status"), "conflict");
  assert.equal(field(out, "entry"), null);
  assert.equal(Array.isArray(field(out, "conflicts")), true);
});

test("plan without an entry treats the file as never synced", () => {
  const result = run(["plan"], JSON.stringify({ local: "# T\n\nx\n", remote: "# T\n" }), NOW);
  assert.equal(field(json(result.stdout), "status"), "push");
  assert.equal(field(json(result.stdout), "entry"), null);
});

test("plan rejects bad input without a stack trace", () => {
  assert.equal(run(["plan"], "not json", NOW).code, EXIT_USAGE);
  assert.equal(run(["plan"], "[]", NOW).code, EXIT_USAGE);
  const missing = run(["plan"], JSON.stringify({ local: "x" }), NOW);
  assert.equal(missing.code, EXIT_FAILURE);
  assert.match(missing.stderr, /"remote" must be a string/);
  const badEntry = run(
    ["plan"],
    JSON.stringify({ entry: { canvas_id: "" }, local: "x", remote: "y" }),
    NOW,
  );
  assert.equal(badEntry.code, EXIT_FAILURE);
  assert.match(badEntry.stderr, /invalid manifest/);
});

test("bin.ts wires stdin, stdout and the exit code to run()", () => {
  const bin = join(import.meta.dirname, "bin.ts");
  const ok = spawnSync(process.execPath, [bin, "validate"], {
    input: "# fine\n",
    encoding: "utf8",
  });
  assert.equal(ok.status, EXIT_OK);
  assert.equal(field(json(ok.stdout), "ok"), true);

  const bad = spawnSync(process.execPath, [bin, "validate"], {
    input: "* a\n  # nope\n",
    encoding: "utf8",
  });
  assert.equal(bad.status, EXIT_FAILURE);

  const usage = spawnSync(process.execPath, [bin, "nope"], { encoding: "utf8" });
  assert.equal(usage.status, EXIT_USAGE);
});
