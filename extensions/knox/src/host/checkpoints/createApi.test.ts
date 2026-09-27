import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { CheckpointManager } from './CheckpointManager';
import { toIndexRecord } from './manager/persistence';

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
        loadCheckpointFromDisk: manager.loadCheckpointFromDisk,
        saveCheckpointHistory: manager.saveCheckpointHistory,
        deleteCheckpointFromDisk: manager.deleteCheckpointFromDisk,
        rebuildHistoryFromManifests: manager.rebuildHistoryFromManifests,
        createManualCheckpoint: manager.createManualCheckpoint,
        recordRestorationEvent: manager.recordRestorationEvent,
        cleanupFilesNotInInventory: manager.cleanupFilesNotInInventory,
        cleanupExtraFiles: manager.cleanupExtraFiles,
        healthIssues: manager.healthIssues,
        lastCheckpointLoad: manager.lastCheckpointLoad,
        enableCompression: manager.enableCompression,
        maxCheckpoints: manager.maxCheckpoints,
        maxStorageBytes: manager.maxStorageBytes,
        maxFilesPerCheckpoint: manager.maxFilesPerCheckpoint,
        extensionContext: manager.extensionContext,
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
        boundWorkspaceSessionId: manager.boundWorkspaceSessionId,
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

function snapshotPaths(detailed: { fileSnapshots?: Array<{ relativePath: string }> } | null): string[] {
    return (detailed?.fileSnapshots ?? [])
        .filter((snapshot) => !('deleted' in snapshot && (snapshot as any).deleted))
        .map((snapshot) => snapshot.relativePath.replace(/\\/g, '/'))
        .sort();
}

