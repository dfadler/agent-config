import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll as after, test } from "vitest";
import { FakeCanvas } from "../test/fake-canvas.ts";
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

// --- sync-root commands ---

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "canvas-sync-cli-"));
  roots.push(root);
  for (const [rel, text] of Object.entries(files)) writeFileSync(join(root, rel), text, "utf8");
  return root;
}

test("scan lists the files under a root", () => {
  const root = tempRoot({ "a.md": "# A\n\ntext\n" });
  const result = run(["scan", "--root", root], "", NOW);
  assert.equal(result.code, EXIT_OK);
  assert.deepEqual(json(result.stdout), {
    files: [
      {
        path: "a.md",
        sync: true,
        title: "A",
        state: "new",
        canvas_id: null,
        local_changed: true,
        nav_stale: false,
        validation_errors: 0,
      },
    ],
    missing: [],
    pending_manual_deletion: [],
    tracked_in_git: [],
  });
});

test("nav prints the generated navigation block per file, and warnings", () => {
  const root = tempRoot({ "index.md": "# Home\n", "a.md": "---\nrelated: [nope.md]\n---\n\n# A\n" });
  const out = json(run(["nav", "--root", root], "", NOW).stdout);
  const blocks = field(out, "blocks");
  assert.match(String(field(blocks, "a.md")), /Home/);
  assert.match(String(field(blocks, "index.md")), /\*\*Children\*\*/);
  assert.deepEqual(field(field(out, "warnings"), "a.md"), [
    'related "nope.md" is not a synced file under the root',
  ]);
});

test("pending entries are listed, added, and resolved through the CLI", () => {
  const root = tempRoot({});
  const added = run(
    ["pending", "add", "--root", root, "--canvas-id", "F7", "--reason", "superseded", "--title", "Old", "--canvas-url", "https://example.invalid/F7"],
    "",
    NOW,
  );
  assert.equal(added.code, EXIT_OK);
  assert.deepEqual(json(added.stdout), { added: true });

  const listed = json(run(["pending", "list", "--root", root], "", NOW).stdout);
  assert.deepEqual(field(listed, "pending"), [
    { canvas_id: "F7", title: "Old", reason: "superseded", added_at: NOW, canvas_url: "https://example.invalid/F7" },
  ]);
  assert.match(String(field(listed, "delete_steps")), /Delete canvas/);

  const resolved = run(["pending", "resolve", "--root", root, "--canvas-id", "F7"], "", NOW);
  assert.deepEqual(json(resolved.stdout), { resolved: true });
  assert.deepEqual(field(json(run(["pending", "list", "--root", root], "", NOW).stdout), "pending"), []);
});

test("retire flags a removed file's canvas and refuses a file that still exists", () => {
  const root = tempRoot({ "a.md": "# A\n\none\n" });
  const canvas = new FakeCanvas("A", ["one"]);
  run(
    ["record", "--root", root, "--path", "a.md", "--after", "push", "--canvas-url", "https://example.invalid/F1"],
    JSON.stringify(canvas.readResult()),
    NOW,
  );

  const early = run(["retire", "--root", root, "--path", "a.md", "--reason", "superseded"], "", NOW);
  assert.equal(early.code, EXIT_FAILURE);
  assert.match(early.stderr, /still exists/);

  rmSync(join(root, "a.md"));
  const done = run(["retire", "--root", root, "--path", "a.md", "--reason", "local-file-removed"], "", NOW);
  assert.equal(done.code, EXIT_OK);
  assert.equal(field(field(json(done.stdout), "retired"), "canvas_url"), "https://example.invalid/F1");

  const missing = run(["retire", "--root", root, "--path", "a.md", "--reason", "superseded"], "", NOW);
  assert.equal(missing.code, EXIT_FAILURE);
  assert.match(missing.stderr, /not tracked/);
});

test("pending and retire report usage problems as usage errors", () => {
  const cases: [string[], RegExp][] = [
    [["pending", "list"], /--root is required/],
    [["pending", "bogus", "--root", "."], /expected list, add, or resolve/],
    [["pending", "resolve", "--root", "."], /--canvas-id is required/],
    [["pending", "add", "--root", ".", "--canvas-id", "F1"], /--reason .* is required/],
    [["pending", "add", "--root", ".", "--canvas-id", "F1", "--reason", "because"], /--reason .* is required/],
    [["retire", "--root", ".", "--path", "a.md"], /--reason local-file-removed\|superseded is required/],
    [["retire", "--root", ".", "--path", "a.md", "--reason", "test"], /--reason local-file-removed\|superseded is required/],
  ];
  for (const [argv, pattern] of cases) {
    const result = run(argv, "", NOW);
    assert.equal(result.code, EXIT_USAGE, argv.join(" "));
    assert.match(result.stderr, pattern);
  }
});

