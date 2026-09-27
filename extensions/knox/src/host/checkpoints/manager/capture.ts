import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import * as vscode from 'vscode';

import { getGlobalKnoxIgnorePath } from 'core/util/paths';
import { createKnoxLogger } from 'core/util/knoxLog';

import { hashBlobBytes, putBlob } from '../store/blobStore';
import { writeBlobOptions } from './blobCrypto';
import {
    classificationOptionsFrom,
    classifyFileBuffer,
    shouldTrackFile,
} from './fileClassification';
import type { CheckpointEngineHost } from './host';
import {
    captureFilterIsActive,
    isExactIncludePath,
    normalizeCapturePath,
    shouldCaptureRelativePath,
    type CaptureFilter,
} from './pathFilter';
import type { CaptureMode, CaptureResult, FileSnapshot, SkippedFile } from './types';
import { getLastCheckpointTime, resolveWorkspaceRelativePath, workspaceHasBaseline } from './workspace';
import {
    SCAN_CONCURRENCY,
    changedFullPathsFromScan,
    inventoryPathsFromScan,
    isScanPathIgnored,
    mapWithConcurrency,
    scanWorkspaceFiles,
    type WorkspaceScanResult,
} from './workspaceScan';

const log = createKnoxLogger('Checkpoints');

export function hashContent(content: string): string {
    return crypto.createHash('sha1').update(content).digest('hex');
}

function snapshotContentHash(snapshot: FileSnapshot): string | undefined {
    if (snapshot.hash) {
        return snapshot.hash;
    }
    if (typeof snapshot.content === 'string') {
        return hashContent(snapshot.content);
    }
    return undefined;
}

export function rebuildSnapshotHashIndex(host: CheckpointEngineHost): void {
    host.lastSnapshotHashes.clear();

    const chronological = [...host.checkpointHistory].sort(
        (a, b) => a.created.getTime() - b.created.getTime(),
    );

    for (const checkpoint of chronological) {
        for (const snapshot of checkpoint.fileSnapshots || []) {
            if (snapshot.deleted || snapshot.changeType === 'deleted') {
                host.lastSnapshotHashes.delete(snapshot.relativePath);
            } else {
                const digest = snapshotContentHash(snapshot);
                if (digest) {
                    host.lastSnapshotHashes.set(snapshot.relativePath, digest);
                }
            }
        }
    }

    log.debug(`🔎 Rebuilt snapshot hash index for ${host.lastSnapshotHashes.size} files`);
}

export function applySnapshotHashes(host: CheckpointEngineHost, fileSnapshots: FileSnapshot[]): void {
    for (const snapshot of fileSnapshots) {
        if (snapshot.deleted || snapshot.changeType === 'deleted') {
            host.lastSnapshotHashes.delete(snapshot.relativePath);
        } else {
            const digest = snapshotContentHash(snapshot);
            if (digest) {
                host.lastSnapshotHashes.set(snapshot.relativePath, digest);
            }
        }
    }
}

export function updatePerformanceMetrics(
    host: CheckpointEngineHost,
    duration: number,
    filesScanned: number,
): void {
    host.performanceMetrics.lastScanDuration = duration;
    host.performanceMetrics.totalScans++;
    host.performanceMetrics.filesScanned += filesScanned;
    host.performanceMetrics.lastScanTimestamp = Date.now();
    host.performanceMetrics.averageScanDuration =
        (host.performanceMetrics.averageScanDuration * (host.performanceMetrics.totalScans - 1) + duration) /
        host.performanceMetrics.totalScans;
}

