import { describe, expect, it } from "vitest";

import {
  waitForGitApiInitialized,
  type GitApiState,
  type GitApiStateSource,
} from "./waitForGitApi";

function mockGit(initial: GitApiState): GitApiStateSource & {
  setState: (state: GitApiState) => void;
} {
  let state = initial;
  const listeners = new Set<(next: GitApiState) => unknown>();
  return {
    get state() {
      return state;
    },
    onDidChangeState(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    setState(next) {
      state = next;
      for (const listener of listeners) {
        listener(next);
      }
    },
  };
}

describe("waitForGitApiInitialized", () => {
  it("returns immediately when git is already initialized", async () => {
    const git = mockGit("initialized");
    const started = Date.now();
    await waitForGitApiInitialized(git, 5_000);
    expect(Date.now() - started).toBeLessThan(50);
  });

  it("resolves when git becomes initialized", async () => {
    const git = mockGit("uninitialized");
    const pending = waitForGitApiInitialized(git, 5_000);
    git.setState("initialized");
    await pending;
  });

  it("resolves on timeout if git never initializes", async () => {
    const git = mockGit("uninitialized");
    const started = Date.now();
    await waitForGitApiInitialized(git, 20);
    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
  });
});
