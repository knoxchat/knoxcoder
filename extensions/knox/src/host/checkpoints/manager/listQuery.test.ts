import * as assert from 'node:assert';

import {
    CHANGED_PATHS_INDEX_LIMIT,
    CHECKPOINT_LIST_PAGE_SIZE,
    changedPathsFromSnapshots,
    checkpointMatchesQuery,
    checkpointMatchesSession,
    isListableCheckpoint,
    paginateItems,
    selectIdRange,
} from './listQuery';

suite('checkpoint list query (CP-32)', () => {
    test('changedPathsFromSnapshots de-dupes, normalizes, and caps', () => {
        const paths = changedPathsFromSnapshots([
            { relativePath: 'src\\a.ts' },
            { relativePath: 'src/a.ts' },
            { relativePath: 'src/b.ts' },
            { relativePath: '' },
        ]);
        assert.deepStrictEqual(paths, ['src/a.ts', 'src/b.ts']);

        const many = changedPathsFromSnapshots(
            Array.from({ length: CHANGED_PATHS_INDEX_LIMIT + 40 }, (_, index) => ({
                relativePath: `f${index}.ts`,
            })),
        );
        assert.strictEqual(many.length, CHANGED_PATHS_INDEX_LIMIT);
    });

    test('matches description, id, tag, path, and session', () => {
        const checkpoint = {
            id: 'cp_aaaa-bbbb',
            description: 'Before auth refactor',
            tags: ['manual', 'auth'],
            sessionId: 'sess-1234',
            changedPaths: ['src/auth.ts', 'src/login.tsx'],
        };
        assert.ok(checkpointMatchesQuery(checkpoint, 'auth'));
        assert.ok(checkpointMatchesQuery(checkpoint, 'cp_aaaa'));
        assert.ok(checkpointMatchesQuery(checkpoint, 'manual'));
        assert.ok(checkpointMatchesQuery(checkpoint, 'login.tsx'));
        assert.ok(checkpointMatchesQuery(checkpoint, 'sess-1234'));
        assert.ok(!checkpointMatchesQuery(checkpoint, 'unrelated'));
        assert.ok(checkpointMatchesQuery(checkpoint, '  '));
        assert.ok(checkpointMatchesQuery({
            id: 'legacy',
            description: 'Old index row',
            fileInventory: ['src/legacy/auth.ts'],
        }, 'legacy/auth'));
    });

    test('thisSessionOnly keeps unlabeled checkpoints and the active session', () => {
        const labeled = { id: 'a', description: 'A', sessionId: 'sess-1' };
        const other = { id: 'b', description: 'B', sessionId: 'sess-2' };
        const unlabeled = { id: 'c', description: 'C' };
        assert.ok(checkpointMatchesSession(labeled, 'sess-1', true));
        assert.ok(!checkpointMatchesSession(other, 'sess-1', true));
        assert.ok(checkpointMatchesSession(unlabeled, 'sess-1', true));
        assert.ok(checkpointMatchesSession(other, 'sess-1', false));
    });

    test('paginate 500 items without returning the full set', () => {
        const items = Array.from({ length: 500 }, (_, index) => index);
        const page = paginateItems(items, 0, CHECKPOINT_LIST_PAGE_SIZE);
        assert.strictEqual(page.items.length, CHECKPOINT_LIST_PAGE_SIZE);
        assert.strictEqual(page.total, 500);
        assert.strictEqual(page.hasMore, true);
        const last = paginateItems(items, 450, CHECKPOINT_LIST_PAGE_SIZE);
        assert.deepStrictEqual(last.items, items.slice(450));
        assert.strictEqual(last.hasMore, false);
    });

    test('selectIdRange covers inclusive ordered ids', () => {
        const ids = ['a', 'b', 'c', 'd'];
        assert.deepStrictEqual(selectIdRange(ids, 'b', 'd'), ['b', 'c', 'd']);
        assert.deepStrictEqual(selectIdRange(ids, 'd', 'b'), ['b', 'c', 'd']);
        assert.deepStrictEqual(selectIdRange(ids, 'missing', 'c'), ['c']);
    });

    test('isListableCheckpoint hides user-query snapshots', () => {
        assert.ok(!isListableCheckpoint({
            id: 'u',
            description: 'User query at index 3',
            conversationContext: { role: 'user' },
        }));
        assert.ok(isListableCheckpoint({ id: 'm', description: 'Manual save' }));
    });
});