test("push, record and pull run end to end through the CLI", () => {
  const root = tempRoot({ "a.md": "# A\n\none\n\ntwo\n" });
  const create = run(["plan-push", "--root", root, "--path", "a.md"], "", NOW);
  assert.equal(create.code, EXIT_OK);
  assert.deepEqual(field(json(create.stdout), "create"), { title: "A", content: "one\n\ntwo\n" });

  const canvas = new FakeCanvas("A", ["one", "two"]);
  const record = run(
    ["record", "--root", root, "--path", "a.md", "--after", "push"],
    JSON.stringify(canvas.readResult()),
    NOW,
  );
  assert.equal(record.code, EXIT_OK);
  assert.equal(field(json(record.stdout), "recorded"), true);

  canvas.uiEdit(1, "two, edited in Slack");
  const read = JSON.stringify(canvas.readResult());
  const dry = run(["pull", "--root", root, "--path", "a.md"], read, NOW);
  assert.equal(field(json(dry.stdout), "applied"), false);
  const applied = run(["pull", "--root", root, "--path", "a.md", "--apply"], read, NOW);
  assert.equal(field(json(applied.stdout), "applied"), true);
  assert.ok(readFileSync(join(root, "a.md"), "utf8").includes("edited in Slack"));

  const plan = run(["plan-push", "--root", root, "--path", "a.md"], read, NOW);
  assert.equal(field(json(plan.stdout), "status"), "in-sync");
});

test("plan-push exits 1 when the plan is blocked", () => {
  const root = tempRoot({ "bad.md": "* a\n  # nope\n" });
  const result = run(["plan-push", "--root", root, "--path", "bad.md"], "", NOW);
  assert.equal(result.code, EXIT_FAILURE);
  assert.equal(field(json(result.stdout), "blocked"), "validation");
});

test("record exits 1 when the step did not land", () => {
  const root = tempRoot({ "a.md": "# A\n\none\n" });
  const canvas = new FakeCanvas("A", ["different"]);
  const result = run(
    ["record", "--root", root, "--path", "a.md", "--after", "push"],
    JSON.stringify(canvas.readResult()),
    NOW,
  );
  assert.equal(result.code, EXIT_FAILURE);
  assert.equal(field(json(result.stdout), "recorded"), false);
});

test("fingerprint returns a stable value for the same read", () => {
  const canvas = new FakeCanvas("A", ["one"]);
  const read = JSON.stringify(canvas.readResult());
  const first = field(json(run(["fingerprint"], read, NOW).stdout), "fingerprint");
  const second = field(json(run(["fingerprint"], read, NOW).stdout), "fingerprint");
  assert.equal(typeof first, "string");
  assert.equal(first, second);
  assert.equal(run(["fingerprint"], "nope", NOW).code, EXIT_USAGE);
});

test("root commands report usage problems as usage errors", () => {
  const cases: [string[], string, RegExp][] = [
    [["scan"], "", /--root is required/],
    [["scan", "--root"], "", /--root needs a value/],
    [["scan", "--bogus", "x"], "", /unknown option/],
    [["scan", "stray"], "", /unexpected argument/],
    [["plan-push", "--root", "."], "", /--path is required/],
    [["plan-push", "--root", ".", "--path", "a.md"], "not json", /not valid JSON/],
    [["record", "--root", ".", "--path", "a.md"], "{}", /--after push\|pull is required/],
    [["pull", "--root", ".", "--path", "a.md"], "", /slack_read_canvas result is required/],
  ];
  for (const [argv, stdin, pattern] of cases) {
    const result = run(argv, stdin, NOW);
    assert.equal(result.code, EXIT_USAGE, argv.join(" "));
    assert.match(result.stderr, pattern);
  }
});

test("sync errors exit 1 with a message, not a stack trace", () => {
  const missingRoot = run(["scan", "--root", "/definitely/not/here"], "", NOW);
  assert.equal(missingRoot.code, EXIT_FAILURE);
  assert.match(missingRoot.stderr, /sync root does not exist/);

  const badRead = run(["pull", "--root", tempRoot({}), "--path", "a.md"], "{}", NOW);
  assert.equal(badRead.code, EXIT_FAILURE);
  assert.match(badRead.stderr, /unusable canvas read/);

  const escape = run(["plan-push", "--root", tempRoot({}), "--path", "../x.md"], "", NOW);
  assert.equal(escape.code, EXIT_FAILURE);
});
