import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'path';
import * as vscode from 'vscode';

import { isBranchId } from './manager/branchLogic';
import { CheckpointManager } from './CheckpointManager';
import { loadIndexFromCurrentStore } from './manager/persistence';

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
        ignoreFilter: manager.ignoreFilter,
        ignoreFilterFailed: manager.ignoreFilterFailed,
        getStoragePath: manager.getStoragePath,
        workspaceFolderPaths: manager.workspaceFolderPaths,
        loadCheckpointFromDisk: manager.loadCheckpointFromDisk,
        saveCheckpointHistory: manager.saveCheckpointHistory,
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
        recentlyModifiedFiles: manager.recentlyModifiedFiles,
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
    manager.ignoreFilter = null;
    manager.ignoreFilterFailed = false;
    manager.healthIssues = [];
    manager.lastCheckpointLoad = null;
    manager.getStoragePath = () => storagePath;
    manager.enableCompression = true;
    manager.maxCheckpoints = 1000;
    manager.maxStorageBytes = 1_000_000_000;
    manager.maxFilesPerCheckpoint = 10_000;
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

function reconstructedText(
    state: Map<string, { content: string }> | null,
    relativePath: string,
): string | undefined {
    return state?.get(relativePath)?.content ?? state?.get(relativePath.replace(/\\/g, '/'))?.content;
}

suite('Durable local branching (CP-24)', () => {
    test('createBranch survives reload and new checkpoints attach to the active line', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-branch-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-branch-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'a.ts'), 'export const a = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const baselineId = await manager.createManualCheckpoint({ description: 'base' });
                assert.ok(baselineId);

                const branch = await manager.createBranch('feature', baselineId, 'experiment');
                assert.ok(branch);
                assert.ok(isBranchId(branch.id));
                assert.strictEqual(branch.name, 'feature');
                assert.strictEqual(branch.baseCheckpointId, baselineId);
                assert.strictEqual(manager.activeBranchId, branch.id);

                await fs.writeFile(path.join(fixtureRoot, 'a.ts'), 'export const a = 2;\n');
                const featureId = await manager.createManualCheckpoint({ description: 'on feature' });
                assert.ok(featureId);
                const featureCp = manager.getCheckpointInfo(featureId);
                assert.strictEqual(featureCp?.branchId, branch.id);
                assert.strictEqual(featureCp?.parentCheckpointId, baselineId);

                manager.branches = [];
                manager.activeBranchId = undefined;
                manager.checkpointHistory = [];
                const loaded = await loadIndexFromCurrentStore(manager);
                assert.ok(loaded);
                const reloaded = manager.listBranches
                    ? await manager.listBranches()
                    : manager.branches;
                assert.ok(reloaded.some((item: { name: string }) => item.name === 'feature'));
                assert.ok(reloaded.some((item: { name: string }) => item.name === 'main'));
                assert.ok(manager.activeBranchId);
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('switch does not restore files; reconstruct follows branch lineage', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-branch-line-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-branch-line-'));
        const fileA = path.join(fixtureRoot, 'a.ts');
        const fileB = path.join(fixtureRoot, 'b.ts');
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(fileA, 'A0\n');
        await fs.writeFile(fileB, 'B0\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const baselineId = await manager.createManualCheckpoint({ description: 'base' });
                assert.ok(baselineId);

                const feature = await manager.createBranch('feature', baselineId);
                assert.ok(feature);
                await fs.writeFile(fileA, 'A-feature\n');
                const featureId = await manager.createManualCheckpoint({ description: 'feature edit' });
                assert.ok(featureId);

                const main = (await manager.listBranches()).find((item: { name: string }) => item.name === 'main');
                assert.ok(main);
                const switched = await manager.switchBranch(main.id);
                assert.ok(switched);
                assert.strictEqual(await fs.readFile(fileA, 'utf8'), 'A-feature\n',
                    'switchBranch must not rewrite the workspace');

                await fs.writeFile(fileA, 'A0\n');
                await fs.writeFile(fileB, 'B-main\n');
                const mainId = await manager.createManualCheckpoint({ description: 'main edit' });
                assert.ok(mainId);

                const featureState = await manager.reconstructStateAtCheckpoint(featureId);
                const mainState = await manager.reconstructStateAtCheckpoint(mainId);
                assert.strictEqual(reconstructedText(featureState, 'a.ts'), 'A-feature\n');
                assert.strictEqual(reconstructedText(featureState, 'b.ts'), 'B0\n');
                assert.strictEqual(reconstructedText(mainState, 'a.ts'), 'A0\n');
                assert.strictEqual(reconstructedText(mainState, 'b.ts'), 'B-main\n');
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('merge three-way auto-resolves non-overlapping hashes and reports conflicts', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-branch-merge-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-branch-merge-'));
        const fileA = path.join(fixtureRoot, 'a.ts');
        const fileB = path.join(fixtureRoot, 'b.ts');
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(fileA, 'A0\n');
        await fs.writeFile(fileB, 'B0\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const baselineId = await manager.createManualCheckpoint({ description: 'base' });
                assert.ok(baselineId);
                const feature = await manager.createBranch('feature', baselineId);
                assert.ok(feature);

                await fs.writeFile(fileA, 'A-feature\n');
                const featureId = await manager.createManualCheckpoint({ description: 'feature a' });
                assert.ok(featureId);

                const main = (await manager.listBranches()).find((item: { name: string }) => item.name === 'main');
                assert.ok(main);
                await manager.switchBranch(main.id);
                await fs.writeFile(fileA, 'A0\n');
                await fs.writeFile(fileB, 'B-main\n');
                const mainId = await manager.createManualCheckpoint({ description: 'main b' });
                assert.ok(mainId);

                const merged = await manager.mergeBranches(feature.id, main.id);
                assert.strictEqual(merged.success, true, JSON.stringify(merged.conflicts));
                assert.ok(merged.mergeCheckpointId);
                assert.deepStrictEqual(merged.conflicts, []);
                const mergeCp = manager.getCheckpointHistoryForWorkspace().find(
                    (checkpoint: { id: string }) => checkpoint.id === merged.mergeCheckpointId,
                );
                assert.strictEqual(mergeCp?.parentCheckpointId, mainId);
                assert.deepStrictEqual(mergeCp?.parentCheckpointIds, [mainId, featureId]);

                const mergedState = await manager.reconstructStateAtCheckpoint(merged.mergeCheckpointId);
                assert.strictEqual(reconstructedText(mergedState, 'a.ts'), 'A-feature\n');
                assert.strictEqual(reconstructedText(mergedState, 'b.ts'), 'B-main\n');

                const other = await manager.createBranch('other', baselineId);
                assert.ok(other);
                await fs.writeFile(fileA, 'A-other\n');
                await manager.createManualCheckpoint({ description: 'other a' });

                await manager.switchBranch(feature.id);
                const conflicted = await manager.mergeBranches(other.id, feature.id);
                assert.strictEqual(conflicted.success, false);
                assert.ok(conflicted.conflicts.some((conflict: { path: string }) => conflict.path === 'a.ts'));
                assert.ok(!conflicted.mergeCheckpointId);
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });
});