export async function initializeIgnoreFilter(host: CheckpointEngineHost): Promise<void> {
    if (!host.currentWorkspacePath) {
        return;
    }

    try {
        const ignore = require('ignore');
        const filter = ignore();
        filter.add(host.customIgnorePatterns);

        const gitignorePath = path.join(host.currentWorkspacePath, '.gitignore');
        if (fs.existsSync(gitignorePath)) {
            filter.add(fs.readFileSync(gitignorePath, 'utf8'));
            log.info('✅ Loaded .gitignore patterns for checkpoint filtering (optional)');
        }

        const knoxignorePath = path.join(host.currentWorkspacePath, '.knoxignore');
        if (fs.existsSync(knoxignorePath)) {
            filter.add(fs.readFileSync(knoxignorePath, 'utf8'));
            log.info('✅ Loaded .knoxignore patterns for checkpoint filtering');
        }

        const globalKnoxignorePath = getGlobalKnoxIgnorePath();
        if (fs.existsSync(globalKnoxignorePath)) {
            filter.add(fs.readFileSync(globalKnoxignorePath, 'utf8'));
            log.info('✅ Loaded global ~/.knox/.knoxignore patterns for checkpoint filtering');
        }

        host.ignoreFilter = filter;
        host.ignoreFilterFailed = false;
    } catch (error) {
        log.warn('Failed to initialize ignore filter:', error);
        host.ignoreFilter = null;
        host.ignoreFilterFailed = true;
    }
}

export async function isFileIgnored(
    host: CheckpointEngineHost,
    filePath: string,
    isDirectory = false,
): Promise<boolean> {
    if (!host.currentWorkspacePath) {
        return true;
    }

    if (!host.ignoreFilter && !host.ignoreFilterFailed) {
        await initializeIgnoreFilter(host);
    }

    return isScanPathIgnored(host.currentWorkspacePath, filePath, host, isDirectory);
}

export function isWatcherIndexTrusted(host: CheckpointEngineHost): boolean {
    return host.watcherTrusted
        && host.fileWatchers.length > 0
        && host.lastSnapshotHashes.size > 0;
}

export function markFullScanComplete(host: CheckpointEngineHost): void {
    host.lastFullScanAt = Date.now();
    if (host.fileWatchers.length > 0) {
        host.watcherTrusted = true;
    }
}

export function invalidateWatcherIndex(host: CheckpointEngineHost): void {
    host.watcherTrusted = false;
}

function inventoryFromHashIndex(host: CheckpointEngineHost, fileSnapshots: FileSnapshot[]): string[] {
    const paths = new Set(host.lastSnapshotHashes.keys());
    for (const snapshot of fileSnapshots) {
        if (snapshot.deleted || snapshot.changeType === 'deleted') {
            paths.delete(snapshot.relativePath);
        } else {
            paths.add(snapshot.relativePath);
        }
    }
    return Array.from(paths);
}

function recordScanMetrics(host: CheckpointEngineHost, scan: WorkspaceScanResult): void {
    updatePerformanceMetrics(host, scan.stats.durationMs, scan.stats.filesSeen);
}

async function ensureIgnoreFilter(host: CheckpointEngineHost): Promise<void> {
    if (!host.ignoreFilter && !host.ignoreFilterFailed) {
        await initializeIgnoreFilter(host);
    }
}

export async function trySnapshotFile(
    host: CheckpointEngineHost,
    fullPath: string,
    relativePath: string,
    options: { skipUnchanged: boolean },
): Promise<{ snapshot?: FileSnapshot; skipped?: SkippedFile }> {
    const fsPromises = fs.promises;
    try {
        const stats = await fsPromises.stat(fullPath);
        if (stats.size > host.maxFileSize) {
            log.debug(`Skipping large file: ${relativePath} (${stats.size} bytes, limit: ${host.maxFileSize})`);
            return { skipped: { path: relativePath, reason: 'too_large' } };
        }
        if (!shouldTrackFile(fullPath, classificationOptionsFrom(host))) {
            return {};
        }
        const buffer = await fsPromises.readFile(fullPath);
        const classified = classifyFileBuffer(fullPath, buffer, classificationOptionsFrom(host));
        if (!classified) {
            return { skipped: { path: relativePath, reason: 'binary_disabled' } };
        }
        const contentHash = hashBlobBytes(buffer);
        if (options.skipUnchanged && host.lastSnapshotHashes.get(relativePath) === contentHash) {
            return {};
        }
        await putBlob(host.getStoragePath(), buffer, await writeBlobOptions(host));
        const changeType = host.lastSnapshotHashes.has(relativePath) ? 'modified' : 'created';
        return {
            snapshot: {
                relativePath,
                content: classified.content,
                hash: contentHash,
                encoding: classified.encoding,
                lastModified: stats.mtime,
                size: stats.size,
                changeType,
            },
        };
    } catch (error) {
        log.debug(`Skipping file ${relativePath}:`, error instanceof Error ? error.message : String(error));
        return { skipped: { path: relativePath, reason: 'unreadable' } };
    }
}

