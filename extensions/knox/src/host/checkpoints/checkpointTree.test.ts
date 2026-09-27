import * as assert from 'node:assert';
import * as vscode from 'vscode';

import {
    checkpointDescriptionFromArg,
    checkpointIdFromArg,
    checkpointSkipConfirmFromArg,
} from './commandIds';
import {
    CheckpointDiffContentProvider,
    CheckpointTreeProvider,
    PAGE_SIZE,
    diffResourceUris,
    groupByDate,
    groupByPin,
    groupBySession,
    inferCheckpointType,
    summarizeDiffResult,
} from './CheckpointTreeProvider';
import type { CheckpointInfo } from './manager/types';
import type { CheckpointDiffResult } from './manager/types';

function cp(partial: Partial<CheckpointInfo> & Pick<CheckpointInfo, 'id' | 'description' | 'created'>): CheckpointInfo {
    return partial;
}

suite('Checkpoint tree (CP-17)', () => {
    test('checkpointIdFromArg reads strings and tree items', () => {
        assert.strictEqual(checkpointIdFromArg('  cp_1  '), 'cp_1');
        assert.strictEqual(checkpointIdFromArg({ checkpointId: 'cp_2' }), 'cp_2');
        assert.strictEqual(checkpointIdFromArg({}), undefined);
        assert.strictEqual(checkpointIdFromArg(undefined), undefined);
    });

    test('checkpointDescriptionFromArg reads strings and create options', () => {
        assert.strictEqual(checkpointDescriptionFromArg('  smoke  '), 'smoke');
        assert.strictEqual(checkpointDescriptionFromArg({ description: 'KN-144' }), 'KN-144');
        assert.strictEqual(checkpointDescriptionFromArg({}), undefined);
        assert.strictEqual(checkpointDescriptionFromArg(undefined), undefined);
    });

    test('checkpointSkipConfirmFromArg is opt-in for scripts', () => {
        assert.strictEqual(checkpointSkipConfirmFromArg(undefined), false);
        assert.strictEqual(checkpointSkipConfirmFromArg('cp_1'), false);
        assert.strictEqual(checkpointSkipConfirmFromArg({ checkpointId: 'cp_1' }), false);
        assert.strictEqual(checkpointSkipConfirmFromArg({ checkpointId: 'cp_1', confirm: false }), true);
        assert.strictEqual(checkpointSkipConfirmFromArg({ checkpointId: 'cp_1', direct: true }), true);
    });

    test('inferCheckpointType classifies descriptions', () => {
        const now = new Date();
        assert.strictEqual(inferCheckpointType(cp({ id: 'a', description: 'Manual save', created: now })), 'manual');
        assert.strictEqual(inferCheckpointType(cp({ id: 'b', description: 'Agent completed task', created: now })), 'ai');
        assert.strictEqual(inferCheckpointType(cp({ id: 'c', description: 'Auto-save interval', created: now })), 'auto');
        assert.strictEqual(inferCheckpointType(cp({ id: 'd', description: 'Merge branch', created: now })), 'merge');
    });

    test('groupByDate buckets today / yesterday / older', () => {
        const now = new Date(2026, 7, 17, 15, 0, 0);
        const today = cp({ id: 't', description: 'today', created: new Date(2026, 7, 17, 12, 0, 0) });
        const yesterday = cp({ id: 'y', description: 'yesterday', created: new Date(2026, 7, 16, 12, 0, 0) });
        const older = cp({ id: 'o', description: 'older', created: new Date(2026, 6, 1, 12, 0, 0) });

        const groups = groupByDate([today, yesterday, older], now);
        assert.deepStrictEqual(groups.map((group) => group.id), ['today', 'yesterday', 'older']);
        assert.deepStrictEqual(groups[0].checkpoints.map((item) => item.id), ['t']);
        assert.deepStrictEqual(groups[1].checkpoints.map((item) => item.id), ['y']);
        assert.deepStrictEqual(groups[2].checkpoints.map((item) => item.id), ['o']);
    });

    test('groupByPin separates pinned checkpoints', () => {
        const now = new Date();
        const pinned = cp({ id: 'p', description: 'pinned', created: now, pinned: true });
        const other = cp({ id: 'u', description: 'unpinned', created: now });
        const groups = groupByPin([other, pinned]);
        assert.strictEqual(groups[0].id, 'pinned');
        assert.deepStrictEqual(groups[0].checkpoints.map((item) => item.id), ['p']);
        assert.strictEqual(groups[1].id, 'unpinned');
        assert.deepStrictEqual(groups[1].checkpoints.map((item) => item.id), ['u']);
    });

    test('groupBySession uses sessionId when present', () => {
        const now = new Date();
        const a = cp({
            id: 'a',
            description: 'one',
            created: now,
            conversationContext: {
                messageContent: 'hi',
                role: 'user',
                timestamp: now.toISOString(),
                index: 0,
                sessionId: 'sess-aaaa-bbbb',
            },
        });
        const b = cp({ id: 'b', description: 'manual', created: now });
        const groups = groupBySession([a, b]);
        assert.ok(groups.some((group) => group.id === 'session:sess-aaaa-bbbb' && group.checkpoints[0].id === 'a'));
        assert.ok(groups.some((group) => group.id === 'manual' && group.checkpoints[0].id === 'b'));
    });

    test('summarizeDiffResult counts reconstructed file statuses', () => {
        const diff: CheckpointDiffResult = {
            oldCheckpoint: { id: 'cp_old', description: 'old', created: new Date().toISOString() },
            newCheckpoint: { id: 'cp_new', description: 'new', created: new Date().toISOString() },
            files: [
                { relativePath: 'a.ts', status: 'added', oldContent: null, newContent: 'a' },
                { relativePath: 'b.ts', status: 'deleted', oldContent: 'b', newContent: null },
                { relativePath: 'c.ts', status: 'modified', oldContent: 'c1', newContent: 'c2' },
                { relativePath: 'd.ts', status: 'modified', oldContent: 'd1', newContent: 'd2' },
            ],
        };
        assert.deepStrictEqual(summarizeDiffResult(diff), { added: 1, removed: 1, modified: 2 });
    });

    test('diffResourceUris uses reconstructed contents, not delta snapshots', () => {
        const provider = new CheckpointDiffContentProvider();
        const diff: CheckpointDiffResult = {
            oldCheckpoint: { id: 'cp_old', description: 'old', created: new Date().toISOString() },
            newCheckpoint: { id: 'cp_new', description: 'new', created: new Date().toISOString() },
            files: [{
                relativePath: 'src/app.ts',
                status: 'modified',
                oldContent: ' cons t x = 1',
                newContent: 'const x = 2',
            }],
        };
        const resource = diffResourceUris(provider, diff, diff.files[0]);
        assert.strictEqual(resource.left.scheme, 'knox-checkpoint');
        assert.strictEqual(resource.right.scheme, 'knox-checkpoint');
        assert.strictEqual(provider.provideTextDocumentContent(resource.left), ' cons t x = 1');
        assert.strictEqual(provider.provideTextDocumentContent(resource.right), 'const x = 2');
    });

    test('tree lists the same checkpoint ids as the workspace history', async () => {
        const history: CheckpointInfo[] = [
            cp({
                id: 'cp-2',
                description: 'second',
                created: new Date('2026-08-17T12:00:00.000Z'),
                fileStats: { total: 2, created: 1, deleted: 0, modified: 1, inventoryCount: 4 },
            }),
            cp({
                id: 'cp-1',
                description: 'first',
                created: new Date('2026-08-16T12:00:00.000Z'),
                fileInventory: ['a.ts', 'b.ts'],
            }),
        ];
        const manager = {
            getCheckpointHistoryForWorkspace: () => history,
            getCheckpointStatistics: async () => ({
                totalCheckpoints: 2,
                totalSessions: 1,
                totalStorageBytes: 10,
            }),
        } as any;

        const provider = new CheckpointTreeProvider(manager);
        assert.deepStrictEqual(provider.getVisibleHistory().map((item) => item.id), ['cp-2', 'cp-1']);

        const roots = await provider.getChildren();
        const groups = roots.filter((item) => item.contextValue === 'dateGroup');
        const listed: string[] = [];
        for (const group of groups) {
            const children = await provider.getChildren(group);
            for (const child of children) {
                if (child.checkpointId) {
                    listed.push(child.checkpointId);
                }
            }
        }
        assert.deepStrictEqual(listed.sort(), ['cp-1', 'cp-2']);
        assert.ok(PAGE_SIZE >= 1);
    });
});
