import * as assert from 'node:assert';

import { CHECKPOINT_SCHEMA_VERSION, computeCheckpointContentSha256 } from './checkpointIntegrity';
import {
    CHECKPOINT_BUNDLE_FORMAT,
    CHECKPOINT_BUNDLE_SCHEMA_VERSION,
    encodeBundleBlob,
    parseCheckpointBundleJson,
    sealCheckpointBundle,
    verifyCheckpointBundle,
} from './checkpointBundle';

const CHECKPOINT_ID = 'cp_11111111-1111-4111-8111-111111111111';

function sampleCheckpoint(blobHash: string, size: number) {
    const checkpoint = {
        id: CHECKPOINT_ID,
        description: 'sample',
        created: '2026-01-01T00:00:00.000Z',
        schemaVersion: CHECKPOINT_SCHEMA_VERSION,
        fileInventory: ['a.ts'],
        fileSnapshots: [{
            relativePath: 'a.ts',
            hash: blobHash,
            encoding: 'utf8',
            lastModified: '2026-01-01T00:00:00.000Z',
            size,
            changeType: 'created' as const,
        }],
    };
    return {
        ...checkpoint,
        contentSha256: computeCheckpointContentSha256(checkpoint),
    };
}

function sampleBundle(bytes = Buffer.from('hello checkpoint', 'utf8')) {
    const blob = encodeBundleBlob(bytes);
    return sealCheckpointBundle({
        exportedAt: '2026-01-01T00:00:00.000Z',
        workspaceHint: '/workspace',
        workspaceKey: 'abcd1234abcd1234',
        checkpointIds: [CHECKPOINT_ID],
        messageCheckpoints: {},
        stableIdCheckpoints: {},
        checkpoints: [sampleCheckpoint(blob.hash, bytes.length)],
        blobs: [blob],
    });
}

suite('checkpointBundle', () => {
    test('seal + verify round-trips a well-formed bundle', () => {
        const bundle = sampleBundle();
        assert.strictEqual(bundle.format, CHECKPOINT_BUNDLE_FORMAT);
        assert.strictEqual(bundle.schemaVersion, CHECKPOINT_BUNDLE_SCHEMA_VERSION);
        const verified = verifyCheckpointBundle(bundle);
        assert.strictEqual(verified.contentSha256, bundle.contentSha256);
        assert.strictEqual(verified.blobs.length, 1);
    });

    test('pretty-print and key order do not change the digest', () => {
        const bundle = sampleBundle();
        const reversed = {
            ...bundle,
            blobs: [...bundle.blobs],
            checkpoints: [...bundle.checkpoints],
        };
        const verified = verifyCheckpointBundle(JSON.parse(JSON.stringify(reversed)));
        assert.strictEqual(verified.contentSha256, bundle.contentSha256);
    });

    test('truncated JSON is rejected', () => {
        const raw = JSON.stringify(sampleBundle()).slice(0, 40);
        assert.throws(
            () => parseCheckpointBundleJson(raw),
            /Truncated or invalid checkpoint bundle/,
        );
    });

    test('tampered blob payload fails the bundle checksum', () => {
        const bundle = sampleBundle();
        bundle.blobs[0] = {
            ...bundle.blobs[0],
            data: Buffer.from('tampered').toString('base64'),
        };
        assert.throws(
            () => verifyCheckpointBundle(bundle),
            /contentSha256 mismatch/,
        );
    });

    test('tampered blob that keeps the bundle digest still fails the blob hash', () => {
        const bundle = sampleBundle();
        const tamperedBytes = Buffer.from('tampered-bytes');
        const tampered = sealCheckpointBundle({
            ...bundle,
            blobs: [{
                ...bundle.blobs[0],
                gzipped: false,
                size: tamperedBytes.length,
                data: tamperedBytes.toString('base64'),
            }],
        });
        assert.throws(
            () => verifyCheckpointBundle(tampered),
            /failed checksum/,
        );
    });

    test('missing referenced blob is rejected', () => {
        const bundle = sampleBundle();
        const missing = sealCheckpointBundle({
            ...bundle,
            blobs: [],
        });
        assert.throws(
            () => verifyCheckpointBundle(missing),
            /missing blob/,
        );
    });

    test('unsupported schemaVersion is rejected', () => {
        const bundle = {
            ...sampleBundle(),
            schemaVersion: 99,
        };
        assert.throws(
            () => verifyCheckpointBundle(bundle),
            /Unsupported bundle schemaVersion/,
        );
    });
});
