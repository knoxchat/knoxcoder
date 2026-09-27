import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { CheckpointManager } from './CheckpointManager';
import { eventsLogPath, readAuditEvents } from './store/auditLog';

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

suite('Durable checkpoint audit log (CP-20)', () => {
    test('create/restore/pin persist events and dashboard restoration history has a row', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-audit-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-audit-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'a.ts'), 'export const n = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const checkpointId = await manager.createManualCheckpoint({ description: 'audit baseline' });
                assert.ok(checkpointId);

                await fs.writeFile(path.join(fixtureRoot, 'a.ts'), 'export const n = 2;\n');
                const result = await manager.restoreCheckpoint(checkpointId, {
                    createBackup: false,
                    conflictResolution: 'overwrite',
                    cleanupExtraFiles: false,
                });
                assert.strictEqual(result.success, true);
                assert.strictEqual(await fs.readFile(path.join(fixtureRoot, 'a.ts'), 'utf8'), 'export const n = 1;\n');

                const pinned = await manager.setCheckpointPinned(checkpointId, true);
                assert.strictEqual(pinned, true);

                const events = await readAuditEvents(storagePath);
                const actions = events.map((event) => event.action);
                assert.ok(actions.includes('create'), `expected create in ${actions.join(',')}`);
                assert.ok(actions.includes('restore'), `expected restore in ${actions.join(',')}`);
                assert.ok(actions.includes('pin'), `expected pin in ${actions.join(',')}`);
                assert.ok(actions.includes('storage_snapshot'));
                assert.ok(events.every((event) => event.userId));
                assert.ok(!JSON.stringify(events).includes('databaseBytes'));

                const dashboard = await manager.getPerformanceDashboard(30);
                assert.ok(dashboard.restorationEvents.length >= 1);
                assert.strictEqual(dashboard.restorationEvents[0].checkpointId, checkpointId);
                assert.strictEqual(dashboard.restorationEvents[0].success, true);
                assert.ok(dashboard.restorationEvents[0].filesRestored >= 1);
                assert.ok(!('databaseBytes' in dashboard.currentStorage));
                assert.ok(typeof dashboard.currentStorage.blobCount === 'number');
                assert.ok(typeof dashboard.currentStorage.checkpointDataBytes === 'number');
                assert.ok(dashboard.summary.totalCheckpointsCreated >= 1);
                assert.ok(dashboard.creationFrequency.length >= 1);

                const trail = await manager.getAuditTrail(20, 'restore');
                assert.strictEqual(trail.length >= 1, true);
                assert.strictEqual(trail[0].action, 'restore');
                assert.strictEqual(trail[0].resourceId, checkpointId);

                await fs.access(eventsLogPath(storagePath));
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('recorders persist AI sessions without fake zero line counts', async () => {
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-metrics-'));
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        try {
            await withIsolatedManager(workspaceFolder.uri.fsPath, storagePath, async (manager) => {
                const recorded = await manager.recordAISessionMetrics({
                    sessionId: '11111111-1111-4111-8111-111111111111',
                    startedAt: '2026-08-17T10:00:00.000Z',
                    endedAt: '2026-08-17T10:05:00.000Z',
                    filesChanged: 2,
                    checkpointsCreated: 1,
                    durationSeconds: 300,
                });
                assert.strictEqual(recorded, true);

                const dashboard = await manager.getPerformanceDashboard(30);
                assert.strictEqual(dashboard.aiSessionMetrics.length, 1);
                assert.strictEqual(dashboard.aiSessionMetrics[0].filesChanged, 2);
                assert.strictEqual(dashboard.aiSessionMetrics[0].linesAdded, undefined);
                assert.strictEqual(dashboard.aiSessionMetrics[0].linesDeleted, undefined);
                assert.strictEqual(dashboard.aiSessionMetrics[0].rollbacks, undefined);
                assert.ok(!JSON.stringify(dashboard.aiSessionMetrics[0]).includes('"linesAdded":0'));

                const snapshot = await manager.recordStorageSnapshot();
                assert.strictEqual(snapshot, true);
                const events = await readAuditEvents(storagePath);
                const storageEvent = events.find((event) => event.action === 'storage_snapshot');
                assert.ok(storageEvent);
                assert.ok(storageEvent?.counts && !('databaseBytes' in storageEvent.counts));
            });
        } finally {
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });
});
