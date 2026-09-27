import * as path from 'path';

export interface CaptureFilter {
    includeFiles?: string[];
    excludeFiles?: string[];
}

export function toPosixRelative(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Turn an include/exclude pattern (relative or absolute) into a workspace-relative
 * posix path. Patterns that escape the workspace return a `..` prefix.
 */
export function normalizeCapturePath(workspacePath: string, filePath: string): string {
    const trimmed = filePath.trim();
    if (!trimmed) {
        return '';
    }

    const looksAbsolute = path.isAbsolute(trimmed) || /^[A-Za-z]:[\\/]/.test(trimmed);
    if (looksAbsolute) {
        return toPosixRelative(path.relative(workspacePath, trimmed));
    }

    return toPosixRelative(trimmed).replace(/\/+$/, '');
}

export function pathMatchesPattern(
    workspacePath: string,
    relativePath: string,
    pattern: string,
): boolean {
    const rel = toPosixRelative(relativePath);
    const pat = normalizeCapturePath(workspacePath, pattern);
    if (!rel || !pat || pat === '.' || pat.startsWith('../') || pat === '..') {
        return false;
    }
    if (rel === pat) {
        return true;
    }
    const prefix = pat.endsWith('/') ? pat : `${pat}/`;
    return rel.startsWith(prefix);
}

export function pathMatchesAny(
    workspacePath: string,
    relativePath: string,
    patterns: string[],
): boolean {
    return patterns.some((pattern) => pathMatchesPattern(workspacePath, relativePath, pattern));
}

export function isExactIncludePath(
    workspacePath: string,
    relativePath: string,
    includeFiles: string[] | undefined,
): boolean {
    if (!includeFiles?.length) {
        return false;
    }
    const rel = toPosixRelative(relativePath);
    return includeFiles.some((pattern) => normalizeCapturePath(workspacePath, pattern) === rel);
}

export function shouldCaptureRelativePath(
    workspacePath: string,
    relativePath: string,
    filter?: CaptureFilter,
): boolean {
    if (!filter) {
        return true;
    }
    if (filter.includeFiles?.length && !pathMatchesAny(workspacePath, relativePath, filter.includeFiles)) {
        return false;
    }
    if (filter.excludeFiles?.length && pathMatchesAny(workspacePath, relativePath, filter.excludeFiles)) {
        return false;
    }
    return true;
}

export function captureFilterIsActive(filter?: CaptureFilter): boolean {
    return Boolean(filter?.includeFiles?.length || filter?.excludeFiles?.length);
}

/**
 * Empty file lists mean "the whole workspace" and overlap everything.
 * Directory prefixes overlap their children.
 */
export function fileSetsOverlap(
    workspacePath: string | undefined,
    left: string[],
    right: string[],
): boolean {
    if (left.length === 0 || right.length === 0) {
        return true;
    }
    const workspace = workspacePath ?? '';
    for (const a of left) {
        for (const b of right) {
            if (
                pathMatchesPattern(workspace, a, b)
                || pathMatchesPattern(workspace, b, a)
            ) {
                return true;
            }
        }
    }
    return false;
}

