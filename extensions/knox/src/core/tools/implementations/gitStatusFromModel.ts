/**
 * Format vscode.git `Repository.state` as `git status --porcelain=v1 -b`.
 * Numbers match `Status` in extensions/git `git.d.ts`.
 */

export const GitModelStatus = {
  INDEX_MODIFIED: 0,
  INDEX_ADDED: 1,
  INDEX_DELETED: 2,
  INDEX_RENAMED: 3,
  INDEX_COPIED: 4,
  MODIFIED: 5,
  DELETED: 6,
  UNTRACKED: 7,
  IGNORED: 8,
  INTENT_TO_ADD: 9,
  INTENT_TO_RENAME: 10,
  TYPE_CHANGED: 11,
} as const;

export type GitModelChange = {
  path: string;
  status: number;
};

export type GitModelSnapshot = {
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  indexChanges: GitModelChange[];
  workingTreeChanges: GitModelChange[];
  mergeChanges?: GitModelChange[];
};

function indexChar(status: number): string {
  switch (status) {
    case GitModelStatus.INDEX_MODIFIED:
    case GitModelStatus.TYPE_CHANGED:
      return "M";
    case GitModelStatus.INDEX_ADDED:
    case GitModelStatus.INTENT_TO_ADD:
      return "A";
    case GitModelStatus.INDEX_DELETED:
      return "D";
    case GitModelStatus.INDEX_RENAMED:
    case GitModelStatus.INTENT_TO_RENAME:
      return "R";
    case GitModelStatus.INDEX_COPIED:
      return "C";
    default:
      return " ";
  }
}

function worktreeChar(status: number): string | "untracked" | "ignored" {
  switch (status) {
    case GitModelStatus.MODIFIED:
    case GitModelStatus.TYPE_CHANGED:
      return "M";
    case GitModelStatus.DELETED:
      return "D";
    case GitModelStatus.UNTRACKED:
      return "untracked";
    case GitModelStatus.IGNORED:
      return "ignored";
    default:
      return " ";
  }
}

function formatBranchLine(snapshot: GitModelSnapshot): string {
  if (!snapshot.branch) {
    return "## HEAD (no branch)";
  }
  let line = `## ${snapshot.branch}`;
  if (snapshot.upstream) {
    line += `...${snapshot.upstream}`;
    const bits: string[] = [];
    if (snapshot.ahead && snapshot.ahead > 0) {
      bits.push(`ahead ${snapshot.ahead}`);
    }
    if (snapshot.behind && snapshot.behind > 0) {
      bits.push(`behind ${snapshot.behind}`);
    }
    if (bits.length) {
      line += ` [${bits.join(", ")}]`;
    }
  }
  return line;
}

/**
 * Porcelain-v1 `-b` text from the Git extension model (no `git` spawn).
 */
export function formatGitStatusPorcelain(snapshot: GitModelSnapshot): string {
  const xy = new Map<string, [string, string]>();

  const ensure = (filePath: string): [string, string] => {
    const existing = xy.get(filePath);
    if (existing) {
      return existing;
    }
    const pair: [string, string] = [" ", " "];
    xy.set(filePath, pair);
    return pair;
  };

  for (const change of snapshot.indexChanges) {
    const pair = ensure(change.path);
    pair[0] = indexChar(change.status);
  }
  for (const change of snapshot.workingTreeChanges) {
    const wt = worktreeChar(change.status);
    if (wt === "untracked") {
      xy.set(change.path, ["?", "?"]);
      continue;
    }
    if (wt === "ignored") {
      xy.set(change.path, ["!", "!"]);
      continue;
    }
    const pair = ensure(change.path);
    pair[1] = wt;
  }
  for (const change of snapshot.mergeChanges ?? []) {
    const pair = ensure(change.path);
    if (pair[0] === " ") {
      pair[0] = "U";
    }
    if (pair[1] === " ") {
      pair[1] = "U";
    }
  }

  const lines = [formatBranchLine(snapshot)];
  const paths = [...xy.keys()].sort();
  for (const filePath of paths) {
    const [x, y] = xy.get(filePath)!;
    lines.push(`${x}${y} ${filePath}`);
  }
  return lines.join("\n");
}
