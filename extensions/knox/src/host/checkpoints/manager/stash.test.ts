import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'path';

import { collectReferencedBlobHashes, gcUnreferencedCheckpointBlobs } from './persistence';
import { collectStashBlobHashes, loadStashIndex } from '../store/stashIndex';
import { withIsolatedManager, withTempCheckpointWorkspace } from '../checkpointTestHarness';

suite('Working-tree stash (CP-38)', () => {
    test('push then pop round-trips dirty files and new files', async () => {
        await withTempCheckpointWorkspace('stash-roundtrip', async ({ fixtureRoot, manager }) => {
            const fileA = path.join(fixtureRoot, 'a.ts');
            const fileB = path.join(fixtureRoot, 'b.ts');
            await fs.writeFile(fileA, 'A0\n');
            const baselineId = await manager.createManualCheckpoint({ description: 'base' });
            assert.ok(baselineId);

            await fs.writeFile(fileA, 'A1\n');
            await fs.writeFile(fileB, 'B-new\n');
            manager.recentlyModifiedFiles.add(fileA);
            manager.recentlyModifiedFiles.add(fileB);

            const pushed = await manager.stashPush({ message: 'wip' });
            assert.strictEqual(pushed.success, true);
            assert.strictEqual(pushed.empty, false);
            assert.ok(pushed.stashId);
            assert.strictEqual(await fs.readFile(fileA, 'utf8'), 'A0\n');
            await assert.rejects(() => fs.readFile(fileB, 'utf8'));

            const listed = await manager.stashList();
            assert.strictEqual(listed.length, 1);
            assert.strictEqual(listed[0].id, pushed.stashId);
            assert.strictEqual(listed[0].message, 'wip');

            const popped = await manager.stashPop();
            assert.strictEqual(popped.success, true);
            assert.strictEqual(popped.conflicts.length, 0);
            assert.strictEqual(await fs.readFile(fileA, 'utf8'), 'A1\n');
            assert.strictEqual(await fs.readFile(fileB, 'utf8'), 'B-new\n');
            assert.strictEqual((await manager.stashList()).length, 0);
        });
    });

    test('empty stash is a no-op success', async () => {
        await withTempCheckpointWorkspace('stash-empty', async ({ fixtureRoot, manager }) => {
            await fs.writeFile(path.join(fixtureRoot, 'a.ts'), 'A0\n');
            assert.ok(await manager.createManualCheckpoint({ description: 'base' }));
            const pushed = await manager.stashPush();
            assert.strictEqual(pushed.success, true);
            assert.strictEqual(pushed.empty, true);
            assert.strictEqual((await manager.stashList()).length, 0);
        });
    });

    test('reload keeps the stash stack', async () => {
        await withTempCheckpointWorkspace('stash-reload', async ({ fixtureRoot, storagePath, manager }) => {
            const fileA = path.join(fixtureRoot, 'a.ts');
            await fs.writeFile(fileA, 'A0\n');
            assert.ok(await manager.createManualCheckpoint({ description: 'base' }));
            await fs.writeFile(fileA, 'A1\n');
            manager.recentlyModifiedFiles.add(fileA);
            const pushed = await manager.stashPush({ message: 'keep' });
            assert.ok(pushed.stashId);

            const fromDisk = await loadStashIndex(storagePath);
            assert.strictEqual(fromDisk.length, 1);
            assert.strictEqual(fromDisk[0].id, pushed.stashId);
            assert.strictEqual(fromDisk[0].message, 'keep');
        });
    });

    test('conflicts leave the workspace unchanged', async () => {
        await withTempCheckpointWorkspace('stash-conflict', async ({ fixtureRoot, manager }) => {
            const fileA = path.join(fixtureRoot, 'a.ts');
            await fs.writeFile(fileA, 'A0\n');
            assert.ok(await manager.createManualCheckpoint({ description: 'base' }));
            await fs.writeFile(fileA, 'A1\n');
            manager.recentlyModifiedFiles.add(fileA);
            assert.ok((await manager.stashPush()).stashId);

            await fs.writeFile(fileA, 'A2\n');
            const popped = await manager.stashPop();
            assert.strictEqual(popped.success, false);
            assert.deepStrictEqual(popped.conflicts.map((conflict: { path: string }) => conflict.path), ['a.ts']);
            assert.strictEqual(await fs.readFile(fileA, 'utf8'), 'A2\n');
            assert.strictEqual((await manager.stashList()).length, 1);
        });
    });

    test('stash blobs survive garbage collection', async () => {
        await withTempCheckpointWorkspace('stash-gc', async ({ fixtureRoot, storagePath, manager }) => {
            const fileA = path.join(fixtureRoot, 'a.ts');
            await fs.writeFile(fileA, 'A0\n');
            assert.ok(await manager.createManualCheckpoint({ description: 'base' }));
            await fs.writeFile(fileA, 'A-stashed\n');
            manager.recentlyModifiedFiles.add(fileA);
            assert.ok((await manager.stashPush()).stashId);

            const stashHashes = await collectStashBlobHashes(storagePath);
            assert.ok(stashHashes.length > 0);
            const referenced = await collectReferencedBlobHashes(manager);
            for (const hash of stashHashes) {
                assert.ok(referenced.has(hash), `stash blob ${hash} must stay referenced`);
            }
            await gcUnreferencedCheckpointBlobs(manager);
            const popped = await manager.stashPop();
            assert.strictEqual(popped.success, true);
            assert.strictEqual(await fs.readFile(fileA, 'utf8'), 'A-stashed\n');
        });
    });

    test('stash list is empty when the manager is not initialized', async () => {
        await withIsolatedManager('/tmp/unused-stash', '/tmp/unused-stash-store', async (manager) => {
            manager.initialized = false;
            manager.currentWorkspacePath = undefined;
            assert.deepStrictEqual(await manager.stashList(), []);
        });
    });
});
