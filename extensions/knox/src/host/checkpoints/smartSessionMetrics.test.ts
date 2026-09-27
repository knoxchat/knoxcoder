import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { CheckpointManager } from './CheckpointManager';
import { OperationMode, SmartCheckpointManager } from './SmartCheckpointManager';

async function withIsolatedManager(
    workspacePath: string,
    storagePath: string,
    fn: (manager: any) => Promise<void>,
): Promise<void> {
    const manager = CheckpointManager.getInstance() as any;
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
        getStoragePath: manager.getStoragePath,
        workspaceFolderPaths: manager.workspaceFolderPaths,
        healthIssues: manager.healthIssues,
        lastCheckpointLoad: manager.lastCheckpointLoad,
        enableCompression: manager.enableCompression,
        maxCheckpoints: manager.maxCheckpoints,
        maxStorageBytes: manager.maxStorageBytes,
        maxFilesPerCheckpoint: manager.maxFilesPerCheckpoint,
        workspaceSessions: manager.workspaceSessions,
        branches: manager.branches,
        activeBranchId: manager.activeBranchId,
        maxScanDepth: manager.maxScanDepth,
        maxFileSize: manager.maxFileSize,
        watcherTrusted: manager.watcherTrusted,
        lastFullScanAt: manager.lastFullScanAt,
        fileWatchers: manager.fileWatchers,
        trackedAIFiles: manager.trackedAIFiles,
        boundAgentSessionId: manager.boundAgentSessionId,
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
    manager.ignoreFilter = null;
    manager.ignoreFilterFailed = false;
    manager.healthIssues = [];
    manager.lastCheckpointLoad = null;
    manager.getStoragePath = () => storagePath;
    manager.enableCompression = true;
    manager.maxCheckpoints = 1000;
    manager.maxStorageBytes = 1_000_000_000;
    manager.maxFilesPerCheckpoint = 10_000;
    manager.maxScanDepth = 0;
    manager.watcherTrusted = false;
    manager.lastFullScanAt = 0;
    manager.fileWatchers = [];
    manager.workspaceFolderPaths = [workspacePath];
    manager.workspaceSessions = new Map();
    manager.branches = [];
    manager.activeBranchId = undefined;

    try {
        await fn(manager);
    } finally {
        Object.assign(manager, backup);
    }
}

suite('Smart AI session metrics (CP-35)', () => {
    test('getChangesetStats reports tracked files and agent mode when a session is bound', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-stats-'));
        try {
            await withIsolatedManager(workspaceFolder.uri.fsPath, storagePath, async (manager) => {
                const idle = await manager.getChangesetStats();
                assert.strictEqual(idle.mode, 'workspace');
                assert.strictEqual(idle.files_tracked, 0);
                assert.notStrictEqual(idle.mode, 'fallback');

                await manager.startAgentSession('agent-stats');
                await manager.trackAIFiles(['src/a.ts', 'src/b.ts']);
                manager.recentlyModifiedFiles.add('src/a.ts');

                const stats = await manager.getChangesetStats();
                assert.strictEqual(stats.mode, 'agent');
                assert.strictEqual(stats.files_tracked, 2);
                assert.strictEqual(stats.changes_detected, 1);
                assert.deepStrictEqual(stats.tracked_files, ['src/a.ts', 'src/b.ts']);
            });
        } finally {
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('a session that edits 2 files records file and line counts on the dashboard', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-smart-metrics-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-smart-metrics-'));
        const fileA = path.join(fixtureRoot, 'a.ts');
        const fileB = path.join(fixtureRoot, 'b.ts');

        const smart = SmartCheckpointManager.getInstance() as any;
        const smartBackup = {
            initialized: smart.initialized,
            operationMode: smart.operationMode,
            currentSession: smart.currentSession,
            config: { ...smart.config },
        };

        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(fileA, 'export const a = 1;\n');
        await fs.writeFile(fileB, 'export const b = 1;\nkeep\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                smart.initialized = true;
                smart.operationMode = OperationMode.Chat;
                smart.currentSession = null;
                smart.config = {
                    ...smart.config,
                    enabled: true,
                    enableMetrics: true,
                    verboseLogging: false,
                };

                const baselineId = await manager.createManualCheckpoint({ description: 'session start tree' });
                assert.ok(baselineId);

                await smart.startAISession('agent-two-files');
                assert.strictEqual(smart.getCurrentSession()?.baselineCheckpointId, baselineId);

                await fs.writeFile(fileA, 'export const a = 1;\nexport const extra = 2;\nexport const more = 3;\n');
                await fs.writeFile(fileB, 'export const b = 1;\n');
                await smart.trackAIFiles(['a.ts', 'b.ts']);

                const stats = await smart.getSmartStats();
                assert.strictEqual(stats.files_tracked, 2);
                assert.strictEqual(stats.mode, OperationMode.Agent);
                assert.notStrictEqual(stats.mode, 'fallback');

                await smart.stopAISession();

                const dashboard = await manager.getPerformanceDashboard(30);
                assert.ok(dashboard.aiSessionMetrics.length >= 1);
                const session = dashboard.aiSessionMetrics[0];
                assert.strictEqual(session.filesChanged, 2);
                assert.ok((session.linesAdded ?? 0) > 0);
                assert.ok((session.linesDeleted ?? 0) > 0);
                assert.strictEqual(session.checkpointsCreated, 1);
                assert.strictEqual(session.rollbacks, 0);
            });
        } finally {
            smart.initialized = smartBackup.initialized;
            smart.operationMode = smartBackup.operationMode;
            smart.currentSession = smartBackup.currentSession;
            smart.config = smartBackup.config;
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('restores during a session are counted as rollbacks', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder);

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-smart-rollback-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-smart-rollback-'));
        const fileA = path.join(fixtureRoot, 'a.ts');

        const smart = SmartCheckpointManager.getInstance() as any;
        const smartBackup = {
            initialized: smart.initialized,
            operationMode: smart.operationMode,
            currentSession: smart.currentSession,
            config: { ...smart.config },
        };

        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(fileA, 'export const a = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                smart.initialized = true;
                smart.operationMode = OperationMode.Chat;
                smart.currentSession = null;
                smart.config = {
                    ...smart.config,
                    enabled: true,
                    enableMetrics: true,
                    verboseLogging: false,
                };

                const baselineId = await manager.createManualCheckpoint({ description: 'rollback baseline' });
                assert.ok(baselineId);
                await smart.startAISession('agent-rollback');

                await fs.writeFile(fileA, 'export const a = 999;\n');
                await manager.restoreCheckpoint(baselineId, {
                    createBackup: false,
                    conflictResolution: 'overwrite',
                    cleanupExtraFiles: false,
                });

                await smart.trackAIFiles(['a.ts']);
                await smart.stopAISession();

                const dashboard = await manager.getPerformanceDashboard(30);
                assert.ok(dashboard.aiSessionMetrics.length >= 1);
                assert.ok((dashboard.aiSessionMetrics[0].rollbacks ?? 0) >= 1);
            });
        } finally {
            smart.initialized = smartBackup.initialized;
            smart.operationMode = smartBackup.operationMode;
            smart.currentSession = smartBackup.currentSession;
            smart.config = smartBackup.config;
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });
});
