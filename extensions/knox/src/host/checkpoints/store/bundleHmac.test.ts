import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    CheckpointBundleError,
    sealCheckpointBundle,
} from './checkpointBundle';
import {
    attachBundleHmac,
    hmacKeyIdFromKey,
    loadOrCreateHmacKey,
    readHmacKey,
    signBundleContentSha256,
    verifyOptionalBundleHmac,
} from './bundleHmac';

suite('bundle HMAC (CP-27)', () => {
    test('loadOrCreate writes a 32-byte key and reuses it', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-hmac-'));
        const keyPath = path.join(dir, 'hmac.key');
        try {
            const first = await loadOrCreateHmacKey(keyPath);
            const second = await loadOrCreateHmacKey(keyPath);
            assert.strictEqual(first.length, 32);
            assert.deepStrictEqual(second, first);
            assert.strictEqual(hmacKeyIdFromKey(first).length, 16);
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    test('verifyOptionalBundleHmac rejects a matching-key tamper', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-hmac-'));
        const keyPath = path.join(dir, 'hmac.key');
        try {
            const key = await loadOrCreateHmacKey(keyPath);
            const contentSha256 = 'a'.repeat(64);
            const hmacSha256 = signBundleContentSha256(contentSha256, key);
            verifyOptionalBundleHmac(
                { contentSha256, hmacSha256, hmacKeyId: hmacKeyIdFromKey(key) },
                key,
            );
            assert.throws(
                () => verifyOptionalBundleHmac(
                    { contentSha256, hmacSha256: '0'.repeat(64), hmacKeyId: hmacKeyIdFromKey(key) },
                    key,
                ),
                (error: unknown) => error instanceof CheckpointBundleError && error.code === 'HMAC_MISMATCH',
            );
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    test('a different key id skips HMAC so USB/email import still works', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-hmac-'));
        try {
            const producer = await loadOrCreateHmacKey(path.join(dir, 'producer.key'));
            const recipient = await loadOrCreateHmacKey(path.join(dir, 'recipient.key'));
            const contentSha256 = 'b'.repeat(64);
            verifyOptionalBundleHmac(
                {
                    contentSha256,
                    hmacSha256: signBundleContentSha256(contentSha256, producer),
                    hmacKeyId: hmacKeyIdFromKey(producer),
                },
                recipient,
            );
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    test('attachBundleHmac adds hmac fields without changing contentSha256', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-hmac-'));
        const keyPath = path.join(dir, 'hmac.key');
        const filePath = path.join(dir, 'bundle.json');
        try {
            const bundle = sealCheckpointBundle({
                exportedAt: '2026-08-17T00:00:00.000Z',
                checkpointIds: [],
                messageCheckpoints: {},
                stableIdCheckpoints: {},
                checkpoints: [],
                blobs: [],
            });
            await fs.writeFile(filePath, JSON.stringify(bundle, null, 2), 'utf8');
            const hmac = await attachBundleHmac(filePath, keyPath);
            const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
            assert.strictEqual(parsed.contentSha256, bundle.contentSha256);
            assert.strictEqual(parsed.hmacSha256, hmac.hmacSha256);
            assert.strictEqual(parsed.hmacKeyId, hmac.hmacKeyId);
            assert.ok(await readHmacKey(keyPath));
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});