export async function scanTrackedWorkspace(host: CheckpointEngineHost): Promise<WorkspaceScanResult> {
    await ensureIgnoreFilter(host);
    const scan = await scanWorkspaceFiles(host);
    recordScanMetrics(host, scan);
    log.debug(
        `🔍 Workspace scan: ${scan.files.length} tracked files, ` +
        `${scan.stats.directoriesRead} dirs, ${scan.stats.ignoredDirectoriesSkipped} ignored dirs skipped, ` +
        `${scan.stats.durationMs}ms`,
    );
    return scan;
}

export async function captureCompleteFileInventory(host: CheckpointEngineHost): Promise<string[]> {
    if (!host.currentWorkspacePath) {
        return [];
    }

    try {
        const scan = await scanTrackedWorkspace(host);
        const inventory = inventoryPathsFromScan(scan);
        log.info(`📋 Captured complete file inventory: ${inventory.length} files`);
        return inventory;
    } catch (error) {
        log.error('Failed to capture file inventory:', error);
        return [];
    }
}

function applyCaptureFilterToSnapshots(
    workspacePath: string,
    fileSnapshots: FileSnapshot[],
    skippedFiles: SkippedFile[],
    filter?: CaptureFilter,
): { fileSnapshots: FileSnapshot[]; skippedFiles: SkippedFile[] } {
    if (!captureFilterIsActive(filter)) {
        return { fileSnapshots, skippedFiles };
    }
    return {
        fileSnapshots: fileSnapshots.filter((snapshot) =>
            shouldCaptureRelativePath(workspacePath, snapshot.relativePath, filter),
        ),
        skippedFiles: skippedFiles.filter((skipped) =>
            shouldCaptureRelativePath(workspacePath, skipped.path, filter),
        ),
    };
}

export async function captureFilteredFiles(
    host: CheckpointEngineHost,
    filter: CaptureFilter,
): Promise<CaptureResult> {
    if (!host.currentWorkspacePath) {
        return { fileSnapshots: [], skippedFiles: [], captureMode: 'delta', fileInventory: [] };
    }

    const workspacePath = host.currentWorkspacePath;
    const scan = await scanTrackedWorkspace(host);
    const inventory = inventoryPathsFromScan(scan);
    const skippedFiles: SkippedFile[] = [...scan.skippedFiles];
    const targets = new Map<string, string>();

    for (const file of scan.files) {
        if (shouldCaptureRelativePath(workspacePath, file.relativePath, filter)) {
            targets.set(file.relativePath, file.fullPath);
        }
    }

    for (const pattern of filter.includeFiles ?? []) {
        const relativePath = normalizeCapturePath(workspacePath, pattern);
        if (!relativePath || relativePath.startsWith('../') || relativePath === '..' || targets.has(relativePath)) {
            continue;
        }
        const resolved = resolveWorkspaceRelativePath(host, relativePath);
        if (!resolved.ok) {
            skippedFiles.push({ path: relativePath, reason: 'unsafe_path' });
            continue;
        }
        try {
            const stats = await fs.promises.stat(resolved.fullPath);
            if (stats.isFile()) {
                targets.set(relativePath, resolved.fullPath);
            }
        } catch {
            // Missing include path: a delete is recorded below if it was previously hashed.
        }
    }

    log.info(`📸 Capturing ${targets.size} filtered files for checkpoint...`);

    const snapshotResults = await mapWithConcurrency(
        Array.from(targets.entries()),
        SCAN_CONCURRENCY,
        async ([relativePath, fullPath]) => {
            const exactInclude = isExactIncludePath(workspacePath, relativePath, filter.includeFiles);
            if (!exactInclude && await isFileIgnored(host, fullPath)) {
                return {};
            }
            return trySnapshotFile(host, fullPath, relativePath, { skipUnchanged: false });
        },
    );

    const fileSnapshots: FileSnapshot[] = [];
    for (const result of snapshotResults) {
        if (result.snapshot) {
            fileSnapshots.push(result.snapshot);
        }
        if (result.skipped) {
            skippedFiles.push(result.skipped);
        }
    }

    for (const relativePath of host.lastSnapshotHashes.keys()) {
        if (!shouldCaptureRelativePath(workspacePath, relativePath, filter)) {
            continue;
        }
        if (targets.has(relativePath)) {
            continue;
        }
        const resolved = resolveWorkspaceRelativePath(host, relativePath);
        if (!resolved.ok) {
            continue;
        }
        fileSnapshots.push({
            relativePath,
            encoding: 'utf8',
            lastModified: new Date(),
            size: 0,
            deleted: true,
            changeType: 'deleted',
        });
    }

    const filtered = applyCaptureFilterToSnapshots(workspacePath, fileSnapshots, skippedFiles, filter);
    host.recentlyDeletedFiles.clear();
    host.recentlyModifiedFiles.clear();
    host.previousCheckpointFiles = new Set(
        filtered.fileSnapshots.filter((snapshot) => !snapshot.deleted).map((snapshot) => snapshot.relativePath),
    );
    log.info(`✅ Captured ${filtered.fileSnapshots.length} filtered files for checkpoint`);
    return {
        fileSnapshots: filtered.fileSnapshots,
        skippedFiles: filtered.skippedFiles,
        captureMode: 'delta',
        fileInventory: inventory,
    };
}

