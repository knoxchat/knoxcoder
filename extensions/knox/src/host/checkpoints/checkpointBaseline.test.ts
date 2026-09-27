import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { isCheckpointId } from './checkpointId';
import { CheckpointManager, listedCheckpointFileCount } from './CheckpointManager';
import { recoverIncompleteRestore, setRestoreTestHooks } from './manager/restore';
import {
    CHECKPOINT_INDEX_VERSION,
    getCheckpointIndexPath,
    loadCheckpointHistory,
} from './manager/persistence';
import { getRestoreJournalPath, writeRestoreJournal } from './manager/restoreJournal';
import { BLOB_COMPRESS_THRESHOLD } from './store/blobStore';

async function listStoredBlobs(storagePath: string): Promise<string[]> {
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

suite('Checkpoint baseline, sandbox, and ignore', () => {
    test('manual checkpoint captures pre-existing files and restores unmodified ones', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(
            workspaceFolder.uri.fsPath,
            `cp-baseline-${Date.now()}`,
        );
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-store-'));
        const untouched = path.join(fixtureRoot, 'src', 'untouched.ts');
        const willEdit = path.join(fixtureRoot, 'src', 'will-edit.ts');
        const secret = path.join(fixtureRoot, '.env');

        await fs.mkdir(path.join(fixtureRoot, 'src'), { recursive: true });
        await fs.writeFile(untouched, 'export const a = 1;\n');
        await fs.writeFile(willEdit, 'export const b = 1;\n');
        await fs.writeFile(secret, 'SECRET=super-secret\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                // Files already exist; session start is now — old delta capture would skip them.
                manager.sessionStartTime = Date.now();
                manager.lastCheckpointTime = Date.now();

                const baselineId = await manager.createManualCheckpoint({
                    description: 'Baseline of untouched workspace',
                });
                assert.ok(baselineId, 'Expected a baseline checkpoint even with no post-session edits');
                assert.ok(isCheckpointId(baselineId));

                const baseline = manager.checkpointHistory.find((cp: any) => cp.id === baselineId);
                assert.ok(baseline);
                assert.strictEqual(baseline.captureMode, 'baseline');
                assert.ok(!baseline.fileSnapshots);
                const detailed = await manager.getCheckpointWithSnapshots(baselineId);
                assert.ok(detailed);
                const snapshotPaths = (detailed.fileSnapshots || []).map(
                    (snapshot: any) => snapshot.relativePath,
                );
                assert.ok(snapshotPaths.includes(path.join('src', 'untouched.ts')));
                assert.ok(snapshotPaths.includes(path.join('src', 'will-edit.ts')));
                assert.ok(!snapshotPaths.includes('.env'), '.env must not be snapshotted');

                await fs.writeFile(willEdit, 'export const b = 2;\n');
                await fs.writeFile(untouched, 'export const a = 999;\n');

                const deltaId = await manager.createManualCheckpoint({
                    description: 'After edits',
                });
                assert.ok(deltaId);
                const delta = manager.checkpointHistory.find((cp: any) => cp.id === deltaId);
                assert.strictEqual(delta.captureMode, 'delta');

                const restore = await manager.restoreCheckpoint(baselineId, {
                    createBackup: false,
                    conflictResolution: 'overwrite',
                    cleanupExtraFiles: false,
                });
                assert.strictEqual(restore.success, true);
                assert.strictEqual(await fs.readFile(untouched, 'utf8'), 'export const a = 1;\n');
                assert.strictEqual(await fs.readFile(willEdit, 'utf8'), 'export const b = 1;\n');
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('turn checkpoint stores a reconstructable baseline tree', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(
            workspaceFolder.uri.fsPath,
            `cp-turn-${Date.now()}`,
        );
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-store-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'app.ts'), 'export const n = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                manager.sessionStartTime = Date.now();
                manager.lastCheckpointTime = Date.now();

                const turnId = await manager.ensureTurnCheckpoint({
                    sessionId: 'session-1',
                    turnId: 'turn-1',
                    toolName: 'builtin_edit_file',
                });
                assert.ok(turnId);
                const checkpoint = manager.checkpointHistory.find((cp: any) => cp.id === turnId);
                assert.ok(checkpoint);
                assert.strictEqual(checkpoint.captureMode, 'baseline');
                const detailed = await manager.getCheckpointWithSnapshots(turnId);
                assert.ok(
                    (detailed?.fileSnapshots || []).some(
                        (snapshot: any) => snapshot.relativePath === 'app.ts',
                    ),
                );
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('restore refuses paths that escape the workspace', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(
            workspaceFolder.uri.fsPath,
            `cp-sandbox-${Date.now()}`,
        );
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-store-'));
        await fs.mkdir(fixtureRoot, { recursive: true });

        const escapedPath = path.resolve(fixtureRoot, '..', 'outside-knox-cp.txt');
        await fs.rm(escapedPath, { force: true });

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const evil = {
                    id: 'cp-evil-escape',
                    description: 'Crafted escape',
                    created: new Date(),
                    workspacePath: fixtureRoot,
                    fileSnapshots: [{
                        relativePath: '../outside-knox-cp.txt',
                        content: 'pwned',
                        encoding: 'utf8',
                        lastModified: new Date(),
                        size: 5,
                        changeType: 'created' as const,
                    }],
                    fileInventory: ['../outside-knox-cp.txt'],
                    captureMode: 'baseline' as const,
                };
                manager.checkpointHistory = [evil];
                manager.loadCheckpointFromDisk = async () => evil;

                const result = await manager.restoreCheckpoint(evil.id, {
                    createBackup: false,
                    conflictResolution: 'overwrite',
                    cleanupExtraFiles: false,
                });

                assert.ok(
                    result.failedFiles.some((file: { path: string }) =>
                        file.path.includes('outside-knox-cp.txt'),
                    ),
                );
                await assert.rejects(fs.access(escapedPath));
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
            await fs.rm(escapedPath, { force: true });
        }
    });

    test('import rejects a bundle that escapes the workspace', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-store-'));
        const bundlePath = path.join(storagePath, 'evil.json');
        await fs.writeFile(
            bundlePath,
            JSON.stringify({
                checkpoints: [{
                    id: 'cp-imported-evil',
                    description: 'evil',
                    created: new Date().toISOString(),
                    workspacePath: workspaceFolder.uri.fsPath,
                    fileSnapshots: [{
                        relativePath: '/etc/passwd',
                        content: 'root:x:0:0:root:/root:/bin/sh',
                        encoding: 'utf8',
                        lastModified: new Date().toISOString(),
                        size: 10,
                    }],
                }],
            }),
        );

        try {
            await withIsolatedManager(
                workspaceFolder.uri.fsPath,
                storagePath,
                async (manager) => {
                    await assert.rejects(
                        () => manager.importCheckpoints(bundlePath),
                        /escape/,
                    );
                    assert.strictEqual(manager.checkpointHistory.length, 0);
                },
            );
        } finally {
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('pre-restore backup is created even when the delta scan is empty', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(
            workspaceFolder.uri.fsPath,
            `cp-backup-${Date.now()}`,
        );
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-store-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'keep.ts'), 'export const k = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const baselineId = await manager.createManualCheckpoint({
                    description: 'baseline',
                });
                assert.ok(baselineId);
                const before = manager.checkpointHistory.length;

                const backupId = await manager.createManualCheckpoint({
                    description: `Pre-restore backup for ${baselineId}`,
                    allowEmpty: true,
                });
                assert.ok(backupId, 'Backup must not no-op when nothing changed since baseline');
                assert.strictEqual(manager.checkpointHistory.length, before + 1);
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('tampered checkpoint JSON fails checksum and restore reports corruption', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(
            workspaceFolder.uri.fsPath,
            `cp-integrity-${Date.now()}`,
        );
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-store-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'keep.ts'), 'export const k = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const checkpointId = await manager.createManualCheckpoint({
                    description: 'integrity baseline',
                });
                assert.ok(checkpointId);

                const checkpointFile = path.join(storagePath, `${checkpointId}.json`);
                const raw = JSON.parse(await fs.readFile(checkpointFile, 'utf8'));
                assert.strictEqual(raw.schemaVersion, 2);
                assert.ok(typeof raw.contentSha256 === 'string' && raw.contentSha256.length === 64);
                assert.ok(raw.fileSnapshots[0].hash);
                assert.strictEqual(raw.fileSnapshots[0].content, undefined);
                raw.fileSnapshots[0].hash = 'tampered';
                await fs.writeFile(checkpointFile, JSON.stringify(raw, null, 2), 'utf8');

                await assert.rejects(
                    manager.restoreCheckpoint(checkpointId, {
                        createBackup: false,
                        conflictResolution: 'overwrite',
                        cleanupExtraFiles: false,
                    }),
                    /corrupt/i,
                );
                const issues = manager.getHealthIssues();
                assert.ok(
                    issues.some((issue: { kind: string; checkpointId?: string }) =>
                        issue.kind === 'corrupt' && issue.checkpointId === checkpointId,
                    ),
                );
                assert.strictEqual(
                    await fs.readFile(path.join(fixtureRoot, 'keep.ts'), 'utf8'),
                    'export const k = 1;\n',
                );
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('corrupt history index is rebuilt from on-disk manifests', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(
            workspaceFolder.uri.fsPath,
            `cp-rebuild-${Date.now()}`,
        );
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-store-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'keep.ts'), 'export const k = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const checkpointId = await manager.createManualCheckpoint({
                    description: 'rebuild source',
                });
                assert.ok(checkpointId);
                manager.checkpointHistory = [];
                manager.messageCheckpoints = {};

                const rebuilt = await manager.rebuildHistoryFromManifests();
                assert.strictEqual(rebuilt, true);
                const rebuiltCp = manager.checkpointHistory.find((cp: { id: string }) => cp.id === checkpointId);
                assert.ok(rebuiltCp);
                assert.ok(!rebuiltCp.fileSnapshots);
                assert.ok(rebuiltCp.fileStats);
                assert.ok((rebuiltCp.fileStats.inventoryCount ?? 0) >= 1);
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('injected write failure rolls back to the pre-restore tree and skips extra deletes', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(
            workspaceFolder.uri.fsPath,
            `cp-txn-${Date.now()}`,
        );
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-store-'));
        const fileA = path.join(fixtureRoot, 'a.ts');
        const fileB = path.join(fixtureRoot, 'b.ts');
        const extra = path.join(fixtureRoot, 'extra.ts');

        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(fileA, 'export const a = "old";\n');
        await fs.writeFile(fileB, 'export const b = "old";\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const baselineId = await manager.createManualCheckpoint({ description: 'txn baseline' });
                assert.ok(baselineId);

                await fs.writeFile(fileA, 'export const a = "new";\n');
                await fs.writeFile(fileB, 'export const b = "new";\n');
                await fs.writeFile(extra, 'export const extra = 1;\n');

                setRestoreTestHooks({
                    beforeWrite: async (_relativePath, index) => {
                        if (index >= 1) {
                            throw new Error('injected failure');
                        }
                    },
                });

                const result = await manager.restoreCheckpoint(baselineId, {
                    conflictResolution: 'overwrite',
                });
                assert.strictEqual(result.success, false);
                assert.ok(result.failedFiles.some((file: { error: string }) => /injected failure/.test(file.error)));

                assert.strictEqual(await fs.readFile(fileA, 'utf8'), 'export const a = "new";\n');
                assert.strictEqual(await fs.readFile(fileB, 'utf8'), 'export const b = "new";\n');
                await fs.access(extra);

                try {
                    await fs.access(getRestoreJournalPath(manager));
                    assert.fail('restore journal should be cleared after rollback');
                } catch (error: any) {
                    assert.strictEqual(error.code, 'ENOENT');
                }
            });
        } finally {
            setRestoreTestHooks(undefined);
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('failed writes do not delete extra files when backup is skipped', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(
            workspaceFolder.uri.fsPath,
            `cp-txn-extras-${Date.now()}`,
        );
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-store-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'keep.ts'), 'export const k = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const baselineId = await manager.createManualCheckpoint({ description: 'extras baseline' });
                assert.ok(baselineId);
                await fs.writeFile(path.join(fixtureRoot, 'extra.ts'), 'export const extra = 1;\n');

                setRestoreTestHooks({
                    beforeWrite: async () => {
                        throw new Error('injected failure');
                    },
                });

                const result = await manager.restoreCheckpoint(baselineId, {
                    createBackup: false,
                    conflictResolution: 'overwrite',
                });
                assert.strictEqual(result.success, false);
                assert.strictEqual(result.removedFiles.length, 0);
                await fs.access(path.join(fixtureRoot, 'extra.ts'));
            });
        } finally {
            setRestoreTestHooks(undefined);
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('startup journal recovery restores the pre-restore backup tree', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(
            workspaceFolder.uri.fsPath,
            `cp-journal-${Date.now()}`,
        );
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-store-'));
        const keep = path.join(fixtureRoot, 'keep.ts');
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(keep, 'export const k = "before";\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const backupId = await manager.createManualCheckpoint({ description: 'pre-restore backup' });
                assert.ok(backupId);
                await fs.writeFile(keep, 'export const k = "partial";\n');

                await writeRestoreJournal(manager, {
                    schemaVersion: 1,
                    checkpointId: 'cp-target',
                    backupCheckpointId: backupId,
                    startedAt: new Date().toISOString(),
                    plannedWrites: ['keep.ts'],
                    plannedDeletes: [],
                    completedWrites: ['keep.ts'],
                    status: 'writing',
                });

                await recoverIncompleteRestore(manager);
                assert.strictEqual(await fs.readFile(keep, 'utf8'), 'export const k = "before";\n');
                try {
                    await fs.access(getRestoreJournalPath(manager));
                    assert.fail('journal should be removed after recovery');
                } catch (error: any) {
                    assert.strictEqual(error.code, 'ENOENT');
                }
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('listed file count uses inventory, not the delta snapshot length', () => {
        assert.strictEqual(
            listedCheckpointFileCount({
                fileInventory: ['a.ts', 'b.ts', 'c.ts'],
                fileSnapshots: [{
                    relativePath: 'b.ts',
                    content: 'changed',
                    encoding: 'utf8',
                    lastModified: new Date(),
                    size: 7,
                    changeType: 'modified',
                }],
            }),
            3,
        );
        assert.strictEqual(
            listedCheckpointFileCount({
                fileSnapshots: [
                    {
                        relativePath: 'keep.ts',
                        content: 'ok',
                        encoding: 'utf8',
                        lastModified: new Date(),
                        size: 2,
                    },
                    {
                        relativePath: 'gone.ts',
                        content: '',
                        encoding: 'utf8',
                        lastModified: new Date(),
                        size: 0,
                        deleted: true,
                    },
                ],
            }),
            1,
        );
        assert.strictEqual(
            listedCheckpointFileCount({
                fileStats: {
                    total: 1,
                    created: 0,
                    deleted: 0,
                    modified: 1,
                    inventoryCount: 4,
                },
            }),
            4,
        );
    });

    test('two checkpoints with the same file share one blob and JSON has no inlined content', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(
            workspaceFolder.uri.fsPath,
            `cp-cas-${Date.now()}`,
        );
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-cas-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'shared.ts'), 'export const shared = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const firstId = await manager.createManualCheckpoint({ description: 'cas first' });
                const secondId = await manager.createManualCheckpoint({
                    description: 'cas second',
                    forceBaseline: true,
                });
                assert.ok(firstId);
                assert.ok(secondId);

                const firstRaw = JSON.parse(
                    await fs.readFile(path.join(storagePath, `${firstId}.json`), 'utf8'),
                );
                const secondRaw = JSON.parse(
                    await fs.readFile(path.join(storagePath, `${secondId}.json`), 'utf8'),
                );
                assert.strictEqual(firstRaw.schemaVersion, 2);
                assert.strictEqual(secondRaw.schemaVersion, 2);
                assert.strictEqual(firstRaw.fileSnapshots[0].content, undefined);
                assert.strictEqual(secondRaw.fileSnapshots[0].content, undefined);
                assert.strictEqual(firstRaw.fileSnapshots[0].hash, secondRaw.fileSnapshots[0].hash);

                const blobs = await listStoredBlobs(storagePath);
                assert.strictEqual(blobs.length, 1);
                assert.ok(!blobs[0].endsWith('.gz'), 'small files stay uncompressed');
                const usage = await manager.getStorageUsage();
                const jsonBytes =
                    (await fs.stat(path.join(storagePath, `${firstId}.json`))).size +
                    (await fs.stat(path.join(storagePath, `${secondId}.json`))).size;
                assert.ok(
                    usage.totalBytes > jsonBytes,
                    'storage usage must include object files as well as manifests',
                );

                await fs.writeFile(path.join(fixtureRoot, 'shared.ts'), 'export const shared = 2;\n');
                const restore = await manager.restoreCheckpoint(firstId, {
                    createBackup: false,
                    conflictResolution: 'overwrite',
                    cleanupExtraFiles: false,
                });
                assert.strictEqual(restore.success, true);
                assert.strictEqual(
                    await fs.readFile(path.join(fixtureRoot, 'shared.ts'), 'utf8'),
                    'export const shared = 1;\n',
                );
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('enableCompression stores gzip for large blobs and raw when disabled', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(
            workspaceFolder.uri.fsPath,
            `cp-gz-${Date.now()}`,
        );
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-gz-'));
        const largeBody = `${'x'.repeat(BLOB_COMPRESS_THRESHOLD + 32)}\n`;
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'large.ts'), `export const blob = "${largeBody}";\n`);

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                manager.enableCompression = true;
                const compressedId = await manager.createManualCheckpoint({
                    description: 'compressed',
                });
                assert.ok(compressedId);
                const gzBlobs = await listStoredBlobs(storagePath);
                assert.ok(gzBlobs.some((name) => name.endsWith('.gz')));

                await fs.writeFile(path.join(fixtureRoot, 'large.ts'), 'export const blob = "changed";\n');
                const restoreCompressed = await manager.restoreCheckpoint(compressedId, {
                    createBackup: false,
                    conflictResolution: 'overwrite',
                    cleanupExtraFiles: false,
                });
                assert.strictEqual(restoreCompressed.success, true);
                assert.ok((await fs.readFile(path.join(fixtureRoot, 'large.ts'), 'utf8')).includes(largeBody));

                await manager.removeFromHistoryAndDisk(compressedId);
                manager.checkpointHistory = [];
                manager.lastSnapshotHashes = new Map();
                manager.enableCompression = false;
                await fs.writeFile(path.join(fixtureRoot, 'large.ts'), `export const blob = "${largeBody}";\n`);
                const rawId = await manager.createManualCheckpoint({
                    description: 'uncompressed',
                    forceBaseline: true,
                });
                assert.ok(rawId);
                const rawBlobs = await listStoredBlobs(storagePath);
                assert.ok(rawBlobs.length > 0);
                assert.ok(rawBlobs.every((name) => !name.endsWith('.gz')));

                await fs.writeFile(path.join(fixtureRoot, 'large.ts'), 'export const blob = "changed-again";\n');
                const restoreRaw = await manager.restoreCheckpoint(rawId, {
                    createBackup: false,
                    conflictResolution: 'overwrite',
                    cleanupExtraFiles: false,
                });
                assert.strictEqual(restoreRaw.success, true);
                assert.ok((await fs.readFile(path.join(fixtureRoot, 'large.ts'), 'utf8')).includes(largeBody));
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('deleting a checkpoint GCs unreferenced blobs but keeps shared ones', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(
            workspaceFolder.uri.fsPath,
            `cp-gc-${Date.now()}`,
        );
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-gc-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'keep.ts'), 'export const keep = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const firstId = await manager.createManualCheckpoint({ description: 'gc first' });
                assert.ok(firstId);
                await fs.writeFile(path.join(fixtureRoot, 'keep.ts'), 'export const keep = 2;\n');
                const secondId = await manager.createManualCheckpoint({ description: 'gc second' });
                assert.ok(secondId);

                const beforeDelete = await listStoredBlobs(storagePath);
                assert.strictEqual(beforeDelete.length, 2);

                const removed = await manager.removeFromHistoryAndDisk(secondId);
                assert.strictEqual(removed, true);
                const afterSecond = await listStoredBlobs(storagePath);
                assert.strictEqual(afterSecond.length, 1);

                const removedFirst = await manager.removeFromHistoryAndDisk(firstId);
                assert.strictEqual(removedFirst, true);
                const afterFirst = await listStoredBlobs(storagePath);
                assert.deepStrictEqual(afterFirst, []);
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('restore hydrates file bytes from blobs when in-memory content is stripped', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(
            workspaceFolder.uri.fsPath,
            `cp-hydrate-${Date.now()}`,
        );
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-hydrate-'));
        const filePath = path.join(fixtureRoot, 'keep.ts');
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(filePath, 'export const k = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const checkpointId = await manager.createManualCheckpoint({ description: 'hydrate' });
                assert.ok(checkpointId);
                assert.ok(!manager.checkpointHistory.find((cp: any) => cp.id === checkpointId)?.fileSnapshots);
                await fs.writeFile(filePath, 'export const k = 999;\n');
                const restore = await manager.restoreCheckpoint(checkpointId, {
                    createBackup: false,
                    conflictResolution: 'overwrite',
                    cleanupExtraFiles: false,
                });
                assert.strictEqual(restore.success, true);
                assert.strictEqual(await fs.readFile(filePath, 'utf8'), 'export const k = 1;\n');
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('history index omits snapshots and stays small as blobs grow', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(
            workspaceFolder.uri.fsPath,
            `cp-index-${Date.now()}`,
        );
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-index-'));
        const body = `${'payload-'.repeat(2000)}\n`;
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'big.ts'), `export const data = \`${body}\`;\n`);

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const firstId = await manager.createManualCheckpoint({ description: 'index first' });
                assert.ok(firstId);
                await fs.writeFile(path.join(fixtureRoot, 'big.ts'), `export const data = \`${body}changed\`;\n`);
                const secondId = await manager.createManualCheckpoint({ description: 'index second' });
                assert.ok(secondId);

                const indexPath = getCheckpointIndexPath(manager);
                const indexRaw = JSON.parse(await fs.readFile(indexPath, 'utf8'));
                assert.strictEqual(indexRaw.indexVersion, CHECKPOINT_INDEX_VERSION);
                assert.strictEqual(indexRaw.checkpointHistory.length, 2);
                for (const entry of indexRaw.checkpointHistory) {
                    assert.strictEqual(entry.fileSnapshots, undefined);
                    assert.strictEqual(entry.fileInventory, undefined);
                    assert.ok(entry.fileStats);
                    assert.ok((entry.fileStats.inventoryCount ?? 0) >= 1);
                }

                const indexBytes = (await fs.stat(indexPath)).size;
                const usage = await manager.getStorageUsage();
                assert.ok(indexBytes < 8_192, `index should stay small, got ${indexBytes} bytes`);
                assert.ok(usage.totalBytes > indexBytes * 2);

                const inMemory = manager.checkpointHistory.find((cp: { id: string }) => cp.id === firstId);
                assert.ok(inMemory?.fileStats);
                assert.ok(!inMemory.fileSnapshots);
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('deleting the index and reloading rebuilds the list from manifests', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(
            workspaceFolder.uri.fsPath,
            `cp-index-reload-${Date.now()}`,
        );
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-index-reload-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'keep.ts'), 'export const k = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const checkpointId = await manager.createManualCheckpoint({ description: 'index source' });
                assert.ok(checkpointId);
                const indexPath = getCheckpointIndexPath(manager);
                await fs.access(indexPath);

                await fs.rm(indexPath);
                manager.checkpointHistory = [];
                manager.messageCheckpoints = {};
                manager.stableIdCheckpoints = {};

                const context = {
                    globalStorageUri: { fsPath: path.join(storagePath, 'global-storage') },
                    globalState: {
                        get: () => undefined,
                        update: async () => undefined,
                    },
                } as unknown as vscode.ExtensionContext;
                manager.extensionContext = context;
                await loadCheckpointHistory(manager, context);

                const restored = manager.checkpointHistory.find((cp: { id: string }) => cp.id === checkpointId);
                assert.ok(restored);
                assert.ok(!restored.fileSnapshots);
                assert.ok(restored.fileStats);
                assert.strictEqual(restored.description, 'index source');
                await fs.access(indexPath);
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });
});

