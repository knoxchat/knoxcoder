import * as path from 'node:path';

export type PathApi = Pick<
    typeof path,
    'resolve' | 'join' | 'normalize' | 'isAbsolute' | 'sep'
>;

export type SandboxResult =
    | { ok: true; fullPath: string }
    | { ok: false; reason: string };

export class CheckpointPathEscapeError extends Error {
    constructor(
        public readonly relativePath: string,
        message?: string,
    ) {
        super(message ?? `Checkpoint path escapes workspace: ${relativePath}`);
        this.name = 'CheckpointPathEscapeError';
    }
}

function isAbsoluteOnAnyPlatform(relativePath: string): boolean {
    return (
        path.posix.isAbsolute(relativePath) ||
        path.win32.isAbsolute(relativePath)
    );
}

function splitSegments(normalized: string): string[] {
    return normalized.split(/[\\/]/).filter((segment) => segment.length > 0);
}

function startsWithPathPrefix(fullPath: string, workspaceRoot: string, sep: string): boolean {
    const root = workspaceRoot.endsWith(sep) ? workspaceRoot : workspaceRoot + sep;
    if (fullPath === workspaceRoot || fullPath.startsWith(root)) {
        return true;
    }
    // Windows: compare case-insensitively (NTFS / APFS-via-win32 tests)
    if (sep === '\\') {
        const fullLower = fullPath.toLowerCase();
        const workspaceLower = workspaceRoot.toLowerCase();
        const rootLower = workspaceLower.endsWith('\\')
            ? workspaceLower
            : workspaceLower + '\\';
        return fullLower === workspaceLower || fullLower.startsWith(rootLower);
    }
    return false;
}

/**
 * Resolve `relativePath` under `workspaceRoot`, rejecting traversal, NUL,
 * absolute paths, and Windows drive/UNC paths. `pathApi` is injectable so
 * posix and win32 can be unit-tested on any host.
 */
export function tryResolveSandboxedWorkspacePath(
    workspaceRoot: string,
    relativePath: string,
    pathApi: PathApi = path,
): SandboxResult {
    if (typeof relativePath !== 'string' || relativePath.length === 0) {
        return { ok: false, reason: 'empty path' };
    }
    if (relativePath.includes('\0')) {
        return { ok: false, reason: 'NUL byte in path' };
    }
    if (isAbsoluteOnAnyPlatform(relativePath)) {
        return { ok: false, reason: 'absolute path' };
    }
    // UNC / drive-relative forms that some path.isAbsolute implementations miss
    if (/^[a-zA-Z]:[\\/]/.test(relativePath) || relativePath.startsWith('\\\\')) {
        return { ok: false, reason: 'absolute path' };
    }

    const normalized = pathApi.normalize(relativePath);
    if (normalized.includes('\0')) {
        return { ok: false, reason: 'NUL byte in path' };
    }
    if (isAbsoluteOnAnyPlatform(normalized)) {
        return { ok: false, reason: 'absolute path' };
    }

    const segments = splitSegments(normalized);
    if (segments.includes('..')) {
        return { ok: false, reason: 'path traversal' };
    }

    const workspaceResolved = pathApi.resolve(workspaceRoot);
    const fullPath = pathApi.resolve(workspaceResolved, normalized);

    if (!startsWithPathPrefix(fullPath, workspaceResolved, pathApi.sep)) {
        return { ok: false, reason: 'path escapes workspace' };
    }

    return { ok: true, fullPath };
}

export function resolveSandboxedWorkspacePath(
    workspaceRoot: string,
    relativePath: string,
    pathApi: PathApi = path,
): string {
    const result = tryResolveSandboxedWorkspacePath(workspaceRoot, relativePath, pathApi);
    if (!result.ok) {
        throw new CheckpointPathEscapeError(relativePath, result.reason);
    }
    return result.fullPath;
}

export function isUnsafeCheckpointRelativePath(
    relativePath: string,
    pathApi: PathApi = path,
    workspaceRoot: string = pathApi.sep === '\\' ? 'C:\\workspace' : '/workspace',
): boolean {
    return !tryResolveSandboxedWorkspacePath(workspaceRoot, relativePath, pathApi).ok;
}