export async function captureBaselineFiles(
    host: CheckpointEngineHost,
    filter?: CaptureFilter,
): Promise<CaptureResult> {
    if (!host.currentWorkspacePath) {
        return { fileSnapshots: [], skippedFiles: [], captureMode: 'baseline', fileInventory: [] };
    }

    if (filter?.includeFiles?.length) {
        return captureFilteredFiles(host, filter);
    }

    const scan = await scanTrackedWorkspace(host);
    const inventory = inventoryPathsFromScan(scan);
    const inventorySet = new Set(inventory);
    const skippedFiles: SkippedFile[] = [...scan.skippedFiles];

    log.info(`📸 Capturing baseline of ${inventory.length} tracked files...`);

    const snapshotResults = await mapWithConcurrency(scan.files, SCAN_CONCURRENCY, async (file) => {
        const resolved = resolveWorkspaceRelativePath(host, file.relativePath);
        if (!resolved.ok) {
            return { skipped: { path: file.relativePath, reason: 'unsafe_path' as const } };
        }
        if (!shouldCaptureRelativePath(host.currentWorkspacePath!, file.relativePath, filter)) {
            return {};
        }
        return trySnapshotFile(host, resolved.fullPath, file.relativePath, {
            skipUnchanged: false,
        });
    });

    const fileSnapshots: FileSnapshot[] = [];
    for (const result of snapshotResults) {
        if (result.snapshot) {
            fileSnapshots.push(result.snapshot);
        }
        if (result.skipped) {
            skippedFiles.push(result.skipped);
        }
    }

    for (const relativePath of host.lastSnapshotHashes.keys()) {
        if (inventorySet.has(relativePath)) {
            continue;
        }
        if (!shouldCaptureRelativePath(host.currentWorkspacePath, relativePath, filter)) {
            continue;
        }
        const resolved = resolveWorkspaceRelativePath(host, relativePath);
        if (!resolved.ok) {
            continue;
        }
        fileSnapshots.push({
            relativePath,
            encoding: 'utf8',
            lastModified: new Date(),
            size: 0,
            deleted: true,
            changeType: 'deleted',
        });
    }

    host.recentlyDeletedFiles.clear();
    host.recentlyModifiedFiles.clear();
    const filtered = applyCaptureFilterToSnapshots(
        host.currentWorkspacePath,
        fileSnapshots,
        skippedFiles,
        filter,
    );
    host.previousCheckpointFiles = new Set(
        filtered.fileSnapshots.filter((snapshot) => !snapshot.deleted).map((snapshot) => snapshot.relativePath),
    );
    markFullScanComplete(host);

    log.info(`✅ Captured baseline of ${filtered.fileSnapshots.length} files (${filtered.skippedFiles.length} skipped)`);
    return {
        fileSnapshots: filtered.fileSnapshots,
        skippedFiles: filtered.skippedFiles,
        captureMode: 'baseline',
        fileInventory: inventory,
    };
}