suite('Checkpoint retention, fold safety, and quotas', () => {
    test('evicting the oldest checkpoint still restores files only present in that baseline', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-fold-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-fold-'));
        const baselineOnly = path.join(fixtureRoot, 'only-in-baseline.ts');
        const shared = path.join(fixtureRoot, 'shared.ts');

        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(baselineOnly, 'export const unique = "baseline";\n');
        await fs.writeFile(shared, 'export const shared = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const baselineId = await manager.createManualCheckpoint({
                    description: 'baseline with unique file',
                });
                assert.ok(baselineId);

                await fs.writeFile(shared, 'export const shared = 2;\n');
                const newestId = await manager.createManualCheckpoint({
                    description: 'delta after shared edit',
                });
                assert.ok(newestId);

                manager.maxCheckpoints = 1;
                await manager.enforceRetentionPolicies();

                assert.strictEqual(manager.checkpointHistory.length, 1);
                assert.strictEqual(manager.checkpointHistory[0].id, newestId);
                assert.ok(!manager.checkpointHistory.some((cp: { id: string }) => cp.id === baselineId));

                await fs.writeFile(baselineOnly, 'export const unique = "clobbered";\n');
                await fs.writeFile(shared, 'export const shared = 999;\n');

                const restore = await manager.restoreCheckpoint(newestId, {
                    createBackup: false,
                    conflictResolution: 'overwrite',
                    cleanupExtraFiles: false,
                });
                assert.strictEqual(restore.success, true);
                assert.strictEqual(
                    await fs.readFile(baselineOnly, 'utf8'),
                    'export const unique = "baseline";\n',
                );
                assert.strictEqual(await fs.readFile(shared, 'utf8'), 'export const shared = 2;\n');
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('retention never deletes a pinned checkpoint or the last remaining one', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-pin-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-pin-'));
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'a.ts'), 'export const n = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const firstId = await manager.createManualCheckpoint({ description: 'first' });
                assert.ok(firstId);
                await fs.writeFile(path.join(fixtureRoot, 'a.ts'), 'export const n = 2;\n');
                const secondId = await manager.createManualCheckpoint({ description: 'second' });
                assert.ok(secondId);
                await fs.writeFile(path.join(fixtureRoot, 'a.ts'), 'export const n = 3;\n');
                const thirdId = await manager.createManualCheckpoint({ description: 'third' });
                assert.ok(thirdId);

                const pinned = await manager.setCheckpointPinned(firstId, true);
                assert.strictEqual(pinned, true);
                assert.strictEqual(
                    manager.checkpointHistory.find((cp: { id: string }) => cp.id === firstId)?.pinned,
                    true,
                );

                manager.maxCheckpoints = 1;
                await manager.enforceRetentionPolicies();

                const remainingIds = manager.checkpointHistory.map((cp: { id: string }) => cp.id);
                assert.ok(remainingIds.includes(firstId), 'pinned checkpoint must survive max-count eviction');
                assert.ok(!remainingIds.includes(secondId));
                assert.strictEqual(remainingIds.length >= 1, true);

                manager.maxCheckpoints = 1;
                await manager.enforceRetentionPolicies();
                assert.ok(
                    manager.checkpointHistory.some((cp: { id: string }) => cp.id === firstId),
                    'sole remaining / pinned checkpoint is not deleted',
                );
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('storage quota deletes oldest unpinned checkpoints first', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-quota-${Date.now()}`);
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-quota-'));
        const payload = `${'blob-payload-'.repeat(400)}\n`;
        await fs.mkdir(fixtureRoot, { recursive: true });
        await fs.writeFile(path.join(fixtureRoot, 'blob.ts'), `export const data = \`${payload}-1\`;\n`);

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                manager.enableCompression = false;
                const firstId = await manager.createManualCheckpoint({ description: 'quota first' });
                assert.ok(firstId);
                await fs.writeFile(path.join(fixtureRoot, 'blob.ts'), `export const data = \`${payload}-2\`;\n`);
                const secondId = await manager.createManualCheckpoint({ description: 'quota second' });
                assert.ok(secondId);
                await fs.writeFile(path.join(fixtureRoot, 'blob.ts'), `export const data = \`${payload}-3\`;\n`);
                const thirdId = await manager.createManualCheckpoint({ description: 'quota third' });
                assert.ok(thirdId);

                await manager.setCheckpointPinned(firstId, true);
                const usage = (await manager.getStorageUsage()).totalBytes;
                assert.ok(usage > 0);
                manager.maxStorageBytes = Math.max(1, Math.floor(usage * 0.85));
                await manager.enforceRetentionPolicies();

                const remainingIds = manager.checkpointHistory.map((cp: { id: string }) => cp.id);
                assert.ok(remainingIds.includes(firstId), 'pinned oldest must not be evicted by storage quota');
                assert.ok(remainingIds.includes(thirdId), 'newest checkpoint should remain');
                assert.ok(!remainingIds.includes(secondId), 'oldest unpinned checkpoint should be evicted first');
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });
});

