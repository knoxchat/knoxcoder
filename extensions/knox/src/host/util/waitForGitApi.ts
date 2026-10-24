/**
 * vscode.git reports `state: "initialized"` only after the first repository
 * scan. Callers should wait for that instead of polling `getRepository`.
 */

export type GitApiState = "uninitialized" | "initialized";

export type GitApiStateSource = {
  readonly state: GitApiState;
  readonly onDidChangeState: (
    listener: (state: GitApiState) => unknown,
  ) => { dispose(): void };
};

export function gitApiInitTimeoutMs(): number {
  return process.env.NODE_ENV === "test" ? 1_000 : 20_000;
}

/** Resolves when git is initialized, or when `timeoutMs` elapses. */
export function waitForGitApiInitialized(
  git: GitApiStateSource,
  timeoutMs: number = gitApiInitTimeoutMs(),
): Promise<void> {
  if (git.state === "initialized") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    let disposable: { dispose(): void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      disposable?.dispose();
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      resolve();
    };

    disposable = git.onDidChangeState((state) => {
      if (state === "initialized") {
        finish();
      }
    });
    timer = setTimeout(finish, timeoutMs);

    if (git.state === "initialized") {
      finish();
    }
  });
}
