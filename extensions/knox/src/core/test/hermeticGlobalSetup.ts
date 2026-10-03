import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function snapshot(): string | null {
  try {
    const run = (args: string[]) =>
      execFileSync("git", args, { cwd: here, encoding: "utf-8" });
    return [
      run(["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"]),
      run(["worktree", "list", "--porcelain"]),
    ].join("\n--\n");
  } catch {
    return null; // not in a git checkout
  }
}

/** Fails the run if tests leaked branches or worktrees into the real repo (K-004). */
export default function setup() {
  const before = snapshot();
  return () => {
    const after = snapshot();
    if (before !== null && after !== null && before !== after) {
      throw new Error(
        "Tests are not hermetic: git branches/worktrees of the real repo changed.\n" +
          `--- before ---\n${before}\n--- after ---\n${after}`,
      );
    }
  };
}
