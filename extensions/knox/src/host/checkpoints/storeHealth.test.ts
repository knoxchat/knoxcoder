import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { CheckpointManager } from './CheckpointManager';
import { CheckpointEnterpriseMonitor, HealthStatus } from './EnterpriseMonitor';
import { RESTORE_JOURNAL_FILENAME } from './manager/restoreJournal';
import { blobExists, blobObjectPaths, putBlob } from './store/blobStore';

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
    manager.enableCompression = false;
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

suite('Store health repair (CP-21)', () => {
    test('corrupt manifest is reported and status bar is warning or critical', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-health-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-health-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'keep.ts'), 'export const k = 1;\n');

        const monitor = CheckpointEnterpriseMonitor.getInstance() as any;
        const origStatusBar = monitor.statusBarItem;
        monitor.statusBarItem = { text: '', backgroundColor: undefined, tooltip: '' };

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const checkpointId = await manager.createManualCheckpoint({ description: 'health baseline' });
                assert.ok(checkpointId);

                const checkpointFile = path.join(storagePath, `${checkpointId}.json`);
                const raw = JSON.parse(await fs.readFile(checkpointFile, 'utf8'));
                raw.fileSnapshots[0].hash = 'tampered';
                await fs.writeFile(checkpointFile, JSON.stringify(raw, null, 2), 'utf8');

                const report = await manager.inspectStoreHealth();
                assert.strictEqual(report.corruptManifests.length, 1);
                assert.strictEqual(report.corruptManifests[0].checkpointId, checkpointId);

                const result = await monitor.performHealthCheck({ allowAutoRecovery: false });
                assert.ok(
                    result.status === HealthStatus.WARNING || result.status === HealthStatus.CRITICAL,
                    `expected warning/critical, got ${result.status}`,
                );
                assert.ok(
                    monitor.statusBarItem.text.includes('warning')
                    || monitor.statusBarItem.text.includes('error'),
                    `status bar should flag integrity: ${monitor.statusBarItem.text}`,
                );
            });
        } finally {
            monitor.statusBarItem = origStatusBar;
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('recovery GC deletes unreferenced blobs and index rebuild restores the list', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-health-gc-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-health-gc-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'keep.ts'), 'export const k = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const checkpointId = await manager.createManualCheckpoint({ description: 'gc source' });
                assert.ok(checkpointId);

                const orphanHash = await putBlob(storagePath, Buffer.from('orphan-bytes'), { compress: false });
                assert.strictEqual(await blobExists(storagePath, orphanHash), true);

                const before = await manager.inspectStoreHealth();
                assert.ok(before.orphanBlobCount >= 1);

                const gcAction = (CheckpointEnterpriseMonitor.getInstance() as any).recoveryActions.get('gc_orphans');
                assert.ok(gcAction);
                const gcOk = await gcAction.action();
                assert.strictEqual(gcOk, true);
                assert.strictEqual(await blobExists(storagePath, orphanHash), false);
                const gcAgain = await gcAction.action();
                assert.strictEqual(gcAgain, true);

                const repairAll = (CheckpointEnterpriseMonitor.getInstance() as any).recoveryActions.get('repair_all');
                assert.ok(repairAll);
                assert.strictEqual(await repairAll.action(), true);

                manager.checkpointHistory = [];
                const stale = await manager.inspectStoreHealth();
                assert.strictEqual(stale.indexNeedsRebuild, true);

                const rebuilt = await manager.repairStoreHealth({ journal: false, index: true, gc: false });
                assert.strictEqual(rebuilt.indexRebuilt, true);
                assert.ok(manager.checkpointHistory.some((cp: { id: string }) => cp.id === checkpointId));
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('journal recovery clears an incomplete restore journal', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-health-journal-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-health-j-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'keep.ts'), 'export const k = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                await manager.createManualCheckpoint({ description: 'journal source' });
                await fs.writeFile(
                    path.join(storagePath, RESTORE_JOURNAL_FILENAME),
                    JSON.stringify({
                        schemaVersion: 1,
                        checkpointId: 'cp_missing',
                        startedAt: new Date().toISOString(),
                        plannedWrites: [],
                        plannedDeletes: [],
                        completedWrites: [],
                        status: 'writing',
                    }),
                    'utf8',
                );

                const before = await manager.inspectStoreHealth();
                assert.strictEqual(before.incompleteJournal, true);

                const recovered = await manager.repairStoreHealth({
                    journal: true,
                    index: false,
                    gc: false,
                });
                assert.strictEqual(recovered.journalRecovered, true);
                const after = await manager.inspectStoreHealth();
                assert.strictEqual(after.incompleteJournal, false);
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('auto-recovery does not GC blobs named by a checksum-failed manifest', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-health-keep-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-health-keep-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'keep.ts'), 'export const k = 1;\n');

        const monitor = CheckpointEnterpriseMonitor.getInstance() as any;
        const origStatusBar = monitor.statusBarItem;
        monitor.statusBarItem = { text: '', backgroundColor: undefined, tooltip: '' };

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const checkpointId = await manager.createManualCheckpoint({ description: 'keep blobs' });
                assert.ok(checkpointId);
                const raw = JSON.parse(await fs.readFile(path.join(storagePath, `${checkpointId}.json`), 'utf8'));
                const keepHash = raw.fileSnapshots[0].hash as string;
                raw.contentSha256 = '0'.repeat(64);
                await fs.writeFile(path.join(storagePath, `${checkpointId}.json`), JSON.stringify(raw, null, 2), 'utf8');

                const orphanHash = await putBlob(storagePath, Buffer.from('true-orphan'), { compress: false });
                const before = await manager.inspectStoreHealth();
                assert.strictEqual(before.corruptManifests.length, 1);
                assert.ok(before.orphanBlobCount >= 1);

                await monitor.performHealthCheck({ allowAutoRecovery: true });
                assert.strictEqual(await blobExists(storagePath, keepHash), true);

                const gcAction = (CheckpointEnterpriseMonitor.getInstance() as any).recoveryActions.get('gc_orphans');
                assert.ok(gcAction);
                await gcAction.action();
                assert.strictEqual(await blobExists(storagePath, keepHash), true);
                assert.strictEqual(await blobExists(storagePath, orphanHash), false);
            });
        } finally {
            monitor.statusBarItem = origStatusBar;
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('missing blobs on a manifest are reported', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-health-blob-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-health-blob-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'keep.ts'), 'export const k = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const checkpointId = await manager.createManualCheckpoint({ description: 'blob source' });
                assert.ok(checkpointId);
                const raw = JSON.parse(await fs.readFile(path.join(storagePath, `${checkpointId}.json`), 'utf8'));
                const hash = raw.fileSnapshots[0].hash as string;
                const paths = blobObjectPaths(storagePath, hash);
                await fs.rm(paths.raw, { force: true });
                await fs.rm(paths.gz, { force: true });

                const report = await manager.inspectStoreHealth();
                assert.ok(report.missingBlobs.length >= 1);
                assert.ok(report.manifestsWithoutBlobs.some((entry: { checkpointId: string }) =>
                    entry.checkpointId === checkpointId,
                ));
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });
});
