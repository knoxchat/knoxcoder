import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { CheckpointManager } from './CheckpointManager';
import { countLineDelta, summarizeCheckpointDiff } from './manager/restorePreview';

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

suite('Restore preview (CP-18)', () => {
    test('countLineDelta reports additions, deletions, and hunks', () => {
        assert.deepStrictEqual(countLineDelta('a\nb\n', 'a\nb\n'), {
            additions: 0,
            deletions: 0,
            hunkCount: 0,
        });
        const changed = countLineDelta('one\ntwo\nthree\n', 'one\nTWO\nthree\nfour\n');
        assert.strictEqual(changed.deletions, 1);
        assert.strictEqual(changed.additions, 2);
        assert.ok(changed.hunkCount >= 1);

        const summary = summarizeCheckpointDiff({
            oldCheckpoint: { id: 'cp-old', description: 'old', created: '2026-08-16T00:00:00.000Z' },
            newCheckpoint: { id: 'cp-new', description: 'new', created: '2026-08-17T00:00:00.000Z' },
            files: [{
                relativePath: 'src/a.ts',
                status: 'modified',
                oldContent: 'one\n',
                newContent: 'two\n',
            }],
        });
        assert.strictEqual(summary.files.length, 1);
        assert.strictEqual(summary.files[0].status, 'modified');
        assert.ok(summary.files[0].hunkCount >= 1);
        assert.ok(!('oldContent' in summary.files[0]));
    });

    test('preview lists files restore would write and extras restoreCheckpointFiles can delete', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-preview-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-preview-'));
        const keep = path.join(fixtureRoot, 'keep.ts');
        const edit = path.join(fixtureRoot, 'edit.ts');
        const extra = path.join(fixtureRoot, 'extra.ts');
        const missing = path.join(fixtureRoot, 'missing.ts');

        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(keep, 'export const keep = 1;\n');
        await fs.writeFile(edit, 'export const edit = 1;\n');
        await fs.writeFile(missing, 'export const missing = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const checkpointId = await manager.createManualCheckpoint({
                    description: 'Preview baseline',
                });
                assert.ok(checkpointId);

                await fs.writeFile(edit, 'export const edit = 2;\n');
                await fs.writeFile(extra, 'export const extra = 1;\n');
                await fs.unlink(missing);

                const preview = await manager.previewRestore(checkpointId);
                assert.ok(preview);
                assert.strictEqual(preview.checkpointId, checkpointId);
                assert.strictEqual(preview.modified, 1);
                assert.strictEqual(preview.added, 1);
                assert.strictEqual(preview.deleted, 1);
                assert.deepStrictEqual(preview.writePaths.sort(), ['edit.ts', 'missing.ts']);
                assert.deepStrictEqual(preview.extraPaths, ['extra.ts']);
                assert.ok(!preview.writePaths.includes('keep.ts'));

                const editFile = preview.files.find((file: any) => file.relativePath === 'edit.ts');
                const missingFile = preview.files.find((file: any) => file.relativePath === 'missing.ts');
                const extraFile = preview.files.find((file: any) => file.relativePath === 'extra.ts');
                assert.strictEqual(editFile?.action, 'overwrite');
                assert.strictEqual(missingFile?.action, 'create');
                assert.strictEqual(extraFile?.action, 'delete');
                assert.ok((editFile?.hunkCount ?? 0) >= 1);

                const selected = await manager.restoreCheckpointFiles(checkpointId, preview.writePaths);
                assert.strictEqual(selected.success, true);
                assert.strictEqual(await fs.readFile(edit, 'utf8'), 'export const edit = 1;\n');
                assert.strictEqual(await fs.readFile(missing, 'utf8'), 'export const missing = 1;\n');
                assert.strictEqual(await fs.readFile(keep, 'utf8'), 'export const keep = 1;\n');
                assert.strictEqual(await fs.readFile(extra, 'utf8'), 'export const extra = 1;\n');

                const deletedExtra = await manager.restoreCheckpointFiles(checkpointId, preview.extraPaths);
                assert.strictEqual(deletedExtra.success, true);
                await assert.rejects(() => fs.access(extra));
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('preview of an unchanged workspace is empty', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-preview-empty-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-preview-empty-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'same.ts'), 'export const same = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const checkpointId = await manager.createManualCheckpoint({
                    description: 'Unchanged',
                });
                assert.ok(checkpointId);
                const preview = await manager.previewRestore(checkpointId);
                assert.ok(preview);
                assert.strictEqual(preview.modified, 0);
                assert.strictEqual(preview.added, 0);
                assert.strictEqual(preview.deleted, 0);
                assert.deepStrictEqual(preview.files, []);
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });
});