export async function getChangedFilesFromFileSystem(host: CheckpointEngineHost): Promise<string[]> {
    if (!host.currentWorkspacePath) {
        return [];
    }

    try {
        const scan = await scanTrackedWorkspace(host);
        markFullScanComplete(host);
        const changedFiles = changedFullPathsFromScan(scan, getLastCheckpointTime(host));
        log.debug(
            `🔍 Found ${changedFiles.length} changed files from file system ` +
            `(scanned ${scan.stats.filesSeen} files in ${scan.stats.directoriesRead} directories, ` +
            `took ${scan.stats.durationMs}ms)`,
        );
        return changedFiles;
    } catch (error) {
        log.debug('File system scan failed:', error instanceof Error ? error.message : String(error));
        return [];
    }
}

export async function getRecentlyModifiedFiles(host: CheckpointEngineHost): Promise<string[]> {
    if (!host.currentWorkspacePath) {
        return [];
    }

    try {
        const modifiedFiles: string[] = [];

        for (const filePath of Array.from(host.recentlyModifiedFiles)) {
            if (filePath.startsWith(host.currentWorkspacePath)) {
                modifiedFiles.push(filePath);
            }
        }

        for (const document of vscode.workspace.textDocuments) {
            if (document.uri.scheme === 'file' &&
                document.uri.fsPath.startsWith(host.currentWorkspacePath) &&
                document.isDirty) {
                if (!modifiedFiles.includes(document.uri.fsPath)) {
                    modifiedFiles.push(document.uri.fsPath);
                }
            }
        }

        log.debug(`🔍 Found ${modifiedFiles.length} modified files (${host.recentlyModifiedFiles.size} from watcher, ${vscode.workspace.textDocuments.filter(d => d.isDirty).length} dirty)`);
        return modifiedFiles;
    } catch (error) {
        log.error('Failed to get recently modified files:', error);
        return [];
    }
}

export async function captureChangedFiles(
    host: CheckpointEngineHost,
    filter?: CaptureFilter,
): Promise<CaptureResult> {
    if (!host.currentWorkspacePath) {
        return { fileSnapshots: [], skippedFiles: [], captureMode: 'delta', fileInventory: [] };
    }

    if (filter?.includeFiles?.length) {
        return captureFilteredFiles(host, filter);
    }

    const fileSnapshots: FileSnapshot[] = [];
    const skippedFiles: SkippedFile[] = [];
    const workspacePath = host.currentWorkspacePath;

    try {
        const useWatcherIndex = isWatcherIndexTrusted(host);
        let filesToCheck: string[];
        let fileInventory: string[] | undefined;
        let scanSkipped: SkippedFile[] = [];

        if (useWatcherIndex) {
            filesToCheck = await getRecentlyModifiedFiles(host);
            log.info(`📸 Capturing ${filesToCheck.length} watcher-indexed files for checkpoint...`);
        } else {
            const scan = await scanTrackedWorkspace(host);
            markFullScanComplete(host);
            filesToCheck = changedFullPathsFromScan(scan, getLastCheckpointTime(host));
            if (filesToCheck.length === 0) {
                filesToCheck = await getRecentlyModifiedFiles(host);
            }
            fileInventory = inventoryPathsFromScan(scan);
            scanSkipped = scan.skippedFiles;
            log.info(`📸 Capturing ${filesToCheck.length} changed files for checkpoint...`);
        }

        skippedFiles.push(...scanSkipped);

        const snapshotResults = await mapWithConcurrency(filesToCheck, SCAN_CONCURRENCY, async (filePath) => {
            const fullPath = path.isAbsolute(filePath)
                ? filePath
                : path.join(host.currentWorkspacePath!, filePath);
            const relativePath = path.relative(host.currentWorkspacePath!, fullPath);
            const resolved = resolveWorkspaceRelativePath(host, relativePath);
            if (!resolved.ok) {
                return { skipped: { path: relativePath, reason: 'unsafe_path' as const } };
            }
            if (!shouldCaptureRelativePath(workspacePath, relativePath, filter)) {
                return {};
            }
            if (await isFileIgnored(host, resolved.fullPath)) {
                return {};
            }
            return trySnapshotFile(host, resolved.fullPath, relativePath, {
                skipUnchanged: true,
            });
        });

        for (const result of snapshotResults) {
            if (result.snapshot) {
                fileSnapshots.push(result.snapshot);
            }
            if (result.skipped) {
                skippedFiles.push(result.skipped);
            }
        }

        for (const fullPath of Array.from(host.recentlyDeletedFiles)) {
            const relativePath = path.relative(host.currentWorkspacePath, fullPath);
            const resolved = resolveWorkspaceRelativePath(host, relativePath);
            if (!resolved.ok) {
                continue;
            }

            if (!shouldCaptureRelativePath(workspacePath, relativePath, filter)) {
                continue;
            }

            if (host.lastSnapshotHashes.has(relativePath) || host.previousCheckpointFiles.has(relativePath)) {
                fileSnapshots.push({
                    relativePath,
                    encoding: 'utf8',
                    lastModified: new Date(),
                    size: 0,
                    deleted: true,
                    changeType: 'deleted',
                });
                log.debug(`📝 Tracked deletion: ${relativePath}`);
            }
        }

        host.recentlyDeletedFiles.clear();
        host.recentlyModifiedFiles.clear();
        const filtered = applyCaptureFilterToSnapshots(workspacePath, fileSnapshots, skippedFiles, filter);
        host.previousCheckpointFiles = new Set(
            filtered.fileSnapshots.filter((snapshot) => !snapshot.deleted).map((snapshot) => snapshot.relativePath),
        );

        const inventory = fileInventory ?? inventoryFromHashIndex(host, filtered.fileSnapshots);

        log.info(`✅ Captured ${filtered.fileSnapshots.length} changed files for checkpoint (${filtered.fileSnapshots.filter(f => f.changeType === 'created').length} created, ${filtered.fileSnapshots.filter(f => f.changeType === 'modified').length} modified, ${filtered.fileSnapshots.filter(f => f.changeType === 'deleted').length} deleted)`);
        return {
            fileSnapshots: filtered.fileSnapshots,
            skippedFiles: filtered.skippedFiles,
            captureMode: 'delta',
            fileInventory: inventory,
        };
    } catch (error) {
        log.error('Failed to capture changed files:', error);
        return { fileSnapshots: [], skippedFiles, captureMode: 'delta', fileInventory: [] };
    }
}

