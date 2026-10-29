import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'path';

import { recoverIncompleteRestore, setRestoreTestHooks } from './manager/restore';
import { loadIndexFromCurrentStore } from './manager/persistence';
import { withTempCheckpointWorkspace } from './checkpointTestHarness';

suite('Checkout on branch switch (CP-39)', () => {
    test('hard switch rewrites files to the target head and switching back restores the other line', async () => {
        await withTempCheckpointWorkspace('checkout-roundtrip', async ({ fixtureRoot, manager }) => {
            const fileA = path.join(fixtureRoot, 'a.ts');
            const fileB = path.join(fixtureRoot, 'b.ts');
            const fileFeatureOnly = path.join(fixtureRoot, 'feature-only.ts');
            await fs.writeFile(fileA, 'A0\n');
            await fs.writeFile(fileB, 'B0\n');
            const baselineId = await manager.createManualCheckpoint({ description: 'base' });
            assert.ok(baselineId);

            const feature = await manager.createBranch('feature', baselineId);
            assert.ok(feature);
            await fs.writeFile(fileA, 'A-feature\n');
            await fs.writeFile(fileFeatureOnly, 'only-on-feature\n');
            manager.recentlyModifiedFiles.add(fileA);
            manager.recentlyModifiedFiles.add(fileFeatureOnly);
            const featureId = await manager.createManualCheckpoint({ description: 'feature edit' });
            assert.ok(featureId);

            const main = (await manager.listBranches()).find((item: { name: string }) => item.name === 'main');
            assert.ok(main);
            const ontoMain = await manager.switchBranch(main.id);
            assert.strictEqual(ontoMain.success, true, ontoMain.message);
            assert.strictEqual(await fs.readFile(fileA, 'utf8'), 'A0\n');
            await assert.rejects(() => fs.readFile(fileFeatureOnly, 'utf8'));
            await fs.writeFile(fileB, 'B-main\n');
            manager.recentlyModifiedFiles.add(fileB);
            const mainId = await manager.createManualCheckpoint({ description: 'main edit' });
            assert.ok(mainId);

            const toFeature = await manager.switchBranch(feature.id);
            assert.strictEqual(toFeature.success, true, toFeature.message);
            assert.strictEqual(toFeature.checkout, 'hard');
            assert.strictEqual(await fs.readFile(fileA, 'utf8'), 'A-feature\n');
            assert.strictEqual(await fs.readFile(fileB, 'utf8'), 'B0\n');
            assert.strictEqual(await fs.readFile(fileFeatureOnly, 'utf8'), 'only-on-feature\n');

            const backToMain = await manager.switchBranch(main.id);
            assert.strictEqual(backToMain.success, true, backToMain.message);
            assert.strictEqual(await fs.readFile(fileA, 'utf8'), 'A0\n');
            assert.strictEqual(await fs.readFile(fileB, 'utf8'), 'B-main\n');
            await assert.rejects(() => fs.readFile(fileFeatureOnly, 'utf8'));
        });
    });

    test('dirty tree is auto-stashed on hard switch', async () => {
        await withTempCheckpointWorkspace('checkout-autostash', async ({ fixtureRoot, manager }) => {
            const fileA = path.join(fixtureRoot, 'a.ts');
            await fs.writeFile(fileA, 'A0\n');
            const baselineId = await manager.createManualCheckpoint({ description: 'base' });
            const feature = await manager.createBranch('feature', baselineId);
            assert.ok(feature);
            await fs.writeFile(fileA, 'A-feature\n');
            manager.recentlyModifiedFiles.add(fileA);
            await manager.createManualCheckpoint({ description: 'feature' });

            const main = (await manager.listBranches()).find((item: { name: string }) => item.name === 'main');
            assert.ok(main);
            await manager.switchBranch(main.id, { checkout: 'none' });
            await fs.writeFile(fileA, 'A0\n');
            await manager.createManualCheckpoint({ description: 'main' });

            await fs.writeFile(fileA, 'dirty-on-main\n');
            manager.recentlyModifiedFiles.add(fileA);
            const switched = await manager.switchBranch(feature.id);
            assert.strictEqual(switched.success, true, switched.message);
            assert.strictEqual(switched.stashed, true);
            assert.ok(switched.stashId);
            assert.strictEqual(await fs.readFile(fileA, 'utf8'), 'A-feature\n');
            const listed = await manager.stashList();
            assert.strictEqual(listed.length, 1);
            assert.strictEqual(listed[0].id, switched.stashId);
        });
    });

    test('hard switch refuses a dirty tree when auto-stash is disabled', async () => {
        await withTempCheckpointWorkspace('checkout-refuse', async ({ fixtureRoot, manager }) => {
            const fileA = path.join(fixtureRoot, 'a.ts');
            await fs.writeFile(fileA, 'A0\n');
            const baselineId = await manager.createManualCheckpoint({ description: 'base' });
            const feature = await manager.createBranch('feature', baselineId);
            assert.ok(feature);
            await fs.writeFile(fileA, 'A-feature\n');
            manager.recentlyModifiedFiles.add(fileA);
            await manager.createManualCheckpoint({ description: 'feature' });

            const main = (await manager.listBranches()).find((item: { name: string }) => item.name === 'main');
            assert.ok(main);
            await manager.switchBranch(main.id, { checkout: 'none' });
            await fs.writeFile(fileA, 'A0\n');
            await manager.createManualCheckpoint({ description: 'main' });

            await fs.writeFile(fileA, 'dirty-on-main\n');
            manager.recentlyModifiedFiles.add(fileA);
            const refused = await manager.switchBranch(feature.id, { autoStash: false });
            assert.strictEqual(refused.success, false);
            assert.strictEqual(refused.refused, 'dirty');
            assert.strictEqual(await fs.readFile(fileA, 'utf8'), 'dirty-on-main\n');
            assert.strictEqual(manager.activeBranchId, main.id);
        });
    });

    test('detached checkout of a node persists and new captures stay off the previous branch head', async () => {
        await withTempCheckpointWorkspace('checkout-detached', async ({ fixtureRoot, storagePath, manager }) => {
            const fileA = path.join(fixtureRoot, 'a.ts');
            await fs.writeFile(fileA, 'A0\n');
            const baselineId = await manager.createManualCheckpoint({ description: 'base' });
            assert.ok(baselineId);
            await fs.writeFile(fileA, 'A1\n');
            manager.recentlyModifiedFiles.add(fileA);
            const midId = await manager.createManualCheckpoint({ description: 'mid' });
            assert.ok(midId);
            await fs.writeFile(fileA, 'A2\n');
            manager.recentlyModifiedFiles.add(fileA);
            const tipId = await manager.createManualCheckpoint({ description: 'tip' });
            assert.ok(tipId);
            const mainBefore = (await manager.listBranches()).find((item: { name: string }) => item.name === 'main');
            assert.ok(mainBefore);
            assert.strictEqual(mainBefore.headCheckpointId, tipId);

            const checked = await manager.checkoutCheckpoint(midId);
            assert.strictEqual(checked.success, true, checked.message);
            assert.strictEqual(checked.detached, true);
            assert.strictEqual(await fs.readFile(fileA, 'utf8'), 'A1\n');
            assert.strictEqual(manager.detachedFrom?.checkpointId, midId);

            manager.checkpointHistory = [];
            manager.branches = [];
            manager.activeBranchId = undefined;
            manager.detachedFrom = undefined;
            assert.ok(await loadIndexFromCurrentStore(manager));
            assert.strictEqual(manager.detachedFrom?.checkpointId, midId);

            await fs.writeFile(fileA, 'A-detached\n');
            manager.recentlyModifiedFiles.add(fileA);
            const afterId = await manager.createManualCheckpoint({ description: 'after detached' });
            assert.ok(afterId);
            const after = manager.getCheckpointInfo(afterId);
            assert.strictEqual(after?.parentCheckpointId, midId);
            assert.strictEqual(after?.branchId, undefined);
            const main = (await manager.listBranches()).find((item: { name: string }) => item.name === 'main');
            assert.ok(main);
            assert.strictEqual(main.headCheckpointId, tipId);
        });
    });

    test('crash journal during hard checkout still recovers', async () => {
        await withTempCheckpointWorkspace('checkout-journal', async ({ fixtureRoot, manager }) => {
            const fileA = path.join(fixtureRoot, 'a.ts');
            await fs.writeFile(fileA, 'A0\n');
            const baselineId = await manager.createManualCheckpoint({ description: 'base' });
            const feature = await manager.createBranch('feature', baselineId);
            assert.ok(feature);
            await fs.writeFile(fileA, 'A-feature\n');
            manager.recentlyModifiedFiles.add(fileA);
            await manager.createManualCheckpoint({ description: 'feature' });

            const main = (await manager.listBranches()).find((item: { name: string }) => item.name === 'main');
            assert.ok(main);
            await manager.switchBranch(main.id, { checkout: 'none' });
            await fs.writeFile(fileA, 'A0\n');
            await manager.createManualCheckpoint({ description: 'main' });

            setRestoreTestHooks({
                afterJournalWrite: async () => {
                    throw new Error('simulated crash after journal');
                },
            });
            try {
                await assert.rejects(() => manager.switchBranch(feature.id));
            } finally {
                setRestoreTestHooks(undefined);
            }
            await recoverIncompleteRestore(manager);
            assert.strictEqual(await fs.readFile(fileA, 'utf8'), 'A0\n');
        });
    });
});
