import * as fs from 'fs';
import * as path from 'path';

import { isIgnoredByCheckpointFilter, type IgnoreLike } from '../checkpointIgnore';
import {
    BINARY_SNAPSHOT_EXTENSIONS,
    NEVER_TRACK_EXTENSIONS,
    classificationOptionsFrom,
    shouldTrackFile,
} from './fileClassification';
import type { SkippedFile } from './types';

/** Concurrent `readdir` / snapshot operations. High enough to hide latency, low enough to avoid fd exhaustion. */
export const SCAN_CONCURRENCY = 8;

/** 0 means unlimited — prune by ignore rules, not an arbitrary depth cap. */
export const UNLIMITED_SCAN_DEPTH = 0;

export interface WorkspaceScanHost {
    currentWorkspacePath?: string;
    maxScanDepth: number;
    maxFileSize: number;
    captureBinaryFiles: boolean;
    extraTrackedExtensions: Set<string>;
    ignoreFilter: IgnoreLike | null;
    ignoreFilterFailed: boolean;
}

export interface ScannedWorkspaceFile {
    relativePath: string;
    fullPath: string;
    mtimeMs: number;
    size: number;
}

export interface WorkspaceScanStats {
    durationMs: number;
    directoriesRead: number;
    filesSeen: number;
    ignoredDirectoriesSkipped: number;
    /** Relative paths of ignored directories that were not descended into. */
    skippedIgnoredDirs: string[];
}

export interface WorkspaceScanResult {
    /** Tracked files under the size limit (reconstructable inventory). */
    files: ScannedWorkspaceFile[];
    skippedFiles: SkippedFile[];
    stats: WorkspaceScanStats;
}

export function inventoryPathsFromScan(result: WorkspaceScanResult): string[] {
    return result.files.map((file) => file.relativePath);
}

export function changedFullPathsFromScan(
    result: WorkspaceScanResult,
    changedSinceMs?: number,
): string[] {
    if (changedSinceMs === undefined) {
        return result.files.map((file) => file.fullPath);
    }
    return result.files
        .filter((file) => file.mtimeMs > changedSinceMs)
        .map((file) => file.fullPath);
}

export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    concurrency: number,
    mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    if (items.length === 0) {
        return [];
    }

    const limit = Math.max(1, concurrency);
    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            results[index] = await mapper(items[index], index);
        }
    });

    await Promise.all(workers);
    return results;
}

function posixRelative(workspacePath: string, fullPath: string): string {
    return path.relative(workspacePath, fullPath).split(path.sep).join('/');
}

export function isScanPathIgnored(
    workspacePath: string,
    fullPath: string,
    host: Pick<WorkspaceScanHost, 'ignoreFilter' | 'ignoreFilterFailed' | 'captureBinaryFiles' | 'extraTrackedExtensions'>,
    isDirectory: boolean,
): boolean {
    const relativePath = path.relative(workspacePath, fullPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return true;
    }

    if (!isDirectory) {
        const ext = path.extname(fullPath).toLowerCase().substring(1);
        if (ext) {
            if (!host.captureBinaryFiles && BINARY_SNAPSHOT_EXTENSIONS.has(ext)) {
                return true;
            }
            if (NEVER_TRACK_EXTENSIONS.has(ext) && !host.extraTrackedExtensions.has(ext)) {
                return true;
            }
        }
    }

    return isIgnoredByCheckpointFilter(
        relativePath,
        host.ignoreFilter,
        host.ignoreFilterFailed,
        isDirectory,
    );
}

/**
 * Single ignore-pruned walk used by inventory and change-scan.
 * Does not `readdir` ignored directories. Depth is unlimited unless
 * `maxScanDepth > 0` (user safety cap).
 */
export async function scanWorkspaceFiles(
    host: WorkspaceScanHost,
): Promise<WorkspaceScanResult> {
    const workspacePath = host.currentWorkspacePath;
    const files: ScannedWorkspaceFile[] = [];
    const skippedFiles: SkippedFile[] = [];
    const skippedIgnoredDirs: string[] = [];
    const visitedRealDirs = new Set<string>();
    const stats: WorkspaceScanStats = {
        durationMs: 0,
        directoriesRead: 0,
        filesSeen: 0,
        ignoredDirectoriesSkipped: 0,
        skippedIgnoredDirs,
    };

    if (!workspacePath) {
        return { files, skippedFiles, stats };
    }

    const startTime = Date.now();
    const fsPromises = fs.promises;
    const maxDepth = host.maxScanDepth > 0 ? host.maxScanDepth : Number.POSITIVE_INFINITY;
    let inFlight = 0;
    const waitQueue: Array<() => void> = [];

    const acquire = async (): Promise<void> => {
        if (inFlight >= SCAN_CONCURRENCY) {
            await new Promise<void>((resolve) => waitQueue.push(resolve));
        }
        inFlight++;
    };

    const release = (): void => {
        inFlight--;
        waitQueue.shift()?.();
    };

    const walk = async (dirPath: string, depth: number): Promise<void> => {
        if (depth >= maxDepth) {
            return;
        }

        let realDir: string;
        try {
            realDir = await fsPromises.realpath(dirPath);
        } catch {
            return;
        }
        if (visitedRealDirs.has(realDir)) {
            return;
        }
        visitedRealDirs.add(realDir);

        await acquire();
        let entries: fs.Dirent[];
        try {
            stats.directoriesRead++;
            entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
        } catch {
            return;
        } finally {
            release();
        }

        const subdirs: Array<{ fullPath: string; depth: number }> = [];

        for (const entry of entries) {
            if (entry.isSymbolicLink()) {
                continue;
            }

            const fullPath = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
                if (isScanPathIgnored(workspacePath, fullPath, host, true)) {
                    stats.ignoredDirectoriesSkipped++;
                    if (skippedIgnoredDirs.length < 32) {
                        skippedIgnoredDirs.push(posixRelative(workspacePath, fullPath));
                    }
                    continue;
                }
                subdirs.push({ fullPath, depth: depth + 1 });
                continue;
            }

            if (!entry.isFile()) {
                continue;
            }

            stats.filesSeen++;
            if (isScanPathIgnored(workspacePath, fullPath, host, false)) {
                continue;
            }
            if (!shouldTrackFile(fullPath, classificationOptionsFrom(host))) {
                continue;
            }

            const relativePath = path.relative(workspacePath, fullPath);
            try {
                const fileStats = await fsPromises.stat(fullPath);
                if (fileStats.size > host.maxFileSize) {
                    skippedFiles.push({ path: relativePath, reason: 'too_large' });
                    continue;
                }
                files.push({
                    relativePath,
                    fullPath,
                    mtimeMs: fileStats.mtimeMs,
                    size: fileStats.size,
                });
            } catch {
                skippedFiles.push({ path: relativePath, reason: 'unreadable' });
            }
        }

        if (subdirs.length > 0) {
            await Promise.all(subdirs.map((dir) => walk(dir.fullPath, dir.depth)));
        }
    };

    try {
        await walk(workspacePath, 0);
    } catch {
        // Walker already skips unreadable directories.
    }

    stats.durationMs = Date.now() - startTime;
    return { files, skippedFiles, stats };
}
