import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Run git in `cwd` and return stdout. */
export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" });
}

const created: string[] = [];

/**
 * Create a throwaway git repo (one commit) under the OS temp dir.
 * Tests that create branches or worktrees MUST use this, never the real checkout.
 */
export function makeTempRepo(
  files: Record<string, string> = { "readme.md": "hello\n" },
): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "knox-test-repo-"));
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@knox.dev"]);
  git(dir, ["config", "user.name", "Knox Test"]);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), content);
  }
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "init"]);
  created.push(dir);
  return dir;
}

/** Remove every repo made by makeTempRepo (call from afterEach/afterAll). */
export function cleanupTempRepos(): void {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}
