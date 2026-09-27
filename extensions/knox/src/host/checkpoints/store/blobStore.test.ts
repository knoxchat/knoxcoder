import * as assert from 'node:assert';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { gunzipSync } from 'node:zlib';

import {
    BLOB_COMPRESS_THRESHOLD,
    blobExists,
    blobObjectPaths,
    computeObjectStoreBytes,
    gcUnreferencedBlobs,
    getBlob,
    hashBlobBytes,
    hydrateSnapshotContents,
    putBlob,
    referencedBlobHashes,
    storeHasEncryptedBlobs,
    summarizeObjectStore,
    summarizeUnreferencedBlobs,
} from './blobStore';
import { BlobEncryptionError, memoryEncryptionKeyProvider } from './blobEncryption';

async function withTempStore(fn: (storageRoot: string) => Promise<void>): Promise<void> {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-blobs-'));
    try {
        await fn(storageRoot);
    } finally {
        await fs.rm(storageRoot, { recursive: true, force: true });
    }
}

suite('blobStore', () => {
    test('put/get round-trips raw bytes and hashes SHA-256 of the payload', async () => {
        await withTempStore(async (storageRoot) => {
            const bytes = Buffer.from('hello checkpoint', 'utf8');
            const hash = await putBlob(storageRoot, bytes, { compress: false });
            assert.strictEqual(hash, createHash('sha256').update(bytes).digest('hex'));
            assert.strictEqual(hash, hashBlobBytes(bytes));
            const loaded = await getBlob(storageRoot, hash);
            assert.deepStrictEqual(loaded, bytes);
            const paths = blobObjectPaths(storageRoot, hash);
            await fs.access(paths.raw);
            await assert.rejects(fs.access(paths.gz));
        });
    });

    test('identical bytes share one object', async () => {
        await withTempStore(async (storageRoot) => {
            const bytes = Buffer.from('shared', 'utf8');
            const first = await putBlob(storageRoot, bytes, { compress: false });
            const second = await putBlob(storageRoot, bytes, { compress: false });
            assert.strictEqual(first, second);
            const paths = blobObjectPaths(storageRoot, first);
            const entries = await fs.readdir(paths.dir);
            assert.deepStrictEqual(entries, [first]);
        });
    });

    test('compresses blobs at or above the threshold and restores identically', async () => {
        await withTempStore(async (storageRoot) => {
            const bytes = Buffer.alloc(BLOB_COMPRESS_THRESHOLD + 16, 0x61);
            const hash = await putBlob(storageRoot, bytes, { compress: true });
            const paths = blobObjectPaths(storageRoot, hash);
            await fs.access(paths.gz);
            await assert.rejects(fs.access(paths.raw));
            const onDisk = await fs.readFile(paths.gz);
            assert.deepStrictEqual(gunzipSync(onDisk), bytes);
            assert.deepStrictEqual(await getBlob(storageRoot, hash), bytes);
        });
    });

    test('enableCompression false stores raw objects even for large blobs', async () => {
        await withTempStore(async (storageRoot) => {
            const bytes = Buffer.alloc(BLOB_COMPRESS_THRESHOLD + 16, 0x62);
            const hash = await putBlob(storageRoot, bytes, { compress: false });
            const paths = blobObjectPaths(storageRoot, hash);
            await fs.access(paths.raw);
            await assert.rejects(fs.access(paths.gz));
            assert.deepStrictEqual(await getBlob(storageRoot, hash), bytes);
        });
    });

    test('GC deletes unreferenced blobs and keeps shared ones', async () => {
        await withTempStore(async (storageRoot) => {
            const keep = await putBlob(storageRoot, Buffer.from('keep-me'), { compress: false });
            const drop = await putBlob(storageRoot, Buffer.from('drop-me'), { compress: false });
            assert.strictEqual(await blobExists(storageRoot, drop), true);
            const pendingOrphans = await summarizeUnreferencedBlobs(storageRoot, [keep]);
            assert.strictEqual(pendingOrphans.count, 1);

            const result = await gcUnreferencedBlobs(storageRoot, [keep]);
            assert.strictEqual(result.deleted, 1);
            assert.strictEqual(await blobExists(storageRoot, keep), true);
            assert.strictEqual(await blobExists(storageRoot, drop), false);
            assert.ok((await computeObjectStoreBytes(storageRoot)) > 0);
            const summary = await summarizeObjectStore(storageRoot);
            assert.strictEqual(summary.blobCount, 1);
            assert.strictEqual(summary.checkpointDataBytes, await computeObjectStoreBytes(storageRoot));
            const orphans = await summarizeUnreferencedBlobs(storageRoot, [keep]);
            assert.strictEqual(orphans.count, 0);
        });
    });

    test('referencedBlobHashes skips deleted and non-sha256 hashes', () => {
        assert.deepStrictEqual(referencedBlobHashes([
            { hash: 'a'.repeat(64) },
            { hash: 'tampered' },
            { hash: 'b'.repeat(64), deleted: true },
            { hash: 'c'.repeat(64), changeType: 'deleted' },
        ]), ['a'.repeat(64)]);
    });

    test('encryptAtRest stores AES-GCM objects that are not UTF-8 source', async () => {
        await withTempStore(async (storageRoot) => {
            const key = (await memoryEncryptionKeyProvider().getOrCreate());
            const bytes = Buffer.from('export const secret = "plaintext-source";\n', 'utf8');
            const hash = await putBlob(storageRoot, bytes, { compress: false, encrypt: true, encryptionKey: key });
            const paths = blobObjectPaths(storageRoot, hash);
            await fs.access(paths.enc);
            await assert.rejects(fs.access(paths.raw));
            const onDisk = await fs.readFile(paths.enc);
            assert.ok(!onDisk.toString('utf8').includes('plaintext-source'));
            assert.deepStrictEqual(await getBlob(storageRoot, hash, { encryptionKey: key }), bytes);
            assert.strictEqual(await storeHasEncryptedBlobs(storageRoot), true);
        });
    });

    test('encrypted gzip blobs round-trip and fail clearly without a key', async () => {
        await withTempStore(async (storageRoot) => {
            const key = (await memoryEncryptionKeyProvider().getOrCreate());
            const bytes = Buffer.alloc(BLOB_COMPRESS_THRESHOLD + 16, 0x63);
            const hash = await putBlob(storageRoot, bytes, { compress: true, encrypt: true, encryptionKey: key });
            const paths = blobObjectPaths(storageRoot, hash);
            await fs.access(paths.enc);
            await assert.rejects(fs.access(paths.gz));
            assert.deepStrictEqual(await getBlob(storageRoot, hash, { encryptionKey: key }), bytes);
            await assert.rejects(
                () => getBlob(storageRoot, hash),
                (error: unknown) => error instanceof BlobEncryptionError && error.code === 'missing_key',
            );
        });
    });

    test('hydrateSnapshotContents fills content from blobs', async () => {
        await withTempStore(async (storageRoot) => {
            const bytes = Buffer.from('export const n = 1;\n', 'utf8');
            const hash = await putBlob(storageRoot, bytes, { compress: false });
            const hydrated = await hydrateSnapshotContents(storageRoot, [{
                relativePath: 'a.ts',
                hash,
                encoding: 'utf8',
            }]);
            assert.strictEqual(hydrated[0].content, 'export const n = 1;\n');
        });
    });

    test('utf16le and utf16be hydrate without going through UTF-8', async () => {
        await withTempStore(async (storageRoot) => {
            const le = Buffer.from('\uFEFFHi', 'utf16le');
            const hash = await putBlob(storageRoot, le, { compress: false });
            const hydrated = await hydrateSnapshotContents(storageRoot, [{
                relativePath: 'hello.txt',
                hash,
                encoding: 'utf16le',
            }]);
            assert.strictEqual(hydrated[0].content, '\uFEFFHi');
            assert.deepStrictEqual(
                Buffer.from(hydrated[0].content ?? '', 'utf16le'),
                le,
            );
        });
    });
});
