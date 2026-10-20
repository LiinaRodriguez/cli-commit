import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commit, currentBranch, getContext, stageAll, truncateDiff } from "../src/git.js";

let dir: string;
const run = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "smart-commit-"));
  run("init", "-q", "-b", "main");
  run("config", "user.email", "test@example.com");
  run("config", "user.name", "Test");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("truncateDiff", () => {
  it("leaves short diffs alone", () => {
    expect(truncateDiff("abc", 10)).toEqual({ diff: "abc", truncated: false });
  });

  it("cuts long diffs and notes how much was omitted", () => {
    const { diff, truncated } = truncateDiff("x".repeat(25), 10);
    expect(truncated).toBe(true);
    expect(diff.startsWith("x".repeat(10))).toBe(true);
    expect(diff).toContain("15 more characters omitted");
  });
});

describe("getContext", () => {
  it("works in a repo with no commits yet", async () => {
    writeFileSync(join(dir, "a.txt"), "hello\n");
    expect(await currentBranch(dir)).toBe("main");

    const all = await getContext({ all: true, maxDiffChars: 10_000, cwd: dir });
    expect(all.status).toBe("?? a.txt");
    expect(all.diff).toContain("+hello");

    const staged = await getContext({ all: false, maxDiffChars: 10_000, cwd: dir });
    expect(staged.diff).toBe("");
  });

  it("reads staged changes only unless all is set", async () => {
    writeFileSync(join(dir, "a.txt"), "one\n");
    run("add", "a.txt");
    run("commit", "-q", "-m", "init");
    writeFileSync(join(dir, "a.txt"), "two\n");
    writeFileSync(join(dir, "b.txt"), "new\n");

    expect((await getContext({ all: false, maxDiffChars: 10_000, cwd: dir })).diff).toBe("");

    const all = await getContext({ all: true, maxDiffChars: 10_000, cwd: dir });
    expect(all.diff).toContain("+two");
    expect(all.diff).toContain("+new");

    run("add", "a.txt");
    const staged = await getContext({ all: false, maxDiffChars: 10_000, cwd: dir });
    expect(staged.diff).toContain("+two");
    expect(staged.diff).not.toContain("+new");
  });
});

describe("commit", () => {
  it("commits a multi-line message with quotes intact", async () => {
    writeFileSync(join(dir, "a.txt"), "hello\n");
    await stageAll(dir);
    const message = 'feat: add "greeting" file\n\n- Add a.txt with `hello`\n';
    await commit(message, dir);
    expect(run("log", "-1", "--format=%B")).toBe(message + "\n");
  });
});