export async function captureWorkspaceState(
    host: CheckpointEngineHost,
    mode?: CaptureMode,
    filter?: CaptureFilter,
): Promise<CaptureResult> {
    if (filter?.includeFiles?.length) {
        return captureFilteredFiles(host, filter);
    }
    const captureMode = mode ?? (workspaceHasBaseline(host) ? 'delta' : 'baseline');
    if (captureMode === 'baseline') {
        return captureBaselineFiles(host, filter);
    }
    return captureChangedFiles(host, filter);
}

export async function hasWorkspaceChanges(host: CheckpointEngineHost): Promise<boolean> {
    if (!host.currentWorkspacePath) {
        return false;
    }

    try {
        for (const document of vscode.workspace.textDocuments) {
            if (document.uri.scheme === 'file' &&
                document.uri.fsPath.startsWith(host.currentWorkspacePath) &&
                document.isDirty) {
                return true;
            }
        }

        const recentlyModifiedFiles = await getRecentlyModifiedFiles(host);
        if (recentlyModifiedFiles.length > 0 || host.recentlyDeletedFiles.size > 0) {
            return true;
        }

        if (isWatcherIndexTrusted(host)) {
            return false;
        }

        try {
            const entries = await fs.promises.readdir(host.currentWorkspacePath, { withFileTypes: true });
            const lastCheckpointTime = getLastCheckpointTime(host);

            for (const entry of entries) {
                if (entry.isFile()) {
                    const fullPath = path.join(host.currentWorkspacePath, entry.name);
                    if (shouldTrackFile(fullPath, classificationOptionsFrom(host)) && !(await isFileIgnored(host, fullPath))) {
                        const stats = await fs.promises.stat(fullPath);
                        if (stats.mtime.getTime() > lastCheckpointTime) {
                            return true;
                        }
                    }
                }
            }
        } catch (error) {
            log.debug('Quick file scan failed, assuming changes exist:', error instanceof Error ? error.message : String(error));
            return true;
        }

        return false;
    } catch (error) {
        log.error('Failed to check workspace changes:', error);
        return false;
    }
}
