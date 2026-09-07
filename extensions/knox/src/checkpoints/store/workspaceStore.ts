import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * True on filesystems that treat path case as insignificant for identity
 * (macOS default, Windows). Linux stays case-sensitive.
 */
export function workspacePathsAreCaseInsensitive(platform: NodeJS.Platform = process.platform): boolean {
    return platform === 'darwin' || platform === 'win32';
}

/**
 * Stable workspace identity: strip file://, trailing separators, and
 * normalize. Case is folded on macOS/Windows so `/Foo` and `/foo` share a store.
 */
export function canonicalizeWorkspacePath(
    workspacePath: string,
    options?: { caseInsensitive?: boolean; sep?: string },
): string {
    let normalized = workspacePath.trim();
    if (normalized.startsWith('file:')) {
        try {
            normalized = fileURLToPath(normalized);
        } catch {
            normalized = normalized.replace(/^file:\/\//, '');
        }
    }
    normalized = path.normalize(normalized);
    const sep = options?.sep ?? path.sep;
    while (normalized.length > 1 && (normalized.endsWith('/') || normalized.endsWith('\\') || normalized.endsWith(sep))) {
        normalized = normalized.slice(0, -1);
    }
    const foldCase = options?.caseInsensitive ?? workspacePathsAreCaseInsensitive();
    if (foldCase) {
        normalized = normalized.toLowerCase();
    }
    return normalized;
}

/** 16-char hex key used as `workspaces/<key>/` directory name. */
export function workspaceStorageKey(workspacePath: string): string {
    return createHash('sha256').update(canonicalizeWorkspacePath(workspacePath)).digest('hex').slice(0, 16);
}

export function workspacePathsEqual(a: string | undefined, b: string | undefined): boolean {
    if (!a || !b) {
        return false;
    }
    return canonicalizeWorkspacePath(a) === canonicalizeWorkspacePath(b);
}

/**
 * Longest matching workspace root for `fsPath` (nested multi-root safe).
 */
export function findContainingWorkspaceFolder(
    folderPaths: string[],
    fsPath: string,
): string | undefined {
    const target = canonicalizeWorkspacePath(fsPath);
    let best: string | undefined;
    let bestLength = -1;
    for (const folder of folderPaths) {
        const root = canonicalizeWorkspacePath(folder);
        if (target === root || target.startsWith(root + '/') || target.startsWith(root + '\\')) {
            if (root.length > bestLength) {
                best = folder;
                bestLength = root.length;
            }
        }
    }
    return best;
}

export function resolveCheckpointStoragePathFor(
    workspacePath: string | undefined,
    options: {
        globalCheckpointsPath: string;
    },
): string {
    if (!workspacePath) {
        return options.globalCheckpointsPath;
    }
    return path.join(options.globalCheckpointsPath, 'workspaces', workspaceStorageKey(workspacePath));
}