suite('Checkpoint workspace isolation', () => {
    test('two folders with the same relative files use separate stores and both get checkpointed', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(workspaceFolder.uri.fsPath, `cp-iso-${Date.now()}`);
        const folderA = path.join(fixtureRoot, 'proj-a');
        const folderB = path.join(fixtureRoot, 'proj-b');
        await fs.mkdir(path.join(folderA, 'src'), { recursive: true });
        await fs.mkdir(path.join(folderB, 'src'), { recursive: true });
        await fs.writeFile(path.join(folderA, 'src', 'app.ts'), 'export const name = "a";\n');
        await fs.writeFile(path.join(folderB, 'src', 'app.ts'), 'export const name = "b";\n');

        const dummyStore = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-iso-'));

        try {
            await withIsolatedManager(folderA, dummyStore, async (manager) => {
                manager.workspaceFolderPaths = [folderA, folderB];
                manager.getStoragePath = function getStoragePath() {
                    return path.join(this.currentWorkspacePath, '.knox-debug', 'checkpoints');
                };

                await manager.switchWorkspaceFolder(folderA);
                const created = await manager.createManualCheckpoint({
                    description: 'multi-root capture',
                    forceBaseline: true,
                });
                assert.ok(created);

                const storeA = path.join(folderA, '.knox-debug', 'checkpoints');
                const storeB = path.join(folderB, '.knox-debug', 'checkpoints');
                const blobsA = await listStoredBlobs(storeA);
                const blobsB = await listStoredBlobs(storeB);
                assert.ok(blobsA.length > 0, 'folder A must have its own blobs');
                assert.ok(blobsB.length > 0, 'folder B must be checkpointed, not only folders[0]');
                assert.notDeepStrictEqual(blobsA, blobsB, 'identical relative paths must not share blob ids');

                const gitignore = await fs.readFile(path.join(folderA, '.knox-debug', '.gitignore'), 'utf8');
                assert.ok(gitignore.includes('*'));

                await manager.switchWorkspaceFolder(folderA);
                const historyA = manager.getCheckpointHistoryForWorkspace(folderA);
                await manager.switchWorkspaceFolder(folderB);
                const historyB = manager.getCheckpointHistoryForWorkspace(folderB);
                assert.ok(historyA.length >= 1);
                assert.ok(historyB.length >= 1);
                assert.notStrictEqual(historyA[0].id, historyB[0].id);
                assert.notStrictEqual(historyA[0].workspaceKey, historyB[0].workspaceKey);

                await fs.writeFile(path.join(folderB, 'src', 'app.ts'), 'export const name = "b-edited";\n');
                const restore = await manager.restoreCheckpoint(historyB[0].id, {
                    createBackup: false,
                    conflictResolution: 'overwrite',
                    cleanupExtraFiles: false,
                });
                assert.strictEqual(restore.success, true);
                assert.strictEqual(
                    await fs.readFile(path.join(folderB, 'src', 'app.ts'), 'utf8'),
                    'export const name = "b";\n',
                );
                assert.strictEqual(
                    await fs.readFile(path.join(folderA, 'src', 'app.ts'), 'utf8'),
                    'export const name = "a";\n',
                    'restoring folder B must not rewrite folder A',
                );
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(dummyStore, { recursive: true, force: true });
        }
    });

    test('baseline captures files nested more than 10 directories deep', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(
            workspaceFolder.uri.fsPath,
            `cp-deep-${Date.now()}`,
        );
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-store-'));
        const nestedParts = Array.from({ length: 12 }, (_, i) => `d${i}`);
        const deepDir = path.join(fixtureRoot, ...nestedParts);
        const deepFile = path.join(deepDir, 'deep.ts');
        const deepRelative = path.join(...nestedParts, 'deep.ts');

        await fs.mkdir(deepDir, { recursive: true });
        await fs.writeFile(deepFile, 'export const deep = 12;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const baselineId = await manager.createManualCheckpoint({
                    description: 'Deep tree baseline',
                });
                assert.ok(baselineId);
                const detailed = await manager.getCheckpointWithSnapshots(baselineId);
                assert.ok(
                    (detailed?.fileSnapshots || []).some(
                        (snapshot: { relativePath: string }) => snapshot.relativePath === deepRelative,
                    ),
                    'files beyond 10 directory levels must be snapshotted',
                );
                assert.ok(
                    detailed?.fileInventory?.includes(deepRelative),
                    'deep file must be in the reconstructable inventory',
                );
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('trusted watcher index captures an old-mtime edit without a full rescan', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Expected an active workspace folder');

        const fixtureRoot = path.join(
            workspaceFolder.uri.fsPath,
            `cp-watch-${Date.now()}`,
        );
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-cp-store-'));
        const tracked = path.join(fixtureRoot, 'src', 'app.ts');

        await fs.mkdir(path.join(fixtureRoot, 'src'), { recursive: true });
        await fs.writeFile(tracked, 'export const n = 1;\n');

        try {
            await withIsolatedManager(fixtureRoot, storagePath, async (manager) => {
                const baselineId = await manager.createManualCheckpoint({
                    description: 'watcher baseline',
                });
                assert.ok(baselineId);

                await fs.writeFile(tracked, 'export const n = 2;\n');
                const past = new Date(Date.now() - 120_000);
                await fs.utimes(tracked, past, past);
                manager.lastCheckpointTime = Date.now();
                manager.fileWatchers = [{ dispose() { /* test stub */ } }];
                manager.watcherTrusted = true;
                manager.recentlyModifiedFiles = new Set([tracked]);

                const deltaId = await manager.createManualCheckpoint({
                    description: 'watcher delta',
                });
                assert.ok(deltaId, 'watcher-indexed edit must produce a delta even when mtime is stale');
                const detailed = await manager.getCheckpointWithSnapshots(deltaId);
                const app = (detailed?.fileSnapshots || []).find(
                    (snapshot: { relativePath: string }) => snapshot.relativePath === path.join('src', 'app.ts'),
                );
                assert.ok(app);
                assert.ok(typeof app.content === 'string' && app.content.includes('n = 2'));
            });
        } finally {
            await fs.rm(fixtureRoot, { recursive: true, force: true });
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });
});