suite('Create API completeness (CP-13)', () => {
    test('lean index keeps parentCheckpointIds and leaves older records alone', () => {
        const created = new Date('2026-08-17T12:00:00.000Z');
        const indexed = toIndexRecord({
            id: 'cp_merge',
            description: 'merge',
            created,
            parentCheckpointId: 'cp_target',
            parentCheckpointIds: ['cp_target', 'cp_source'],
        });
        assert.strictEqual(indexed.parentCheckpointId, 'cp_target');
        assert.deepStrictEqual(indexed.parentCheckpointIds, ['cp_target', 'cp_source']);
        assert.strictEqual(toIndexRecord({
            id: 'cp_old',
            description: 'old',
            created,
            parentCheckpointId: 'cp_root',
        }).parentCheckpointIds, undefined);
    });

    test('includeFiles snapshots only the requested file and stores tags', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-create-api-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-create-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'a.ts'), 'export const a = 1;\n');
        await fs.writeFile(path.join(fixtureRoot, 'b.ts'), 'export const b = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const checkpointId = await manager.createManualCheckpoint({
                    description: 'Only a.ts',
                    tags: ['manual', 'filtered', 'filtered'],
                    includeFiles: ['a.ts'],
                });
                assert.ok(checkpointId);

                const detailed = await manager.getCheckpointWithSnapshots(checkpointId);
                assert.deepStrictEqual(snapshotPaths(detailed), ['a.ts']);
                assert.deepStrictEqual(detailed?.tags, ['manual', 'filtered']);
                assert.strictEqual(detailed?.captureMode, 'delta');

                const indexed = manager.getCheckpointInfo(checkpointId);
                assert.deepStrictEqual(indexed?.tags, ['manual', 'filtered']);
                assert.deepStrictEqual(toIndexRecord(detailed!).tags, ['manual', 'filtered']);
                assert.ok(!toIndexRecord(detailed!).fileSnapshots);

                const baselineId = await manager.createManualCheckpoint({
                    description: 'Full baseline after filtered capture',
                });
                assert.ok(baselineId);
                const baseline = await manager.getCheckpointWithSnapshots(baselineId);
                assert.strictEqual(baseline?.captureMode, 'baseline');
                assert.ok(snapshotPaths(baseline).includes('a.ts'));
                assert.ok(snapshotPaths(baseline).includes('b.ts'));
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('excludeFiles omits matching paths from snapshots', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-create-excl-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-excl-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'keep.ts'), 'export const keep = 1;\n');
        await fs.writeFile(path.join(fixtureRoot, 'skip.ts'), 'export const skip = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const checkpointId = await manager.createManualCheckpoint({
                    description: 'Exclude skip.ts',
                    excludeFiles: ['skip.ts'],
                });
                assert.ok(checkpointId);
                const detailed = await manager.getCheckpointWithSnapshots(checkpointId);
                const paths = snapshotPaths(detailed);
                assert.ok(paths.includes('keep.ts'));
                assert.ok(!paths.includes('skip.ts'));
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('incremental checkpoints are delta manifests, not a second full dump', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-create-incr-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-incr-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'a.ts'), 'export const a = 1;\n');
        await fs.writeFile(path.join(fixtureRoot, 'b.ts'), 'export const b = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const baselineId = await manager.createManualCheckpoint({
                    description: 'baseline',
                });
                assert.ok(baselineId);

                await fs.writeFile(path.join(fixtureRoot, 'a.ts'), 'export const a = 2;\n');
                manager.lastCheckpointTime = Date.now() - 1000;
                manager.watcherTrusted = false;
                manager.recentlyModifiedFiles = new Set([path.join(fixtureRoot, 'a.ts')]);

                const incrementalId = await manager.createIncrementalCheckpoint({
                    description: 'delta after edit',
                    tags: ['ai-session'],
                });
                assert.ok(incrementalId);
                assert.notStrictEqual(incrementalId, baselineId);

                const incremental = await manager.getCheckpointWithSnapshots(incrementalId);
                assert.strictEqual(incremental?.captureMode, 'delta');
                assert.ok(incremental?.tags?.includes('incremental'));
                assert.ok(incremental?.tags?.includes('ai-session'));
                assert.ok(!incremental?.messageId);
                const paths = snapshotPaths(incremental);
                assert.ok(paths.includes('a.ts'));
                assert.ok(!paths.includes('b.ts'));

                const secondIncremental = await manager.createIncrementalCheckpoint({
                    description: 'second incremental with no further edits',
                });
                assert.strictEqual(secondIncremental, undefined);
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('trackAIFiles restricts the next agent capture to those paths plus watcher hits', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-create-track-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-track-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'a.ts'), 'export const a = 1;\n');
        await fs.writeFile(path.join(fixtureRoot, 'b.ts'), 'export const b = 1;\n');
        await fs.writeFile(path.join(fixtureRoot, 'c.ts'), 'export const c = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const baselineId = await manager.createManualCheckpoint({ description: 'baseline' });
                assert.ok(baselineId);

                await fs.writeFile(path.join(fixtureRoot, 'a.ts'), 'export const a = 2;\n');
                await fs.writeFile(path.join(fixtureRoot, 'b.ts'), 'export const b = 2;\n');
                await fs.writeFile(path.join(fixtureRoot, 'c.ts'), 'export const c = 2;\n');

                await manager.trackAIFiles(['a.ts']);
                const agentId = await manager.createAgentCheckpoint({
                    description: 'agent restricted',
                    tags: ['ai'],
                    sessionId: 'agent-session-cp13',
                });
                assert.ok(agentId);
                const agent = await manager.getCheckpointWithSnapshots(agentId);
                assert.deepStrictEqual(snapshotPaths(agent), ['a.ts']);
                assert.ok(agent?.tags?.includes('ai'));

                manager.recentlyModifiedFiles = new Set([path.join(fixtureRoot, 'c.ts')]);
                await manager.trackAIFiles(['a.ts']);
                const withWatcherId = await manager.createAgentCheckpoint({
                    description: 'agent plus watcher',
                    sessionId: 'agent-session-cp13-watcher',
                });
                assert.ok(withWatcherId);
                const withWatcher = await manager.getCheckpointWithSnapshots(withWatcherId);
                const watched = snapshotPaths(withWatcher);
                assert.ok(watched.includes('a.ts'));
                assert.ok(watched.includes('c.ts'));
                assert.ok(!watched.includes('b.ts'));
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });
});
