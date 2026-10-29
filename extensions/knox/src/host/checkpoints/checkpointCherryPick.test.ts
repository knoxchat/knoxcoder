import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'path';

import { withTempCheckpointWorkspace } from './checkpointTestHarness';

suite('Cherry-pick (CP-41)', () => {
    test('picking a feature-line checkpoint onto main applies only that turn', async () => {
        await withTempCheckpointWorkspace('cherrypick-apply', async ({ fixtureRoot, manager }) => {
            const fileA = path.join(fixtureRoot, 'a.ts');
            const fileB = path.join(fixtureRoot, 'b.ts');
            await fs.writeFile(fileA, 'A0\n');
            await fs.writeFile(fileB, 'B0\n');
            const baselineId = await manager.createManualCheckpoint({ description: 'base' });
            assert.ok(baselineId);

            const feature = await manager.createBranch('feature', baselineId);
            assert.ok(feature);
            await fs.writeFile(fileA, 'A-feature\n');
            const featureId = await manager.createManualCheckpoint({ description: 'feature a' });
            assert.ok(featureId);

            const main = (await manager.listBranches()).find((item: { name: string }) => item.name === 'main');
            assert.ok(main);
            await manager.switchBranch(main.id, { checkout: 'none' });
            await fs.writeFile(fileA, 'A0\n');
            await fs.writeFile(fileB, 'B-main\n');
            const mainId = await manager.createManualCheckpoint({ description: 'main b' });
            assert.ok(mainId);

            const picked = await manager.cherryPick(featureId);
            assert.strictEqual(picked.success, true, JSON.stringify(picked));
            assert.ok(picked.checkpointId);
            assert.deepStrictEqual(picked.conflicts, []);
            assert.strictEqual(await fs.readFile(fileA, 'utf8'), 'A-feature\n');
            assert.strictEqual(await fs.readFile(fileB, 'utf8'), 'B-main\n');

            const newCp = manager.getCheckpointHistoryForWorkspace().find(
                (checkpoint: { id: string }) => checkpoint.id === picked.checkpointId,
            );
            assert.strictEqual(newCp?.parentCheckpointId, mainId);
            assert.ok(newCp?.tags?.includes('cherry-pick'));
            assert.ok(newCp?.tags?.includes(featureId));
        });
    });

    test('already-present changes are no-ops and conflicts leave HEAD unchanged', async () => {
        await withTempCheckpointWorkspace('cherrypick-conflict', async ({ fixtureRoot, manager }) => {
            const fileA = path.join(fixtureRoot, 'a.ts');
            await fs.writeFile(fileA, 'A0\n');
            const baselineId = await manager.createManualCheckpoint({ description: 'base' });
            const feature = await manager.createBranch('feature', baselineId);
            await fs.writeFile(fileA, 'A1\n');
            const sameId = await manager.createManualCheckpoint({ description: 'same' });

            const main = (await manager.listBranches()).find((item: { name: string }) => item.name === 'main');
            await manager.switchBranch(main.id, { checkout: 'none' });
            await fs.writeFile(fileA, 'A1\n');
            await manager.createManualCheckpoint({ description: 'already there' });
            const empty = await manager.cherryPick(sameId);
            assert.strictEqual(empty.success, true);
            assert.strictEqual(empty.empty, true);

            const other = await manager.createBranch('other', baselineId);
            await manager.switchBranch(other.id, { checkout: 'hard' });
            await fs.writeFile(fileA, 'A-other\n');
            const otherId = await manager.createManualCheckpoint({ description: 'other' });
            await manager.switchBranch(main.id, { checkout: 'hard' });
            const headBefore = manager.getActiveBranch()?.headCheckpointId;
            const conflicted = await manager.cherryPick(otherId);
            assert.strictEqual(conflicted.success, false);
            assert.ok(conflicted.conflicts.some((conflict: { path: string }) => conflict.path === 'a.ts'));
            assert.strictEqual(manager.getActiveBranch()?.headCheckpointId, headBefore);
            assert.ok((await fs.readFile(fileA, 'utf8')).includes('<<<<<<<'));
            const aborted = await manager.mergeAbort();
            assert.strictEqual(aborted.success, true);
            assert.strictEqual(await fs.readFile(fileA, 'utf8'), 'A1\n');
        });
    });
});

suite('Inverse revert (CP-42)', () => {
    test('revert B after C keeps C files and undoes B', async () => {
        await withTempCheckpointWorkspace('revert-b-after-c', async ({ fixtureRoot, manager }) => {
            const fileA = path.join(fixtureRoot, 'a.ts');
            const fileB = path.join(fixtureRoot, 'b-only.ts');
            const fileC = path.join(fixtureRoot, 'c.ts');
            await fs.writeFile(fileA, 'A0\n');
            assert.ok(await manager.createManualCheckpoint({ description: 'A' }));

            await fs.writeFile(fileA, 'A-bad\n');
            await fs.writeFile(fileB, 'B-only\n');
            const bId = await manager.createManualCheckpoint({ description: 'B' });
            assert.ok(bId);

            await fs.writeFile(fileC, 'C-only\n');
            assert.ok(await manager.createManualCheckpoint({ description: 'C' }));

            const reverted = await manager.revertCheckpoint(bId);
            assert.strictEqual(reverted.success, true, JSON.stringify(reverted));
            assert.ok(reverted.checkpointId);
            assert.strictEqual(await fs.readFile(fileA, 'utf8'), 'A0\n');
            await assert.rejects(() => fs.readFile(fileB, 'utf8'));
            assert.strictEqual(await fs.readFile(fileC, 'utf8'), 'C-only\n');
            assert.ok(manager.getCheckpointHistoryForWorkspace().some((item: { id: string }) => item.id === bId));
        });
    });
});
