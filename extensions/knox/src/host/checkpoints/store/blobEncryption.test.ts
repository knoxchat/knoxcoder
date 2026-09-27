import * as assert from 'node:assert';
import { randomBytes } from 'node:crypto';

import {
    BlobEncryptionError,
    CHECKPOINT_ENCRYPTION_SECRET_ID,
    decryptBlobPayload,
    encryptBlobPayload,
    getCheckpointEncryptionKey,
    getOrCreateCheckpointEncryptionKey,
    isEncryptedBlobBytes,
    memoryEncryptionKeyProvider,
} from './blobEncryption';

suite('blobEncryption', () => {
    test('round-trips AES-GCM payloads and marks them as encrypted', () => {
        const key = randomBytes(32);
        const payload = Buffer.from('export const secret = 1;\n', 'utf8');
        const encrypted = encryptBlobPayload(payload, key, false);
        assert.strictEqual(isEncryptedBlobBytes(encrypted), true);
        assert.ok(!encrypted.includes(payload));
        const decrypted = decryptBlobPayload(encrypted, key);
        assert.strictEqual(decrypted.gzipped, false);
        assert.deepStrictEqual(decrypted.payload, payload);
    });

    test('missing key is a clear error, not a checksum mismatch', () => {
        const key = randomBytes(32);
        const encrypted = encryptBlobPayload(Buffer.from('hello'), key, true);
        assert.throws(
            () => decryptBlobPayload(encrypted, undefined),
            (error: unknown) => error instanceof BlobEncryptionError && error.code === 'missing_key',
        );
        assert.throws(
            () => decryptBlobPayload(encrypted, randomBytes(32)),
            (error: unknown) => error instanceof BlobEncryptionError && error.code === 'decrypt_failed',
        );
    });

    test('SecretStorage key survives a simulated reload', async () => {
        const store = new Map<string, string>();
        const secrets = {
            async get(id: string) {
                return store.get(id);
            },
            async store(id: string, value: string) {
                store.set(id, value);
            },
        };
        const created = await getOrCreateCheckpointEncryptionKey(secrets);
        assert.strictEqual(created.length, 32);
        assert.ok(store.has(CHECKPOINT_ENCRYPTION_SECRET_ID));
        const reloaded = await getCheckpointEncryptionKey(secrets);
        assert.deepStrictEqual(reloaded, created);
        const again = await getOrCreateCheckpointEncryptionKey(secrets);
        assert.deepStrictEqual(again, created);
    });

    test('memory provider creates a key once', async () => {
        const provider = memoryEncryptionKeyProvider();
        assert.strictEqual(await provider.get(), undefined);
        const first = await provider.getOrCreate();
        const second = await provider.getOrCreate();
        assert.deepStrictEqual(first, second);
        assert.deepStrictEqual(await provider.get(), first);
    });
});
