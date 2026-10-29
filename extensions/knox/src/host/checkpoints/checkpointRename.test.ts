import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { CheckpointManager } from './CheckpointManager';

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
        captureBinaryFiles: manager.captureBinaryFiles,
        encryptAtRest: manager.encryptAtRest,
        maxCheckpoints: manager.maxCheckpoints,
        maxStorageBytes: manager.maxStorageBytes,
        maxFilesPerCheckpoint: manager.maxFilesPerCheckpoint,
        maxScanDepth: manager.maxScanDepth,
        watcherTrusted: manager.watcherTrusted,
        lastFullScanAt: manager.lastFullScanAt,
        fileWatchers: manager.fileWatchers,
        workspaceSessions: manager.workspaceSessions,
        branches: manager.branches,
        activeBranchId: manager.activeBranchId,
        trackedAIFiles: manager.trackedAIFiles,
        boundAgentSessionId: manager.boundAgentSessionId,
        extensionContext: manager.extensionContext,
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
    manager.captureBinaryFiles = true;
    manager.encryptAtRest = false;
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
    manager.extensionContext = undefined;

    try {
        await fn(manager);
    } finally {
        Object.assign(manager, backup);
    }
}

suite('Rename and copy detection (CP-40)', () => {
    test('mv a.ts b.ts then checkpoint is one renamed file, and history of b.ts includes a.ts', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-rename-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-rename-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'a.ts'), 'export const a = 1;\n');
        await fs.writeFile(path.join(fixtureRoot, 'keep.ts'), 'export const keep = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const baseline = await manager.createManualCheckpoint({ description: 'baseline' });
                assert.ok(baseline);

                await fs.rename(path.join(fixtureRoot, 'a.ts'), path.join(fixtureRoot, 'b.ts'));
                manager.lastCheckpointTime = Date.now() - 1000;
                manager.watcherTrusted = false;
                manager.recentlyDeletedFiles = new Set([path.join(fixtureRoot, 'a.ts')]);
                manager.recentlyModifiedFiles = new Set([path.join(fixtureRoot, 'b.ts')]);

                const renamedId = await manager.createManualCheckpoint({ description: 'renamed a to b' });
                assert.ok(renamedId);

                const checkpoint = manager.checkpointHistory.find((entry: { id: string }) => entry.id === renamedId);
                assert.ok(checkpoint);
                const dest = (checkpoint.fileSnapshots ?? []).find((snap: { relativePath: string }) => snap.relativePath === 'b.ts');
                assert.strictEqual(dest?.renamedFrom, 'a.ts');

                const diff = await manager.computeCheckpointDiff(renamedId, baseline);
                assert.ok(diff);
                assert.deepStrictEqual(
                    diff.files.map((file: { relativePath: string; status: string; oldPath?: string }) => [
                        file.relativePath,
                        file.status,
                        file.oldPath,
                    ]),
                    [['b.ts', 'renamed', 'a.ts']],
                );

                const versions = await manager.listFileCheckpointHistory('b.ts');
                assert.ok(versions.length >= 1);
                assert.strictEqual(versions[0].checkpointId, baseline);
                assert.strictEqual(versions[0].relativePath, 'a.ts');

                const exact = await manager.listFileCheckpointHistory('b.ts', { follow: false });
                assert.ok(exact.every((version: { relativePath: string }) => version.relativePath === 'b.ts'));
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('copying a file records copiedFrom without deleting the source', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-copy-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-copy-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'src.ts'), 'export const src = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const baseline = await manager.createManualCheckpoint({ description: 'baseline' });
                assert.ok(baseline);

                await fs.writeFile(path.join(fixtureRoot, 'dup.ts'), 'export const src = 1;\n');
                manager.lastCheckpointTime = Date.now() - 1000;
                manager.watcherTrusted = false;
                manager.recentlyModifiedFiles = new Set([path.join(fixtureRoot, 'dup.ts')]);

                const copiedId = await manager.createManualCheckpoint({ description: 'copied src' });
                assert.ok(copiedId);

                const checkpoint = manager.checkpointHistory.find((entry: { id: string }) => entry.id === copiedId);
                const dest = (checkpoint.fileSnapshots ?? []).find((snap: { relativePath: string }) => snap.relativePath === 'dup.ts');
                assert.strictEqual(dest?.copiedFrom, 'src.ts');

                const diff = await manager.computeCheckpointDiff(copiedId, baseline);
                assert.ok(diff);
                assert.strictEqual(diff.files.length, 1);
                assert.strictEqual(diff.files[0].status, 'copied');
                assert.strictEqual(diff.files[0].relativePath, 'dup.ts');
                assert.strictEqual(diff.files[0].oldPath, 'src.ts');
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });
});
