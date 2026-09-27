/**
 * CP-34 — Integration tests against temp workspace fixtures.
 * Proves P0 restore/storage bugs without mocking the capture/restore engine.
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { listedCheckpointFileCount } from './CheckpointManager';
import { CheckpointChatIntegration } from './commands';
import { CheckpointConflictResolver } from './ConflictResolver';
import {
    listStoredBlobs,
    withTempCheckpointWorkspace,
} from './checkpointTestHarness';
import { setRestoreTestHooks } from './manager/restore';
import { BLOB_COMPRESS_THRESHOLD } from './store/blobStore';

const MINIMAL_PNG = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
    'hex',
);

type WindowMethodName = 'showWarningMessage' | 'showInformationMessage' | 'showErrorMessage';

const originalWindowMethods: Partial<Record<WindowMethodName, unknown>> = {};

function mockWindowMethod(name: WindowMethodName, implementation: unknown): void {
    if (!(name in originalWindowMethods)) {
        originalWindowMethods[name] = (vscode.window as any)[name];
    }
    (vscode.window as any)[name] = implementation;
}

function restoreWindowMethods(): void {
    for (const [name, implementation] of Object.entries(originalWindowMethods)) {
        (vscode.window as any)[name] = implementation;
    }
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

suite('Checkpoint integration (CP-34)', () => {
    teardown(() => {
        restoreWindowMethods();
        setRestoreTestHooks(undefined);
        CheckpointConflictResolver.getInstance().dispose();
    });

    test('baseline → edit → restore rewinds unmodified files and ignores .env', async () => {
        await withTempCheckpointWorkspace('cp34-baseline', async ({ fixtureRoot, manager }) => {
            const untouched = path.join(fixtureRoot, 'src', 'untouched.ts');
            const willEdit = path.join(fixtureRoot, 'src', 'will-edit.ts');
            const secret = path.join(fixtureRoot, '.env');
            await fs.mkdir(path.join(fixtureRoot, 'src'), { recursive: true });
            await fs.writeFile(untouched, 'export const a = 1;\n');
            await fs.writeFile(willEdit, 'export const b = 1;\n');
            await fs.writeFile(secret, 'SECRET=super-secret\n');

            manager.sessionStartTime = Date.now();
            manager.lastCheckpointTime = Date.now();

            const baselineId = await manager.createManualCheckpoint({
                description: 'untouched workspace',
            });
            assert.ok(baselineId);

            const detailed = await manager.getCheckpointWithSnapshots(baselineId);
            const snapshotPaths = (detailed?.fileSnapshots ?? []).map(
                (snapshot: { relativePath: string }) => snapshot.relativePath,
            );
            assert.ok(snapshotPaths.includes(path.join('src', 'untouched.ts')));
            assert.ok(snapshotPaths.includes(path.join('src', 'will-edit.ts')));
            assert.ok(!snapshotPaths.includes('.env'));

            await fs.writeFile(willEdit, 'export const b = 2;\n');
            await fs.writeFile(untouched, 'export const a = 999;\n');

            const restore = await manager.restoreCheckpoint(baselineId, {
                createBackup: false,
                conflictResolution: 'overwrite',
                cleanupExtraFiles: false,
            });
            assert.strictEqual(restore.success, true);
            assert.strictEqual(await fs.readFile(untouched, 'utf8'), 'export const a = 1;\n');
            assert.strictEqual(await fs.readFile(willEdit, 'utf8'), 'export const b = 1;\n');
            assert.strictEqual(await fs.readFile(secret, 'utf8'), 'SECRET=super-secret\n');
        });
    });

    test('PNG, NUL, and UTF-16 files restore byte-identical', async () => {
        await withTempCheckpointWorkspace('cp34-binary', async ({ fixtureRoot, manager }) => {
            const png = path.join(fixtureRoot, 'icon.png');
            const nul = path.join(fixtureRoot, 'notes.txt');
            const utf16 = path.join(fixtureRoot, 'hello-le.txt');
            const pngBytes = MINIMAL_PNG;
            const nulBytes = Buffer.from('hello\0world', 'binary');
            const utf16Bytes = Buffer.from('\uFEFFHello, 世界', 'utf16le');
            await fs.writeFile(png, pngBytes);
            await fs.writeFile(nul, nulBytes);
            await fs.writeFile(utf16, utf16Bytes);

            const checkpointId = await manager.createManualCheckpoint({
                description: 'binary fixtures',
            });
            assert.ok(checkpointId);

            await fs.writeFile(png, Buffer.from('corrupted-png'));
            await fs.writeFile(nul, Buffer.from('no-nul'));
            await fs.writeFile(utf16, Buffer.from('ascii now', 'utf8'));

            const restore = await manager.restoreCheckpoint(checkpointId, {
                createBackup: false,
                conflictResolution: 'overwrite',
                cleanupExtraFiles: false,
            });
            assert.strictEqual(restore.success, true);
            assert.deepStrictEqual(await fs.readFile(png), pngBytes);
            assert.deepStrictEqual(await fs.readFile(nul), nulBytes);
            assert.deepStrictEqual(await fs.readFile(utf16), utf16Bytes);
        });
    });

    test('truncated JSON and checksum mismatch fail restore without rewriting files', async () => {
        await withTempCheckpointWorkspace('cp34-corrupt', async ({ fixtureRoot, storagePath, manager }) => {
            const keep = path.join(fixtureRoot, 'keep.ts');
            await fs.writeFile(keep, 'export const k = 1;\n');

            const truncatedId = await manager.createManualCheckpoint({
                description: 'truncated source',
            });
            assert.ok(truncatedId);
            await fs.writeFile(path.join(storagePath, `${truncatedId}.json`), '{', 'utf8');

            await assert.rejects(
                manager.restoreCheckpoint(truncatedId, {
                    createBackup: false,
                    conflictResolution: 'overwrite',
                    cleanupExtraFiles: false,
                }),
                /corrupt|invalid json/i,
            );
            assert.strictEqual(await fs.readFile(keep, 'utf8'), 'export const k = 1;\n');

            manager.checkpointHistory = [];
            manager.lastSnapshotHashes = new Map();
            await fs.writeFile(keep, 'export const k = 1;\n');
            const checksumId = await manager.createManualCheckpoint({
                description: 'checksum source',
                forceBaseline: true,
            });
            assert.ok(checksumId);
            const checkpointFile = path.join(storagePath, `${checksumId}.json`);
            const raw = JSON.parse(await fs.readFile(checkpointFile, 'utf8'));
            raw.fileSnapshots[0].hash = 'tampered';
            await fs.writeFile(checkpointFile, JSON.stringify(raw, null, 2), 'utf8');

            await assert.rejects(
                manager.restoreCheckpoint(checksumId, {
                    createBackup: false,
                    conflictResolution: 'overwrite',
                    cleanupExtraFiles: false,
                }),
                /corrupt/i,
            );
            assert.strictEqual(await fs.readFile(keep, 'utf8'), 'export const k = 1;\n');
        });
    });

    test('restore of a parent-traversal path does not write outside the workspace', async () => {
        await withTempCheckpointWorkspace('cp34-sandbox', async ({ fixtureRoot, manager }) => {
            const escapedPath = path.resolve(fixtureRoot, '..', 'outside-cp34.txt');
            await fs.rm(escapedPath, { force: true });

            const evil = {
                id: 'cp-evil-escape',
                description: 'Crafted escape',
                created: new Date(),
                workspacePath: fixtureRoot,
                fileSnapshots: [{
                    relativePath: '../outside-cp34.txt',
                    content: 'pwned',
                    encoding: 'utf8',
                    lastModified: new Date(),
                    size: 5,
                    changeType: 'created' as const,
                }],
                fileInventory: ['../outside-cp34.txt'],
                captureMode: 'baseline' as const,
            };
            manager.checkpointHistory = [evil];
            manager.loadCheckpointFromDisk = async () => evil;

            try {
                const result = await manager.restoreCheckpoint(evil.id, {
                    createBackup: false,
                    conflictResolution: 'overwrite',
                    cleanupExtraFiles: false,
                });
                assert.ok(
                    result.failedFiles.some((file: { path: string }) =>
                        file.path.includes('outside-cp34.txt'),
                    ),
                );
                await assert.rejects(fs.access(escapedPath));
            } finally {
                await fs.rm(escapedPath, { force: true });
            }
        });
    });

    test('deleting a middle checkpoint still reconstructs files unique to that delta', async () => {
        await withTempCheckpointWorkspace('cp34-fold-middle', async ({ fixtureRoot, manager }) => {
            const fileA = path.join(fixtureRoot, 'a.ts');
            const fileB = path.join(fixtureRoot, 'b.ts');
            const unique = path.join(fixtureRoot, 'only-in-baseline.ts');
            await fs.writeFile(fileA, 'export const a = 1;\n');
            await fs.writeFile(fileB, 'export const b = 1;\n');
            await fs.writeFile(unique, 'export const unique = "baseline";\n');

            const firstId = await manager.createManualCheckpoint({ description: 'cp1' });
            assert.ok(firstId);

            await fs.writeFile(fileA, 'export const a = 2;\n');
            const middleId = await manager.createManualCheckpoint({ description: 'cp2' });
            assert.ok(middleId);

            await fs.writeFile(fileB, 'export const b = 3;\n');
            const newestId = await manager.createManualCheckpoint({ description: 'cp3' });
            assert.ok(newestId);

            const removed = await manager.removeFromHistoryAndDisk(middleId);
            assert.strictEqual(removed, true);
            assert.ok(!manager.checkpointHistory.some((cp: { id: string }) => cp.id === middleId));

            await fs.writeFile(fileA, 'export const a = 999;\n');
            await fs.writeFile(fileB, 'export const b = 999;\n');
            await fs.writeFile(unique, 'export const unique = "clobbered";\n');

            const restoreNewest = await manager.restoreCheckpoint(newestId, {
                createBackup: false,
                conflictResolution: 'overwrite',
                cleanupExtraFiles: false,
            });
            assert.strictEqual(restoreNewest.success, true);
            assert.strictEqual(await fs.readFile(fileA, 'utf8'), 'export const a = 2;\n');
            assert.strictEqual(await fs.readFile(fileB, 'utf8'), 'export const b = 3;\n');
            assert.strictEqual(
                await fs.readFile(unique, 'utf8'),
                'export const unique = "baseline";\n',
            );

            const restoreOldest = await manager.restoreCheckpoint(firstId, {
                createBackup: false,
                conflictResolution: 'overwrite',
                cleanupExtraFiles: false,
            });
            assert.strictEqual(restoreOldest.success, true);
            assert.strictEqual(await fs.readFile(fileA, 'utf8'), 'export const a = 1;\n');
            assert.strictEqual(await fs.readFile(fileB, 'utf8'), 'export const b = 1;\n');
        });
    });

    test('maxStorageBytes evicts oldest unpinned checkpoints first', async () => {
        await withTempCheckpointWorkspace('cp34-quota', async ({ fixtureRoot, manager }) => {
            manager.enableCompression = false;
            const payload = `${'blob-payload-'.repeat(400)}\n`;
            await fs.writeFile(path.join(fixtureRoot, 'blob.ts'), `export const data = \`${payload}-1\`;\n`);

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
            assert.ok(remainingIds.includes(firstId));
            assert.ok(remainingIds.includes(thirdId));
            assert.ok(!remainingIds.includes(secondId));
        });
    });

    test('IDE list fileCount uses inventory; restoreCheckpointDirect returns files written', async () => {
        await withTempCheckpointWorkspace('cp34-ide-list', async ({ fixtureRoot, manager }) => {
            const fileA = path.join(fixtureRoot, 'a.ts');
            const fileB = path.join(fixtureRoot, 'b.ts');
            await fs.writeFile(fileA, 'export const a = 1;\n');
            await fs.writeFile(fileB, 'export const b = 1;\n');

            const baselineId = await manager.createManualCheckpoint({ description: 'ide baseline' });
            assert.ok(baselineId);
            await fs.writeFile(fileA, 'export const a = 2;\n');
            const deltaId = await manager.createManualCheckpoint({ description: 'ide delta' });
            assert.ok(deltaId);

            const listed = manager
                .getCheckpointHistoryForWorkspace()
                .sort((a: { created: Date }, b: { created: Date }) => b.created.getTime() - a.created.getTime())
                .map((checkpoint: { id: string } & Parameters<typeof listedCheckpointFileCount>[0]) => ({
                    id: checkpoint.id,
                    fileCount: listedCheckpointFileCount(checkpoint),
                }));
            const deltaRow = listed.find((row: { id: string }) => row.id === deltaId);
            const baselineRow = listed.find((row: { id: string }) => row.id === baselineId);
            assert.strictEqual(baselineRow?.fileCount, 2);
            assert.strictEqual(deltaRow?.fileCount, 2, 'list count must be inventory, not delta snapshot length');

            await fs.writeFile(fileA, 'export const a = 999;\n');
            await fs.writeFile(fileB, 'export const b = 999;\n');

            mockWindowMethod('showInformationMessage', async () => undefined);
            mockWindowMethod('showWarningMessage', async () => undefined);
            mockWindowMethod('showErrorMessage', async () => undefined);

            const result = await CheckpointChatIntegration.getInstance().restoreCheckpointDirect(
                baselineId,
                { rewindMemory: false },
            );
            assert.strictEqual(result.success, true);
            assert.ok(result.restoredFiles.includes('a.ts'));
            assert.ok(result.restoredFiles.includes('b.ts'));
            assert.strictEqual(await fs.readFile(fileA, 'utf8'), 'export const a = 1;\n');
            assert.strictEqual(await fs.readFile(fileB, 'utf8'), 'export const b = 1;\n');
        });
    });

    test('restoreCheckpointDirect deletes extras listed by preview', async () => {
        await withTempCheckpointWorkspace('cp18-direct-extras', async ({ fixtureRoot, manager }) => {
            const fileA = path.join(fixtureRoot, 'a.ts');
            await fs.writeFile(fileA, 'export const a = 1;\n');

            const baselineId = await manager.createManualCheckpoint({ description: 'direct extras baseline' });
            assert.ok(baselineId);

            await fs.writeFile(fileA, 'export const a = 2;\n');
            const extra = path.join(fixtureRoot, 'extra.ts');
            await fs.writeFile(extra, 'export const extra = 1;\n');

            const preview = await manager.previewRestore(baselineId);
            assert.ok(preview);
            assert.ok(preview.writePaths.includes('a.ts'));
            assert.ok(preview.extraPaths.includes('extra.ts'));

            mockWindowMethod('showInformationMessage', async () => undefined);
            mockWindowMethod('showWarningMessage', async () => undefined);
            mockWindowMethod('showErrorMessage', async () => undefined);

            const result = await CheckpointChatIntegration.getInstance().restoreCheckpointDirect(
                baselineId,
                { rewindMemory: false },
            );
            assert.strictEqual(result.success, true);
            assert.ok(result.restoredFiles.includes('a.ts'));
            assert.ok(result.restoredFiles.includes('extra.ts'));
            assert.strictEqual(await fs.readFile(fileA, 'utf8'), 'export const a = 1;\n');
            await assert.rejects(fs.access(extra));
        });
    });

    test('overlapping restores serialize and leave a complete tree', async () => {
        await withTempCheckpointWorkspace('cp34-concurrent', async ({ fixtureRoot, manager }) => {
            CheckpointConflictResolver.getInstance().dispose();
            const fileA = path.join(fixtureRoot, 'a.ts');
            const fileB = path.join(fixtureRoot, 'b.ts');
            await fs.writeFile(fileA, 'export const a = "old";\n');
            await fs.writeFile(fileB, 'export const b = "old";\n');

            const checkpointId = await manager.createManualCheckpoint({ description: 'concurrent' });
            assert.ok(checkpointId);
            await fs.writeFile(fileA, 'export const a = "new";\n');
            await fs.writeFile(fileB, 'export const b = "new";\n');

            const order: string[] = [];
            setRestoreTestHooks({
                beforeWrite: async (_relativePath, index) => {
                    if (index === 0) {
                        order.push('write-start');
                        await delay(40);
                        order.push('write-end');
                    }
                },
            });

            const [first, second] = await Promise.all([
                manager.restoreCheckpoint(checkpointId, {
                    createBackup: false,
                    conflictResolution: 'overwrite',
                    cleanupExtraFiles: false,
                }),
                (async () => {
                    await delay(10);
                    return manager.restoreCheckpoint(checkpointId, {
                        createBackup: false,
                        conflictResolution: 'overwrite',
                        cleanupExtraFiles: false,
                    });
                })(),
            ]);

            assert.strictEqual(first.success, true);
            assert.strictEqual(second.success, true);
            assert.ok(order.includes('write-start'));
            assert.strictEqual(await fs.readFile(fileA, 'utf8'), 'export const a = "old";\n');
            assert.strictEqual(await fs.readFile(fileB, 'utf8'), 'export const b = "old";\n');
            assert.strictEqual(CheckpointConflictResolver.getInstance().getConflictStats().activeOperations, 0);
        });
    });

    test('two folders with the same relative files stay isolated', async () => {
        await withTempCheckpointWorkspace(
            'cp34-multiroot',
            async ({ fixtureRoot, manager }) => {
                const folderA = path.join(fixtureRoot, 'proj-a');
                const folderB = path.join(fixtureRoot, 'proj-b');
                await fs.mkdir(path.join(folderA, 'src'), { recursive: true });
                await fs.mkdir(path.join(folderB, 'src'), { recursive: true });
                await fs.writeFile(path.join(folderA, 'src', 'app.ts'), 'export const name = "a";\n');
                await fs.writeFile(path.join(folderB, 'src', 'app.ts'), 'export const name = "b";\n');

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

                const blobsA = await listStoredBlobs(path.join(folderA, '.knox-debug', 'checkpoints'));
                const blobsB = await listStoredBlobs(path.join(folderB, '.knox-debug', 'checkpoints'));
                assert.ok(blobsA.length > 0);
                assert.ok(blobsB.length > 0);
                assert.notDeepStrictEqual(blobsA, blobsB);

                await manager.switchWorkspaceFolder(folderA);
                const historyA = manager.getCheckpointHistoryForWorkspace(folderA);
                await manager.switchWorkspaceFolder(folderB);
                const historyB = manager.getCheckpointHistoryForWorkspace(folderB);
                assert.ok(historyA.length >= 1);
                assert.ok(historyB.length >= 1);
                assert.notStrictEqual(historyA[0].id, historyB[0].id);

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
                );
            },
            { workspaceFolderPaths: (root) => [path.join(root, 'proj-a'), path.join(root, 'proj-b')] },
        );
    });

    test('legacy index-only checkpoints can be deleted without an on-disk manifest', async () => {
        await withTempCheckpointWorkspace('cp34-ghost-delete', async ({ fixtureRoot, manager }) => {
            const olderId = 'cp_1786951919761_y1osvtjus';
            const newerId = 'cp_1786956984634_090rjh79j';
            manager.checkpointHistory = [
                {
                    id: olderId,
                    description: 'Auto: 6 files changed (scripts, package_macos.sh +4 more) at 03:31 PM',
                    created: new Date('2026-08-17T07:31:59.761Z'),
                    workspacePath: fixtureRoot,
                    fileStats: { total: 6, created: 0, deleted: 0, modified: 6, inventoryCount: 6 },
                },
                {
                    id: newerId,
                    description: 'Auto: 8 files changed (main.rs.git, dist +6 more) at 04:56 PM',
                    created: new Date('2026-08-17T08:56:24.634Z'),
                    workspacePath: fixtureRoot,
                    fileStats: { total: 8, created: 0, deleted: 0, modified: 8, inventoryCount: 8 },
                },
            ];

            const beforeHealth = await manager.inspectStoreHealth();
            assert.strictEqual(beforeHealth.indexNeedsRebuild, true);

            const removed = await manager.removeFromHistoryAndDisk(olderId);
            assert.strictEqual(removed, true);
            assert.deepStrictEqual(
                manager.checkpointHistory.map((cp: { id: string }) => cp.id),
                [newerId],
            );

            const rebuilt = await manager.repairStoreHealth({ journal: false, index: true, gc: false });
            assert.strictEqual(rebuilt.indexRebuilt, true);
            const afterHealth = await manager.inspectStoreHealth();
            assert.strictEqual(afterHealth.indexNeedsRebuild, false);
        });
    });

    test('cancelling restore rolls back to the pre-restore tree', async () => {
        await withTempCheckpointWorkspace('cp34-cancel', async ({ fixtureRoot, manager }) => {
            const fileA = path.join(fixtureRoot, 'a.ts');
            const fileB = path.join(fixtureRoot, 'b.ts');
            await fs.writeFile(fileA, 'export const a = "old";\n');
            await fs.writeFile(fileB, 'export const b = "old";\n');

            const checkpointId = await manager.createManualCheckpoint({ description: 'cancel source' });
            assert.ok(checkpointId);

            await fs.writeFile(fileA, 'export const a = "new";\n');
            await fs.writeFile(fileB, 'export const b = "new";\n');

            setRestoreTestHooks({
                shouldCancel: (_relativePath, index) => index >= 1,
            });

            const result = await manager.restoreCheckpoint(checkpointId, {
                conflictResolution: 'overwrite',
                cleanupExtraFiles: false,
            });
            assert.strictEqual(result.success, false);
            assert.ok(result.failedFiles.some((file: { error: string }) => file.error === 'cancelled'));
            assert.strictEqual(await fs.readFile(fileA, 'utf8'), 'export const a = "new";\n');
            assert.strictEqual(await fs.readFile(fileB, 'utf8'), 'export const b = "new";\n');
        });
    });

    test('compression on stores gzip for large blobs; off stores raw; restore matches', async () => {
        await withTempCheckpointWorkspace('cp34-compress', async ({ fixtureRoot, storagePath, manager }) => {
            const payload = 'x'.repeat(BLOB_COMPRESS_THRESHOLD + 32);
            const source = path.join(fixtureRoot, 'large.ts');
            await fs.writeFile(source, `export const data = "${payload}";\n`);

            manager.enableCompression = true;
            const compressedId = await manager.createManualCheckpoint({
                description: 'compressed',
                forceBaseline: true,
            });
            assert.ok(compressedId);
            const compressedBlobs = await listStoredBlobs(storagePath);
            assert.ok(
                compressedBlobs.some((name) => name.endsWith('.gz')),
                'large blobs must be stored gzipped when compression is on',
            );

            await fs.writeFile(source, 'export const data = "changed";\n');
            const restoreCompressed = await manager.restoreCheckpoint(compressedId, {
                createBackup: false,
                conflictResolution: 'overwrite',
                cleanupExtraFiles: false,
            });
            assert.strictEqual(restoreCompressed.success, true);
            assert.ok((await fs.readFile(source, 'utf8')).includes(payload));

            manager.enableCompression = false;
            manager.lastSnapshotHashes = new Map();
            await fs.writeFile(source, `export const data = "${payload}-raw";\n`);
            const rawId = await manager.createManualCheckpoint({
                description: 'raw',
                forceBaseline: true,
            });
            assert.ok(rawId);
            const rawBlobs = await listStoredBlobs(storagePath);
            assert.ok(
                rawBlobs.some((name) => !name.endsWith('.gz') && !name.endsWith('.enc')),
                'large blobs must be stored raw when compression is off',
            );
        });
    });

    test('export then import restores the same reconstructed tree', async () => {
        await withTempCheckpointWorkspace('cp34-bundle', async ({ fixtureRoot, manager }) => {
            const source = path.join(fixtureRoot, 'app.ts');
            await fs.writeFile(source, 'export const n = 1;\n');
            const checkpointId = await manager.createManualCheckpoint({ description: 'bundle source' });
            assert.ok(checkpointId);

            const bundlePath = path.join(fixtureRoot, 'share.knox-cp');
            await manager.exportCheckpoints(bundlePath, { checkpointIds: [checkpointId] });

            manager.checkpointHistory = [];
            manager.lastSnapshotHashes = new Map();
            const imported = await manager.importCheckpoints(bundlePath, {
                merge: false,
                allowWorkspaceMismatch: true,
            });
            assert.ok(imported >= 1);
            const importedId = manager.checkpointHistory[0]?.id as string;
            assert.ok(importedId);

            await fs.writeFile(source, 'export const n = 999;\n');
            const restore = await manager.restoreCheckpoint(importedId, {
                createBackup: false,
                conflictResolution: 'overwrite',
                cleanupExtraFiles: false,
            });
            assert.strictEqual(restore.success, true);
            assert.strictEqual(await fs.readFile(source, 'utf8'), 'export const n = 1;\n');
        });
    });

    test('turn baseline is reconstructable and restore rewinds the turn', async () => {
        await withTempCheckpointWorkspace('cp34-turn', async ({ fixtureRoot, manager }) => {
            const source = path.join(fixtureRoot, 'app.ts');
            await fs.writeFile(source, 'export const n = 1;\n');
            manager.sessionStartTime = Date.now();
            manager.lastCheckpointTime = Date.now();

            const turnId = await manager.ensureTurnCheckpoint({
                sessionId: 'session-turn',
                turnId: 'turn-1',
                toolName: 'builtin_edit_file',
            });
            assert.ok(turnId);
            const checkpoint = manager.checkpointHistory.find((cp: { id: string }) => cp.id === turnId);
            assert.strictEqual(checkpoint?.captureMode, 'baseline');

            await fs.writeFile(source, 'export const n = 2;\n');
            const restore = await manager.restoreCheckpoint(turnId, {
                createBackup: false,
                conflictResolution: 'overwrite',
                cleanupExtraFiles: false,
            });
            assert.strictEqual(restore.success, true);
            assert.strictEqual(await fs.readFile(source, 'utf8'), 'export const n = 1;\n');
        });
    });

    test('preview write paths match the files restore actually writes', async () => {
        await withTempCheckpointWorkspace('cp34-preview', async ({ fixtureRoot, manager }) => {
            const keep = path.join(fixtureRoot, 'keep.ts');
            const edit = path.join(fixtureRoot, 'edit.ts');
            await fs.writeFile(keep, 'export const keep = 1;\n');
            await fs.writeFile(edit, 'export const edit = 1;\n');

            const checkpointId = await manager.createManualCheckpoint({ description: 'preview' });
            assert.ok(checkpointId);
            await fs.writeFile(edit, 'export const edit = 2;\n');

            const preview = await manager.previewRestore(checkpointId);
            assert.ok(preview);
            assert.deepStrictEqual(preview.writePaths, ['edit.ts']);

            const restore = await manager.restoreCheckpoint(checkpointId, {
                createBackup: false,
                conflictResolution: 'overwrite',
                cleanupExtraFiles: false,
                includeFiles: preview.writePaths,
            });
            assert.strictEqual(restore.success, true);
            assert.deepStrictEqual([...restore.restoredFiles].sort(), [...preview.writePaths].sort());
            assert.strictEqual(await fs.readFile(edit, 'utf8'), 'export const edit = 1;\n');
            assert.strictEqual(await fs.readFile(keep, 'utf8'), 'export const keep = 1;\n');
        });
    });
});
