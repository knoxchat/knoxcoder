import * as assert from 'node:assert';

import { countLineDelta } from './restorePreview';
import {
    countSessionRollbacks,
    lineCountsFromDiff,
    measureSessionLineCounts,
    newestCheckpointId,
} from './aiSessionMetrics';
import type { CheckpointFileDiff } from './types';

suite('AI session metrics (CP-35)', () => {
    test('lineCountsFromDiff counts additions and deletions for tracked files', () => {
        const files: CheckpointFileDiff[] = [
            {
                relativePath: 'a.ts',
                status: 'modified',
                oldContent: 'one\n',
                newContent: 'one\ntwo\nthree\n',
            },
            {
                relativePath: 'b.ts',
                status: 'modified',
                oldContent: 'keep\ngone\n',
                newContent: 'keep\n',
            },
            {
                relativePath: 'ignored.ts',
                status: 'modified',
                oldContent: 'a\n',
                newContent: 'a\nb\n',
            },
        ];
        const counts = lineCountsFromDiff(files, ['a.ts', 'b.ts']);
        assert.strictEqual(counts.filesChanged, 2);
        assert.ok(counts.linesAdded > 0);
        assert.ok(counts.linesDeleted > 0);
        const a = countLineDelta('one\n', 'one\ntwo\nthree\n');
        const b = countLineDelta('keep\ngone\n', 'keep\n');
        assert.strictEqual(counts.linesAdded, a.additions + b.additions);
        assert.strictEqual(counts.linesDeleted, a.deletions + b.deletions);
    });

    test('measureSessionLineCounts omits results without a baseline or diff API', async () => {
        const missing = await measureSessionLineCounts({}, 'base', 'end', ['a.ts']);
        assert.strictEqual(missing, undefined);
        const same = await measureSessionLineCounts(
            { computeCheckpointDiff: async () => ({ files: [] }) },
            'same',
            'same',
            [],
        );
        assert.deepStrictEqual(same, { filesChanged: 0, linesAdded: 0, linesDeleted: 0 });
    });

    test('countSessionRollbacks counts restore events inside the session window', async () => {
        const startedAt = new Date('2026-08-17T10:00:00.000Z');
        const endedAt = new Date('2026-08-17T11:00:00.000Z');
        const rollbacks = await countSessionRollbacks(
            {
                getAuditTrail: async () => [
                    { timestamp: '2026-08-17T09:00:00.000Z', outcome: 'success' },
                    { timestamp: '2026-08-17T10:15:00.000Z', outcome: 'success' },
                    { timestamp: '2026-08-17T10:40:00.000Z', outcome: 'failure' },
                    { timestamp: '2026-08-17T10:50:00.000Z', outcome: 'success' },
                ],
            },
            startedAt,
            endedAt,
        );
        assert.strictEqual(rollbacks, 2);
        assert.strictEqual(await countSessionRollbacks({}, startedAt, endedAt), undefined);
    });

    test('newestCheckpointId picks the latest created checkpoint', () => {
        assert.strictEqual(newestCheckpointId([]), undefined);
        assert.strictEqual(
            newestCheckpointId([
                { id: 'old', created: new Date('2026-01-01T00:00:00.000Z') },
                { id: 'new', created: new Date('2026-08-17T00:00:00.000Z') },
            ]),
            'new',
        );
    });
});
