import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "./setup-eval.ts";
import { fakeIo, readObj } from "./test-io.ts";

const iter = (): string => join(mkdtempSync(join(tmpdir(), "setup-eval-")), "iteration-1");

describe("main", () => {
  it("creates outputs/ and eval_metadata.json with a numeric id and empty assertions", () => {
    const dir = iter();
    const io = fakeIo();
    expect(main([dir, "my-eval", "7", "Audit the repo"], io.io)).toBe(0);
    const meta = join(dir, "my-eval", "with_skill", "eval_metadata.json");
    expect(io.out()).toBe(`Created: ${meta}\n`);
    expect(existsSync(join(dir, "my-eval", "with_skill", "outputs"))).toBe(true);
    expect(readObj(meta)).toEqual({ eval_id: 7, eval_name: "my-eval", prompt: "Audit the repo", assertions: [] });
  });

  it("escapes quotes and newlines in the prompt", () => {
    const dir = iter();
    const prompt = 'Say "hi"\nthen stop';
    expect(main([dir, "quoted", "2", prompt], fakeIo().io)).toBe(0);
    expect(readObj(join(dir, "quoted", "with_skill", "eval_metadata.json"))["prompt"]).toBe(prompt);
  });

  it("overwrites the metadata when re-run", () => {
    const dir = iter();
    main([dir, "my-eval", "1", "first"], fakeIo().io);
    expect(main([dir, "my-eval", "2", "second"], fakeIo().io)).toBe(0);
    expect(readObj(join(dir, "my-eval", "with_skill", "eval_metadata.json"))).toMatchObject({ eval_id: 2, prompt: "second" });
  });

  it("exits 1 with usage on too few or too many args, creating nothing", () => {
    const dir = iter();
    const io = fakeIo();
    expect(main([dir, "my-eval", "1"], io.io)).toBe(1);
    expect(io.err()).toContain("Usage:");
    expect(main([dir, "e", "1", "p", "extra"], fakeIo().io)).toBe(1);
    expect(existsSync(dir)).toBe(false);
  });

  it("exits 1 on a non-integer id", () => {
    const dir = iter();
    const io = fakeIo();
    expect(main([dir, "e", "abc", "p"], io.io)).toBe(1);
    expect(io.err()).toContain("eval_id must be an integer");
    expect(existsSync(dir)).toBe(false);
  });
});
