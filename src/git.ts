import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Hash of git's empty tree, used as the diff base in a repo with no commits yet.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export class GitError extends Error {}

export interface GitContext {
  branch: string;
  status: string;
  diff: string;
  /** Length of the full diff before truncation. */
  diffLength: number;
  truncated: boolean;
}

export interface GitContextOptions {
  /** Include unstaged and untracked changes, not just the staged ones. */
  all: boolean;
  maxDiffChars: number;
  cwd?: string;
}

async function git(args: string[], cwd?: string, input?: string): Promise<string> {
  try {
    const child = execFileAsync("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    if (input !== undefined) {
      child.child.stdin?.end(input);
    }
    const { stdout } = await child;
    return stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    if (e.code === "ENOENT") {
      throw new GitError("Git is not installed or not on your PATH.");
    }
    throw new GitError((e.stderr || e.stdout || e.message).trim());
  }
}

export async function ensureRepo(cwd?: string): Promise<void> {
  try {
    await git(["rev-parse", "--is-inside-work-tree"], cwd);
  } catch (err) {
    if (err instanceof GitError && /not installed/.test(err.message)) throw err;
    throw new GitError("This directory is not inside a Git repository.");
  }
}

async function hasCommits(cwd?: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--verify", "--quiet", "HEAD"], cwd);
    return true;
  } catch {
    return false;
  }
}

export async function currentBranch(cwd?: string): Promise<string> {
  try {
    return (await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd)).trim();
  } catch {
    // Unborn branch (no commits yet): rev-parse fails, symbolic-ref still works.
    return (await git(["symbolic-ref", "--short", "HEAD"], cwd)).trim();
  }
}

async function untrackedDiff(cwd?: string): Promise<string> {
  const files = (await git(["ls-files", "--others", "--exclude-standard", "-z"], cwd))
    .split("\0")
    .filter(Boolean);
  const parts: string[] = [];
  for (const file of files) {
    try {
      // --no-index exits with 1 when files differ, which is always the case here.
      parts.push(await git(["diff", "--no-index", "--", "/dev/null", file], cwd));
    } catch (err) {
      if (err instanceof GitError && err.message.startsWith("diff --git")) {
        parts.push(err.message + "\n");
      }
    }
  }
  return parts.join("");
}

export function truncateDiff(diff: string, maxChars: number): { diff: string; truncated: boolean } {
  if (diff.length <= maxChars) return { diff, truncated: false };
  const omitted = diff.length - maxChars;
  return {
    diff: `${diff.slice(0, maxChars)}\n\n[... diff truncated: ${omitted} more characters omitted ...]`,
    truncated: true,
  };
}

export async function getContext(opts: GitContextOptions): Promise<GitContext> {
  const { cwd } = opts;
  const [branch, status, base] = await Promise.all([
    currentBranch(cwd),
    git(["status", "--short"], cwd),
    hasCommits(cwd).then((yes) => (yes ? "HEAD" : EMPTY_TREE)),
  ]);

  let fullDiff: string;
  if (opts.all) {
    // Working tree vs last commit for tracked files, plus new untracked files.
    fullDiff = (await git(["diff", base], cwd)) + (await untrackedDiff(cwd));
  } else {
    fullDiff = await git(["diff", "--staged"], cwd);
  }

  const { diff, truncated } = truncateDiff(fullDiff, opts.maxDiffChars);
  return { branch, status: status.trimEnd(), diff, diffLength: fullDiff.length, truncated };
}

export async function stageAll(cwd?: string): Promise<void> {
  await git(["add", "--all"], cwd);
}

export async function commit(message: string, cwd?: string): Promise<string> {
  // Read the message from stdin so multi-line bodies and quotes need no escaping.
  return git(["commit", "--file", "-"], cwd, message);
}
