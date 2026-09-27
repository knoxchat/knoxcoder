/**
 * Default ignore patterns for workspace checkpoints.
 * Secrets are ignored unless the user un-ignores them in `.knoxignore`
 * (gitignore negation, e.g. `!.env`).
 */

export const SECRET_IGNORE_PATTERNS: string[] = [
    '.env',
    '.env.*',
    '*.pem',
    '*.key',
    'id_rsa',
    'id_ed25519',
    'credentials.json',
    '*.p12',
    '*.pfx',
    '.npmrc',
    '.pypirc',
    'secrets.*',
    '*.keystore',
];

export const DEFAULT_CHECKPOINT_IGNORE_PATTERNS: string[] = [
    'node_modules/',
    '.git/',
    'dist/',
    'build/',
    'out/',
    '.knox/',
    '.knox-debug/',
    '__pycache__/',
    '.pytest_cache/',
    '.vscode/',
    '.idea/',
    'target/',
    'coverage/',
    '*.log',
    '*.tmp',
    '*.swp',
    '*.bak',
    '.DS_Store',
    'package-lock.json',
    'yarn.lock',
    'Cargo.lock',
    ...SECRET_IGNORE_PATTERNS,
];

export interface IgnoreLike {
    ignores(relativePath: string): boolean;
}

/**
 * Normalize a workspace-relative path for the `ignore` library.
 * Directory patterns like `node_modules/` only match when the path has a
 * trailing slash, so callers must mark directories.
 */
export function toIgnorePath(relativePath: string, isDirectory = false): string {
    const normalized = relativePath.replace(/\\/g, '/');
    if (isDirectory && normalized.length > 0 && !normalized.endsWith('/')) {
        return `${normalized}/`;
    }
    return normalized;
}

/**
 * Fail closed: if the ignore filter is missing or failed to initialize,
 * treat the path as ignored so secrets are never snapshotted by accident.
 */
export function isIgnoredByCheckpointFilter(
    relativePath: string,
    filter: IgnoreLike | null | undefined,
    filterFailed: boolean,
    isDirectory = false,
): boolean {
    if (filterFailed || !filter) {
        return true;
    }
    return filter.ignores(toIgnorePath(relativePath, isDirectory));
}
