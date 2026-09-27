import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { CheckpointManager } from './CheckpointManager';
import { generateCheckpointId } from './checkpointId';
import { CHECKPOINT_SCHEMA_VERSION, computeCheckpointContentSha256 } from './store/checkpointIntegrity';
import {
    CheckpointBundleError,
    CheckpointWorkspaceMismatchError,
    sealCheckpointBundle,
} from './store/checkpointBundle';

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
    manager.extensionContext = undefined;

    try {
        await fn(manager);
    } finally {
        Object.assign(manager, backup);
    }
}

function stateMap(state: Map<string, { content: string }> | null): Record<string, string> {
    assert.ok(state, 'Expected a reconstructed checkpoint tree');
    const files: Record<string, string> = {};
    for (const [relativePath, resolved] of state) {
        files[relativePath] = resolved.content;
    }
    return files;
}

suite('Checkpoint import/export integrity (CP-22)', () => {
    test('export → import round-trip restores the same reconstructed trees', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-bundle-${Date.now()}`);
        const exportStore = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-export-'));
        const importStore = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-import-'));
        const bundlePath = path.join(exportStore, 'bundle.knoxcp.json');
        const fileA = path.join(fixtureRoot, 'src', 'a.ts');
        const fileB = path.join(fixtureRoot, 'src', 'b.ts');

        await fs.mkdir(path.join(fixtureRoot, 'src'), { recursive: true });
        await fs.writeFile(fileA, 'export const a = 1;\n');
        await fs.writeFile(fileB, 'export const b = 1;\n');

        try {
            let baselineId = '';
            let deltaId = '';
            let baselineTree: Record<string, string> = {};
            let deltaTree: Record<string, string> = {};

            await withIsolatedManager(fixtureRoot, exportStore, async (manager) => {
                baselineId = await manager.createManualCheckpoint({ description: 'baseline' });
                assert.ok(baselineId);
                await fs.writeFile(fileB, 'export const b = 2;\n');
                deltaId = await manager.createManualCheckpoint({ description: 'after edit' });
                assert.ok(deltaId);
                baselineTree = stateMap(await manager.reconstructStateAtCheckpoint(baselineId));
                deltaTree = stateMap(await manager.reconstructStateAtCheckpoint(deltaId));
                await manager.exportCheckpoints(bundlePath);
            });

            await fs.writeFile(fileA, 'export const a = 999;\n');
            await fs.writeFile(fileB, 'export const b = 999;\n');

            await withIsolatedManager(fixtureRoot, importStore, async (manager) => {
                const imported = await manager.importCheckpoints(bundlePath, { merge: false });
                assert.strictEqual(imported, 2);
                assert.strictEqual(manager.checkpointHistory.length, 2);
                assert.deepStrictEqual(
                    stateMap(await manager.reconstructStateAtCheckpoint(baselineId)),
                    baselineTree,
                );
                assert.deepStrictEqual(
                    stateMap(await manager.reconstructStateAtCheckpoint(deltaId)),
                    deltaTree,
                );

                const restore = await manager.restoreCheckpoint(deltaId, {
                    createBackup: false,
                    conflictResolution: 'overwrite',
                    cleanupExtraFiles: false,
                });
                assert.strictEqual(restore.success, true);
                assert.strictEqual(await fs.readFile(fileA, 'utf8'), 'export const a = 1;\n');
                assert.strictEqual(await fs.readFile(fileB, 'utf8'), 'export const b = 2;\n');
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(exportStore, { recursive: true, force: true });
            await fs.rm(importStore, { recursive: true, force: true });
        }
    });

    test('truncated or tampered bundles are rejected and do not write history', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-bundle-tamper-${Date.now()}`);
        const exportStore = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-tamper-'));
        const importStore = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-tamper-in-'));
        const bundlePath = path.join(exportStore, 'bundle.knoxcp.json');

        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'keep.ts'), 'export const k = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, exportStore, async (manager) => {
                const id = await manager.createManualCheckpoint({ description: 'keep' });
                assert.ok(id);
                await manager.exportCheckpoints(bundlePath);
            });

            const original = await fs.readFile(bundlePath, 'utf8');
            await fs.writeFile(bundlePath, original.slice(0, Math.floor(original.length / 2)));

            await withIsolatedManager(fixtureRoot, importStore, async (manager) => {
                await assert.rejects(
                    () => manager.importCheckpoints(bundlePath),
                    (error: unknown) => error instanceof CheckpointBundleError && error.code === 'TRUNCATED',
                );
                assert.strictEqual(manager.checkpointHistory.length, 0);
            });

            const parsed = JSON.parse(original);
            parsed.blobs[0].data = Buffer.from('nope').toString('base64');
            await fs.writeFile(bundlePath, JSON.stringify(parsed, null, 2));

            await withIsolatedManager(fixtureRoot, importStore, async (manager) => {
                await assert.rejects(
                    () => manager.importCheckpoints(bundlePath),
                    (error: unknown) =>
                        error instanceof CheckpointBundleError && error.code === 'CHECKSUM_MISMATCH',
                );
                assert.strictEqual(manager.checkpointHistory.length, 0);
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(exportStore, { recursive: true, force: true });
            await fs.rm(importStore, { recursive: true, force: true });
        }
    });

    test('import of a crafted bundle cannot escape the workspace', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-escape-'));
        const bundlePath = path.join(storagePath, 'evil.knoxcp.json');
        const checkpointId = generateCheckpointId();
        const checkpoint = {
            id: checkpointId,
            description: 'evil',
            created: new Date().toISOString(),
            schemaVersion: CHECKPOINT_SCHEMA_VERSION,
            fileInventory: ['../outside.txt'],
            fileSnapshots: [{
                relativePath: '../outside.txt',
                encoding: 'utf8',
                lastModified: new Date().toISOString(),
                size: 0,
                deleted: true,
                changeType: 'deleted' as const,
            }],
        };
        const bundle = sealCheckpointBundle({
            exportedAt: new Date().toISOString(),
            workspaceHint: workspaceFolder.uri.fsPath,
            checkpointIds: [checkpointId],
            messageCheckpoints: {},
            stableIdCheckpoints: {},
            checkpoints: [{
                ...checkpoint,
                contentSha256: computeCheckpointContentSha256(checkpoint),
            }],
            blobs: [],
        });
        await fs.writeFile(bundlePath, JSON.stringify(bundle, null, 2));

        try {
            await withIsolatedManager(workspaceFolder.uri.fsPath, storagePath, async (manager) => {
                await assert.rejects(
                    () => manager.importCheckpoints(bundlePath, { allowWorkspaceMismatch: true }),
                    /escape/,
                );
                assert.strictEqual(manager.checkpointHistory.length, 0);
            });
        } finally {
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('wrong-workspace bundles require an explicit mismatch override', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-bundle-ws-${Date.now()}`);
        const otherRoot = path.join(workspaceFolder.uri.fsPath, `cp-bundle-other-${Date.now()}`);
        const exportStore = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-ws-ex-'));
        const importStore = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-ws-in-'));
        const bundlePath = path.join(exportStore, 'bundle.knoxcp.json');

        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.mkdir(otherRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'keep.ts'), 'export const k = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, exportStore, async (manager) => {
                const id = await manager.createManualCheckpoint({ description: 'ws' });
                assert.ok(id);
                await manager.exportCheckpoints(bundlePath);
            });

            await withIsolatedManager(otherRoot, importStore, async (manager) => {
                await assert.rejects(
                    () => manager.importCheckpoints(bundlePath),
                    (error: unknown) => error instanceof CheckpointWorkspaceMismatchError,
                );
                assert.strictEqual(manager.checkpointHistory.length, 0);

                const imported = await manager.importCheckpoints(bundlePath, {
                    allowWorkspaceMismatch: true,
                });
                assert.strictEqual(imported, 1);
                assert.strictEqual(manager.checkpointHistory.length, 1);
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(otherRoot, { recursive: true, force: true });
            await fs.rm(exportStore, { recursive: true, force: true });
            await fs.rm(importStore, { recursive: true, force: true });
        }
    });

    test('merge collisions and remapIds allocate new checkpoint ids', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-bundle-ids-${Date.now()}`);
        const store = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-ids-'));
        const bundlePath = path.join(store, 'bundle.knoxcp.json');

        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'keep.ts'), 'export const k = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, store, async (manager) => {
                const originalId = await manager.createManualCheckpoint({ description: 'original' });
                assert.ok(originalId);
                await manager.exportCheckpoints(bundlePath);

                const collided = await manager.importCheckpoints(bundlePath, { merge: true });
                assert.strictEqual(collided, 1);
                assert.strictEqual(manager.checkpointHistory.length, 2);
                const ids = manager.checkpointHistory.map((checkpoint: { id: string }) => checkpoint.id);
                assert.ok(ids.includes(originalId));
                assert.ok(ids.some((id: string) => id !== originalId));

                const remapped = await manager.importCheckpoints(bundlePath, {
                    merge: true,
                    remapIds: true,
                });
                assert.strictEqual(remapped, 1);
                assert.strictEqual(manager.checkpointHistory.length, 3);
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(store, { recursive: true, force: true });
        }
    });

    test('import rejects bundles that exceed maxStorageBytes', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-bundle-quota-${Date.now()}`);
        const exportStore = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-quota-ex-'));
        const importStore = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-quota-in-'));
        const bundlePath = path.join(exportStore, 'bundle.knoxcp.json');

        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'keep.ts'), `${'x'.repeat(2048)}\n`);

        try {
            await withIsolatedManager(fixtureRoot, exportStore, async (manager) => {
                const id = await manager.createManualCheckpoint({ description: 'quota' });
                assert.ok(id);
                await manager.exportCheckpoints(bundlePath);
            });

            await withIsolatedManager(fixtureRoot, importStore, async (manager) => {
                manager.maxStorageBytes = 64;
                await assert.rejects(
                    () => manager.importCheckpoints(bundlePath),
                    (error: unknown) => error instanceof CheckpointBundleError && error.code === 'TOO_LARGE',
                );
                assert.strictEqual(manager.checkpointHistory.length, 0);
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(exportStore, { recursive: true, force: true });
            await fs.rm(importStore, { recursive: true, force: true });
        }
    });
});
