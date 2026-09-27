import * as assert from 'node:assert';

import { CheckpointConflictResolver } from './ConflictResolver';

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

suite('CheckpointConflictResolver concurrency (CP-14)', () => {
    teardown(() => {
        CheckpointConflictResolver.getInstance().dispose();
    });

    test('overlapping restores serialize; the second waits', async () => {
        const resolver = CheckpointConflictResolver.getInstance();
        resolver.dispose();
        const log: string[] = [];

        const first = (async () => {
            const lease = await resolver.acquire({
                operation: 'restore',
                sessionId: 's1',
                affectedFiles: ['src/a.ts'],
            });
            assert.strictEqual(lease.success, true);
            log.push('a-start');
            await delay(40);
            log.push('a-end');
            await lease.release();
        })();

        await delay(10);

        const second = (async () => {
            const lease = await resolver.acquire({
                operation: 'restore',
                sessionId: 's2',
                affectedFiles: ['src/a.ts', 'src/nested/a.ts'],
            });
            assert.strictEqual(lease.success, true);
            log.push('b-start');
            log.push('b-end');
            await lease.release();
        })();

        await Promise.all([first, second]);
        assert.deepStrictEqual(log, ['a-start', 'a-end', 'b-start', 'b-end']);
        assert.strictEqual(resolver.getConflictStats().activeOperations, 0);
        assert.ok(resolver.getConflictStats().totalConflicts >= 1);
    });

    test('non-overlapping restores may proceed concurrently', async () => {
        const resolver = CheckpointConflictResolver.getInstance();
        resolver.dispose();
        const log: string[] = [];

        const first = (async () => {
            const lease = await resolver.acquire({
                operation: 'restore',
                sessionId: 's1',
                affectedFiles: ['a.ts'],
            });
            log.push('a-start');
            await delay(40);
            log.push('a-end');
            await lease.release();
        })();

        await delay(10);

        const second = (async () => {
            const lease = await resolver.acquire({
                operation: 'restore',
                sessionId: 's2',
                affectedFiles: ['b.ts'],
            });
            log.push('b-start');
            await delay(40);
            log.push('b-end');
            await lease.release();
        })();

        await Promise.all([first, second]);
        assert.ok(log.indexOf('b-start') < log.indexOf('a-end'), 'b should start before a finishes');
        assert.ok(log.indexOf('a-start') < log.indexOf('b-end'));
    });

    test('empty affectedFiles overlaps every in-flight restore', async () => {
        const resolver = CheckpointConflictResolver.getInstance();
        resolver.dispose();
        const log: string[] = [];

        const restore = (async () => {
            const lease = await resolver.acquire({
                operation: 'restore',
                sessionId: 's1',
                affectedFiles: ['a.ts'],
            });
            log.push('restore-start');
            await delay(40);
            log.push('restore-end');
            await lease.release();
        })();

        await delay(10);

        const create = (async () => {
            const lease = await resolver.acquire({
                operation: 'create',
                sessionId: 's2',
                affectedFiles: [],
            });
            log.push('create-start');
            await lease.release();
        })();

        await Promise.all([restore, create]);
        assert.deepStrictEqual(log, ['restore-start', 'restore-end', 'create-start']);
    });

    test('resolveConflict holds the lease until release', async () => {
        const resolver = CheckpointConflictResolver.getInstance();
        resolver.dispose();

        const lease = await resolver.resolveConflict('restore', 'session-hold', ['held.ts']);
        assert.strictEqual(lease.success, true);
        assert.strictEqual(resolver.getConflictStats().activeOperations, 1);

        const overlappingStarted = Date.now();
        const waiter = resolver.acquire({
            operation: 'restore',
            sessionId: 'session-wait',
            affectedFiles: ['held.ts'],
        });

        await delay(20);
        await lease.release();
        const waited = await waiter;
        assert.ok(Date.now() - overlappingStarted >= 20);
        assert.strictEqual(waited.success, true);
        await waited.release();
    });
});
