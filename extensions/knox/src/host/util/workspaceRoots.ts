import { findContainingWorkspaceFolder } from "../checkpoints/store/workspaceStore";

export interface RootFolder {
  fsPath: string;
}

/**
 * Multi-root workspaces: Knox tools treat `getWorkspaceDirs()[0]` as the
 * primary root (cwd for shell, git, build, relative paths). Put the folder that
 * contains the active editor file first so the agent works on the project the
 * user is looking at; the remaining folders keep their original order and stay
 * reachable for path resolution, search and the path-boundary policy.
 * With no active file inside any folder the order is unchanged.
 */
export function orderFoldersActiveFirst<T extends RootFolder>(
  folders: readonly T[],
  activeFsPath: string | undefined,
): T[] {
  if (folders.length < 2 || !activeFsPath) {
    return [...folders];
  }
  const owner = findContainingWorkspaceFolder(
    folders.map((f) => f.fsPath),
    activeFsPath,
  );
  if (!owner) {
    return [...folders];
  }
  const primary = folders.find((f) => f.fsPath === owner);
  if (!primary) {
    return [...folders];
  }
  return [primary, ...folders.filter((f) => f !== primary)];
}
