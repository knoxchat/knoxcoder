/**
 * Shared isolation helpers for checkpoint integration tests (CP-34).
 * Isolates the CheckpointManager singleton against a temp workspace + store.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { DEFAULT_CHECKPOINT_IGNORE_PATTERNS } from './checkpointIgnore';
import { CheckpointManager } from './CheckpointManager';

export type IsolatedCheckpointManager = any;

export async function listStoredBlobs(storagePath: string): Promise<string[]> {
    const objectsRoot = path.join(storagePath, 'objects');
    let prefixes: string[];
    try {
        prefixes = await fs.readdir(objectsRoot);
    } catch {
        return [];
    }
    const names: string[] = [];
    for (const prefix of prefixes) {
        const dir = path.join(objectsRoot, prefix);
        let entries: string[];
        try {
            entries = await fs.readdir(dir);
        } catch {
            continue;
        }
        for (const entry of entries) {
            names.push(entry);
        }
    }
    return names;
}

export async function withIsolatedManager(
    workspacePath: string,
    storagePath: string,
    fn: (manager: IsolatedCheckpointManager) => Promise<void>,
    options?: { workspaceFolderPaths?: string[] },
): Promise<void> {
    const manager = CheckpointManager.getInstance() as IsolatedCheckpointManager;
    const backup = {
        initialized: manager.initialized,
        currentWorkspacePath: manager.currentWorkspacePath,
        checkpointHistory: manager.checkpointHistory,
        lastSnapshotHashes: manager.lastSnapshotHashes,
        lastCheckpointTime: manager.lastCheckpointTime,
        sessionStartTime: manager.sessionStartTime,
        messageCheckpoints: manager.messageCheckpoints,
        stableIdCheckpoints: manager.stableIdCheckpoints,
        previousCheckpointFiles: manager.previousCheckpointFiles,
        recentlyDeletedFiles: manager.recentlyDeletedFiles,
        recentlyModifiedFiles: manager.recentlyModifiedFiles,
        ignoreFilter: manager.ignoreFilter,
        ignoreFilterFailed: manager.ignoreFilterFailed,
        customIgnorePatterns: [...manager.customIgnorePatterns],
        getStoragePath: manager.getStoragePath,
        loadCheckpointFromDisk: manager.loadCheckpointFromDisk,
        saveCheckpointHistory: manager.saveCheckpointHistory,
        deleteCheckpointFromDisk: manager.deleteCheckpointFromDisk,
        rebuildHistoryFromManifests: manager.rebuildHistoryFromManifests,
        createManualCheckpoint: manager.createManualCheckpoint,
        workspaceFolderPaths: manager.workspaceFolderPaths,
        healthIssues: manager.healthIssues,
        lastCheckpointLoad: manager.lastCheckpointLoad,
        enableCompression: manager.enableCompression,
        captureBinaryFiles: manager.captureBinaryFiles,
        encryptAtRest: manager.encryptAtRest,
        maxCheckpoints: manager.maxCheckpoints,
        maxStorageBytes: manager.maxStorageBytes,
        maxFilesPerCheckpoint: manager.maxFilesPerCheckpoint,
        maxScanDepth: manager.maxScanDepth,
        maxFileSize: manager.maxFileSize,
        watcherTrusted: manager.watcherTrusted,
        lastFullScanAt: manager.lastFullScanAt,
        fileWatchers: manager.fileWatchers,
        extensionContext: manager.extensionContext,
        workspaceSessions: manager.workspaceSessions,
        branches: manager.branches,
        activeBranchId: manager.activeBranchId,
        trackedAIFiles: manager.trackedAIFiles,
        boundAgentSessionId: manager.boundAgentSessionId,
        boundWorkspaceSessionId: manager.boundWorkspaceSessionId,
        turnCheckpoints: manager.turnCheckpoints,
    };

    manager.initialized = true;
    manager.currentWorkspacePath = workspacePath;
    manager.checkpointHistory = [];
    manager.lastSnapshotHashes = new Map();
    manager.lastCheckpointTime = Date.now();
    manager.sessionStartTime = Date.now();
    manager.messageCheckpoints = {};
    manager.stableIdCheckpoints = {};
    manager.previousCheckpointFiles = new Set();
    manager.recentlyDeletedFiles = new Set();
    manager.recentlyModifiedFiles = new Set();
    manager.trackedAIFiles = new Set();
    manager.boundAgentSessionId = null;
    manager.boundWorkspaceSessionId = null;
    manager.turnCheckpoints = new Map();
    manager.ignoreFilter = null;
    manager.ignoreFilterFailed = false;
    manager.customIgnorePatterns = [...DEFAULT_CHECKPOINT_IGNORE_PATTERNS];
    manager.healthIssues = [];
    manager.lastCheckpointLoad = null;
    manager.getStoragePath = () => storagePath;
    manager.enableCompression = true;
    manager.captureBinaryFiles = true;
    manager.encryptAtRest = false;
    manager.maxCheckpoints = 1000;
    manager.maxStorageBytes = 1_000_000_000;
    manager.maxFilesPerCheckpoint = 10_000;
    manager.maxScanDepth = 0;
    manager.maxFileSize = 5 * 1024 * 1024;
    manager.watcherTrusted = false;
    manager.lastFullScanAt = 0;
    manager.fileWatchers = [];
    manager.workspaceFolderPaths = options?.workspaceFolderPaths ?? [workspacePath];
    manager.workspaceSessions = new Map();
    manager.branches = [];
    manager.activeBranchId = undefined;
    manager.extensionContext = undefined;

    try {
        await fn(manager);
    } finally {
        Object.assign(manager, backup);
    }
}

export async function withTempCheckpointWorkspace(
    name: string,
    fn: (ctx: {
        fixtureRoot: string;
        storagePath: string;
        manager: IsolatedCheckpointManager;
    }) => Promise<void>,
    options?: { workspaceFolderPaths?: (fixtureRoot: string) => string[] },
): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('Expected an active workspace folder');
    }

    const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `${name}-${Date.now()}`);
    const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), `knox-${name}-`));
    await fs.mkdir(fixtureRoot, { recursive: true });

    try {
        const folderPaths = options?.workspaceFolderPaths?.(fixtureRoot);
        await withIsolatedManager(
            folderPaths?.[0] ?? fixtureRoot,
            storagePath,
            async (manager) => {
                await fn({ fixtureRoot, storagePath, manager });
            },
            folderPaths ? { workspaceFolderPaths: folderPaths } : undefined,
        );
    } finally {
        await fs.rm(fixtureRoot, { recursive: true, force: true });
        await fs.rm(storagePath, { recursive: true, force: true });
    }
}
