import * as assert from 'node:assert';

import {
    CHECKPOINT_SCHEMA_VERSION,
    CHECKPOINT_SCHEMA_VERSION_V1,
    computeCheckpointContentSha256,
    verifyStoredCheckpointChecksum,
} from './checkpointIntegrity';

const sampleV2 = {
    id: 'cp_11111111-1111-4111-8111-111111111111',
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    fileInventory: ['b.ts', 'a.ts'],
    skippedFiles: [{ path: 'huge.bin', reason: 'too_large' as const }],
    fileSnapshots: [
        {
            relativePath: 'b.ts',
            hash: 'bbb',
            encoding: 'utf8',
            size: 1,
            changeType: 'modified' as const,
        },
        {
            relativePath: 'a.ts',
            hash: 'aaa',
            encoding: 'utf8',
            size: 1,
            changeType: 'created' as const,
        },
    ],
};

const sampleV1 = {
    id: 'cp_11111111-1111-4111-8111-111111111111',
    schemaVersion: CHECKPOINT_SCHEMA_VERSION_V1,
    fileInventory: ['b.ts', 'a.ts'],
    skippedFiles: [{ path: 'huge.bin', reason: 'too_large' as const }],
    fileSnapshots: [
        {
            relativePath: 'b.ts',
            content: 'b',
            encoding: 'utf8',
            size: 1,
            changeType: 'modified' as const,
        },
        {
            relativePath: 'a.ts',
            content: 'a',
            encoding: 'utf8',
            size: 1,
            changeType: 'created' as const,
        },
    ],
};

suite('checkpointIntegrity', () => {
    test('schema 2 digest is stable regardless of snapshot and inventory order', () => {
        const reversed = {
            ...sampleV2,
            fileInventory: [...sampleV2.fileInventory].reverse(),
            fileSnapshots: [...sampleV2.fileSnapshots].reverse(),
        };
        assert.strictEqual(
            computeCheckpointContentSha256(sampleV2),
            computeCheckpointContentSha256(reversed),
        );
        assert.strictEqual(CHECKPOINT_SCHEMA_VERSION, 2);
    });

    test('schema 2 checksum ignores inlined content and uses blob hashes', () => {
        const withContent = {
            ...sampleV2,
            fileSnapshots: sampleV2.fileSnapshots.map((snapshot) => ({
                ...snapshot,
                content: 'should-not-affect-digest',
            })),
        };
        assert.strictEqual(
            computeCheckpointContentSha256(sampleV2),
            computeCheckpointContentSha256(withContent),
        );
    });

    test('legacy manifests without a checksum still verify', () => {
        const result = verifyStoredCheckpointChecksum(sampleV1);
        assert.deepStrictEqual(result, { ok: true });
    });

    test('tampered blob hash fails the stored checksum', () => {
        const contentSha256 = computeCheckpointContentSha256(sampleV2);
        const tampered = {
            ...sampleV2,
            contentSha256,
            fileSnapshots: sampleV2.fileSnapshots.map((snapshot) =>
                snapshot.relativePath === 'a.ts'
                    ? { ...snapshot, hash: 'pwned' }
                    : snapshot,
            ),
        };
        const result = verifyStoredCheckpointChecksum(tampered);
        assert.deepStrictEqual(result, { ok: false, reason: 'contentSha256 mismatch' });
    });

    test('matching checksum verifies', () => {
        const contentSha256 = computeCheckpointContentSha256(sampleV2);
        const result = verifyStoredCheckpointChecksum({ ...sampleV2, contentSha256 });
        assert.deepStrictEqual(result, { ok: true });
    });

    test('schema 1 checksum still covers inlined content', () => {
        const contentSha256 = computeCheckpointContentSha256(sampleV1);
        const tampered = {
            ...sampleV1,
            contentSha256,
            fileSnapshots: sampleV1.fileSnapshots.map((snapshot) =>
                snapshot.relativePath === 'a.ts'
                    ? { ...snapshot, content: 'pwned' }
                    : snapshot,
            ),
        };
        const result = verifyStoredCheckpointChecksum(tampered);
        assert.deepStrictEqual(result, { ok: false, reason: 'contentSha256 mismatch' });
    });
});
