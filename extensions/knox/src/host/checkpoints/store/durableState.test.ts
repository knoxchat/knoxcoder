import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    loadSessionMap,
    loadUndoStackState,
    saveSessionMap,
    saveUndoStackState,
    sessionsStatePath,
    undoStackStatePath,
} from './durableState';

async function withTempStore(fn: (storageRoot: string) => Promise<void>): Promise<void> {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-durable-'));
    try {
        await fn(storageRoot);
    } finally {
        await fs.rm(storageRoot, { recursive: true, force: true });
    }
}

suite('durableState (CP-31)', () => {
    test('session map round-trips and ignores corrupt records', async () => {
        await withTempStore(async (storageRoot) => {
            await saveSessionMap(storageRoot, [{
                id: 'chat_abc',
                type: 'chat',
                workspacePath: '/tmp/proj',
                created: '2026-08-17T00:00:00.000Z',
                lastAccessed: '2026-08-17T01:00:00.000Z',
                metadata: { sessionType: 'chat' },
            }]);

            const loaded = await loadSessionMap(storageRoot);
            assert.strictEqual(loaded.length, 1);
            assert.strictEqual(loaded[0].id, 'chat_abc');
            assert.strictEqual(loaded[0].type, 'chat');

            await fs.writeFile(sessionsStatePath(storageRoot), '{not json', 'utf8');
            assert.deepStrictEqual(await loadSessionMap(storageRoot), []);
        });
    });

    test('undo stack round-trips and clamps currentIndex', async () => {
        await withTempStore(async (storageRoot) => {
            await saveUndoStackState(storageRoot, {
                currentIndex: 99,
                stack: ['cp_a', 'cp_b'],
                maxSize: 50,
            });

            const loaded = await loadUndoStackState(storageRoot);
            assert.ok(loaded);
            assert.deepStrictEqual(loaded.stack, ['cp_a', 'cp_b']);
            assert.strictEqual(loaded.currentIndex, 1);
            assert.strictEqual(loaded.maxSize, 50);

            assert.strictEqual(await loadUndoStackState(path.join(storageRoot, 'missing')), null);
            await fs.writeFile(undoStackStatePath(storageRoot), '{"stack":[1,2]}', 'utf8');
            const recovered = await loadUndoStackState(storageRoot);
            assert.ok(recovered);
            assert.deepStrictEqual(recovered.stack, []);
        });
    });
});
