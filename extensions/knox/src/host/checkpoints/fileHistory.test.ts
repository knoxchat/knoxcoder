import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { CheckpointManager } from './CheckpointManager';
import { uriFromFileHistoryArg } from './fileHistoryCommands';
import { uniqueFileVersionsFromSnapshots } from './manager/fileHistory';
import type { FileSnapshot } from './manager/types';

function snap(relativePath: string, hash: string, extra?: Partial<FileSnapshot>): FileSnapshot {
    return {
        relativePath,
        hash,
        encoding: 'utf8',
        lastModified: new Date('2026-01-01T00:00:00.000Z'),
        size: 10,
        ...extra,
    };
}

function info(id: string, description: string, created: string) {
    return { id, description, created: new Date(created) };
}

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

suite('Per-file checkpoint history (CP-19)', () => {
    test('collapses consecutive identical hashes so three versions yield three entries', () => {
        const versions = uniqueFileVersionsFromSnapshots(
            [
                {
                    info: info('cp1', 'baseline', '2026-01-01T00:00:00.000Z'),
                    snapshots: [snap('a.ts', 'hash-a1'), snap('b.ts', 'hash-b1')],
                },
                {
                    info: info('cp2', 'only b changed', '2026-01-02T00:00:00.000Z'),
                    snapshots: [snap('b.ts', 'hash-b2')],
                },
                {
                    info: info('cp3', 'a v2', '2026-01-03T00:00:00.000Z'),
                    snapshots: [snap('a.ts', 'hash-a2')],
                },
                {
                    info: info('cp4', 'unrelated', '2026-01-04T00:00:00.000Z'),
                    snapshots: [snap('c.ts', 'hash-c1')],
                },
                {
                    info: info('cp5', 'a v3', '2026-01-05T00:00:00.000Z'),
                    snapshots: [snap('a.ts', 'hash-a3')],
                },
            ],
            'a.ts',
        );

        assert.deepStrictEqual(
            versions.map((version) => version.checkpointId),
            ['cp1', 'cp3', 'cp5'],
        );
        assert.deepStrictEqual(
            versions.map((version) => version.hash),
            ['hash-a1', 'hash-a2', 'hash-a3'],
        );
        assert.strictEqual(versions.every((version) => version.deleted === false), true);
    });

    test('treats deletion and recreation as distinct versions', () => {
        const versions = uniqueFileVersionsFromSnapshots(
            [
                {
                    info: info('cp1', 'created', '2026-01-01T00:00:00.000Z'),
                    snapshots: [snap('src\\a.ts', 'hash-a1')],
                },
                {
                    info: info('cp2', 'deleted', '2026-01-02T00:00:00.000Z'),
                    snapshots: [snap('src/a.ts', 'hash-a1', { deleted: true, changeType: 'deleted' })],
                },
                {
                    info: info('cp3', 'recreated', '2026-01-03T00:00:00.000Z'),
                    snapshots: [snap('src/a.ts', 'hash-a1', { changeType: 'created' })],
                },
            ],
            'src/a.ts',
        );

        assert.strictEqual(versions.length, 3);
        assert.strictEqual(versions[0].deleted, false);
        assert.strictEqual(versions[1].deleted, true);
        assert.strictEqual(versions[2].deleted, false);
        assert.strictEqual(versions[2].hash, 'hash-a1');
    });

    test('uriFromFileHistoryArg reads explorer URIs and falls back to the active editor', () => {
        const file = vscode.Uri.file('/tmp/proj/a.ts');
        assert.strictEqual(uriFromFileHistoryArg(file)?.fsPath, file.fsPath);
        assert.strictEqual(uriFromFileHistoryArg([file])?.fsPath, file.fsPath);
        assert.strictEqual(uriFromFileHistoryArg({ uri: file })?.fsPath, file.fsPath);
        assert.strictEqual(uriFromFileHistoryArg({ resourceUri: file })?.fsPath, file.fsPath);
        assert.strictEqual(uriFromFileHistoryArg(undefined), vscode.window.activeTextEditor?.document.uri);
    });

    test('lists three unique versions and restoring one file does not revert others', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-file-history-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-file-hist-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'a.ts'), 'export const a = 1;\n');
        await fs.writeFile(path.join(fixtureRoot, 'b.ts'), 'export const b = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const v1 = await manager.createManualCheckpoint({ description: 'a v1' });
                assert.ok(v1);

                await fs.writeFile(path.join(fixtureRoot, 'a.ts'), 'export const a = 2;\n');
                manager.lastCheckpointTime = Date.now() - 1000;
                manager.watcherTrusted = false;
                manager.recentlyModifiedFiles = new Set([path.join(fixtureRoot, 'a.ts')]);
                const v2 = await manager.createManualCheckpoint({ description: 'a v2' });
                assert.ok(v2);

                await fs.writeFile(path.join(fixtureRoot, 'b.ts'), 'export const b = 2;\n');
                manager.lastCheckpointTime = Date.now() - 1000;
                manager.watcherTrusted = false;
                manager.recentlyModifiedFiles = new Set([path.join(fixtureRoot, 'b.ts')]);
                const onlyB = await manager.createManualCheckpoint({ description: 'only b' });
                assert.ok(onlyB);

                await fs.writeFile(path.join(fixtureRoot, 'a.ts'), 'export const a = 3;\n');
                manager.lastCheckpointTime = Date.now() - 1000;
                manager.watcherTrusted = false;
                manager.recentlyModifiedFiles = new Set([path.join(fixtureRoot, 'a.ts')]);
                const v3 = await manager.createManualCheckpoint({ description: 'a v3' });
                assert.ok(v3);

                const versions = await manager.listFileCheckpointHistory('a.ts');
                assert.strictEqual(versions.length, 3, 'unchanged-a checkpoints must not appear');
                assert.deepStrictEqual(
                    versions.map((version: { checkpointId: string }) => version.checkpointId),
                    [v1, v2, v3],
                );
                assert.strictEqual(versions.every((version: { deleted: boolean }) => version.deleted === false), true);

                const restored = await manager.restoreCheckpointFiles(v1, ['a.ts']);
                assert.strictEqual(restored.success, true);
                assert.deepStrictEqual(restored.restoredFiles, ['a.ts']);

                const aContent = await fs.readFile(path.join(fixtureRoot, 'a.ts'), 'utf8');
                const bContent = await fs.readFile(path.join(fixtureRoot, 'b.ts'), 'utf8');
                assert.strictEqual(aContent, 'export const a = 1;\n');
                assert.strictEqual(bContent, 'export const b = 2;\n');
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('rejects path-escape queries without listing history', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-file-hist-sandbox-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-file-hist-sb-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'a.ts'), 'export const a = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const checkpointId = await manager.createManualCheckpoint({ description: 'baseline' });
                assert.ok(checkpointId);
                const escaped = await manager.listFileCheckpointHistory('../outside.txt');
                assert.deepStrictEqual(escaped, []);
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });
});
