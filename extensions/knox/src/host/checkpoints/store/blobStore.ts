import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { writeBufferAtomic } from './atomicWrite';
import {
    BlobEncryptionError,
    decryptBlobPayload,
    encryptBlobPayload,
} from './blobEncryption';

/** Gzip blobs at or above this size when compression is enabled. */
export const BLOB_COMPRESS_THRESHOLD = 4096;

export class BlobStoreError extends Error {
    constructor(
        message: string,
        readonly hash?: string,
    ) {
        super(message);
        this.name = 'BlobStoreError';
    }
}

export function hashBlobBytes(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
}

export function objectsDir(storageRoot: string): string {
    return path.join(storageRoot, 'objects');
}

export function blobObjectPaths(storageRoot: string, hash: string): {
    dir: string;
    raw: string;
    gz: string;
    enc: string;
} {
    const prefix = hash.slice(0, 2);
    const dir = path.join(objectsDir(storageRoot), prefix);
    return {
        dir,
        raw: path.join(dir, hash),
        gz: path.join(dir, `${hash}.gz`),
        enc: path.join(dir, `${hash}.enc`),
    };
}

/** In-memory / editor hint. Blob storage is always raw bytes. */
export type CheckpointContentEncoding = 'utf8' | 'utf16le' | 'utf16be' | 'base64';

export function normalizeCheckpointEncoding(encoding: string | undefined): CheckpointContentEncoding {
    if (encoding === 'utf16le' || encoding === 'utf16be' || encoding === 'base64') {
        return encoding;
    }
    return 'utf8';
}

export function isBinaryCheckpointEncoding(encoding: string | undefined): boolean {
    return normalizeCheckpointEncoding(encoding) === 'base64';
}

function swapUtf16Endian(bytes: Buffer): Buffer {
    const swapped = Buffer.allocUnsafe(bytes.length);
    const even = bytes.length - (bytes.length % 2);
    for (let i = 0; i < even; i += 2) {
        swapped[i] = bytes[i + 1];
        swapped[i + 1] = bytes[i];
    }
    if (bytes.length % 2 === 1) {
        swapped[bytes.length - 1] = bytes[bytes.length - 1];
    }
    return swapped;
}

export function bytesFromSnapshotContent(content: string, encoding: string): Buffer {
    switch (normalizeCheckpointEncoding(encoding)) {
        case 'base64':
            return Buffer.from(content, 'base64');
        case 'utf16le':
            return Buffer.from(content, 'utf16le');
        case 'utf16be':
            return swapUtf16Endian(Buffer.from(content, 'utf16le'));
        default:
            return Buffer.from(content, 'utf8');
    }
}

export function snapshotContentFromBytes(bytes: Buffer, encoding: string): string {
    switch (normalizeCheckpointEncoding(encoding)) {
        case 'base64':
            return bytes.toString('base64');
        case 'utf16le':
            return bytes.toString('utf16le');
        case 'utf16be':
            return swapUtf16Endian(bytes).toString('utf16le');
        default:
            return bytes.toString('utf8');
    }
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

export async function blobExists(storageRoot: string, hash: string): Promise<boolean> {
    const paths = blobObjectPaths(storageRoot, hash);
    return (await pathExists(paths.raw))
        || (await pathExists(paths.gz))
        || (await pathExists(paths.enc));
}

export interface PutBlobOptions {
    compress?: boolean;
    encrypt?: boolean;
    encryptionKey?: Buffer;
}

export interface GetBlobOptions {
    encryptionKey?: Buffer;
}

/**
 * Store raw file bytes under SHA-256. Identical bytes share one object.
 * When `compress` is true, blobs ≥ 4KB are gzipped. When `encrypt` is true,
 * the (optionally gzipped) payload is AES-GCM encrypted as `{hash}.enc`.
 */
export async function putBlob(
    storageRoot: string,
    bytes: Buffer,
    options?: PutBlobOptions,
): Promise<string> {
    const hash = hashBlobBytes(bytes);
    if (await blobExists(storageRoot, hash)) {
        return hash;
    }

    const paths = blobObjectPaths(storageRoot, hash);
    await fs.mkdir(paths.dir, { recursive: true });

    const compress = options?.compress !== false && bytes.length >= BLOB_COMPRESS_THRESHOLD;
    const payload = compress ? gzipSync(bytes) : bytes;
    if (options?.encrypt) {
        if (!options.encryptionKey) {
            throw new BlobEncryptionError(
                'Checkpoint encryption key is unavailable.',
                'missing_key',
            );
        }
        const encrypted = encryptBlobPayload(payload, options.encryptionKey, compress);
        await writeBufferAtomic(paths.enc, encrypted);
    } else if (compress) {
        await writeBufferAtomic(paths.gz, payload);
    } else {
        await writeBufferAtomic(paths.raw, bytes);
    }
    return hash;
}

export async function getBlob(
    storageRoot: string,
    hash: string,
    options?: GetBlobOptions,
): Promise<Buffer> {
    const paths = blobObjectPaths(storageRoot, hash);
    let bytes: Buffer;
    if (await pathExists(paths.enc)) {
        const encrypted = await fs.readFile(paths.enc);
        const { payload, gzipped } = decryptBlobPayload(encrypted, options?.encryptionKey);
        bytes = gzipped ? gunzipSync(payload) : payload;
    } else if (await pathExists(paths.gz)) {
        bytes = gunzipSync(await fs.readFile(paths.gz));
    } else if (await pathExists(paths.raw)) {
        bytes = await fs.readFile(paths.raw);
    } else {
        throw new BlobStoreError(`Missing blob ${hash}`, hash);
    }

    const actual = hashBlobBytes(bytes);
    if (actual !== hash) {
        throw new BlobStoreError(`Blob ${hash} failed checksum (got ${actual})`, hash);
    }
    return bytes;
}

export interface HydrateableSnapshot {
    content?: string;
    hash?: string;
    encoding: string;
    deleted?: boolean;
    changeType?: string;
}

export async function hydrateSnapshotContents<T extends HydrateableSnapshot>(
    storageRoot: string,
    snapshots: T[],
    options?: GetBlobOptions,
): Promise<Array<T & { content?: string }>> {
    const hydrated: T[] = [];
    for (const snapshot of snapshots) {
        if (
            snapshot.deleted ||
            snapshot.changeType === 'deleted' ||
            snapshot.content != null ||
            !snapshot.hash
        ) {
            hydrated.push(snapshot);
            continue;
        }
        const bytes = await getBlob(storageRoot, snapshot.hash, options);
        hydrated.push({
            ...snapshot,
            content: snapshotContentFromBytes(bytes, snapshot.encoding || 'utf8'),
        });
    }
    return hydrated;
}

const SHA256_HEX = /^[a-f0-9]{64}$/i;

export function isBlobObjectHash(hash: string | undefined): hash is string {
    return typeof hash === 'string' && SHA256_HEX.test(hash);
}

export function referencedBlobHashes(
    snapshots: Array<{ hash?: string; deleted?: boolean; changeType?: string }> | undefined,
): string[] {
    const hashes: string[] = [];
    for (const snapshot of snapshots ?? []) {
        if (snapshot.deleted || snapshot.changeType === 'deleted' || !isBlobObjectHash(snapshot.hash)) {
            continue;
        }
        hashes.push(snapshot.hash);
    }
    return hashes;
}

export async function storeHasEncryptedBlobs(storageRoot: string): Promise<boolean> {
    const objects = await listBlobObjectFiles(storageRoot);
    return objects.some((object) => object.filePath.endsWith('.enc'));
}

async function listBlobObjectFiles(storageRoot: string): Promise<Array<{
    hash: string;
    filePath: string;
}>> {
    const root = objectsDir(storageRoot);
    let prefixes: string[];
    try {
        prefixes = await fs.readdir(root);
    } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }

    const found: Array<{ hash: string; filePath: string }> = [];
    for (const prefix of prefixes) {
        const prefixDir = path.join(root, prefix);
        let entries: string[];
        try {
            const stat = await fs.stat(prefixDir);
            if (!stat.isDirectory()) {
                continue;
            }
            entries = await fs.readdir(prefixDir);
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.startsWith('.')) {
                continue;
            }
            let hash = entry;
            if (hash.endsWith('.enc')) {
                hash = hash.slice(0, -'.enc'.length);
            }
            if (hash.endsWith('.gz')) {
                hash = hash.slice(0, -'.gz'.length);
            }
            if (!/^[0-9a-f]{64}$/i.test(hash)) {
                continue;
            }
            found.push({ hash, filePath: path.join(prefixDir, entry) });
        }
    }
    return found;
}

export async function gcUnreferencedBlobs(
    storageRoot: string,
    referenced: Iterable<string>,
): Promise<{ deleted: number; bytesReclaimed: number }> {
    const keep = new Set(referenced);
    const objects = await listBlobObjectFiles(storageRoot);
    let deleted = 0;
    let bytesReclaimed = 0;
    const touchedDirs = new Set<string>();

    for (const object of objects) {
        if (keep.has(object.hash)) {
            continue;
        }
        try {
            const stats = await fs.stat(object.filePath);
            await fs.unlink(object.filePath);
            deleted++;
            bytesReclaimed += stats.size;
            touchedDirs.add(path.dirname(object.filePath));
        } catch {
            // already gone
        }
    }

    for (const dir of touchedDirs) {
        try {
            const leftover = await fs.readdir(dir);
            if (leftover.length === 0) {
                await fs.rmdir(dir);
            }
        } catch {
            // ignore
        }
    }

    return { deleted, bytesReclaimed };
}

export async function summarizeObjectStore(storageRoot: string): Promise<{
    blobCount: number;
    checkpointDataBytes: number;
}> {
    const objects = await listBlobObjectFiles(storageRoot);
    const hashes = new Set<string>();
    let checkpointDataBytes = 0;
    for (const object of objects) {
        hashes.add(object.hash);
        try {
            const stats = await fs.stat(object.filePath);
            checkpointDataBytes += stats.size;
        } catch {
            // ignore
        }
    }
    return {
        blobCount: hashes.size,
        checkpointDataBytes,
    };
}

export async function summarizeUnreferencedBlobs(
    storageRoot: string,
    referenced: Iterable<string>,
): Promise<{ count: number; bytes: number; hashes: string[] }> {
    const keep = new Set(referenced);
    const objects = await listBlobObjectFiles(storageRoot);
    const hashes = new Set<string>();
    let bytes = 0;
    for (const object of objects) {
        if (keep.has(object.hash)) {
            continue;
        }
        hashes.add(object.hash);
        try {
            const stats = await fs.stat(object.filePath);
            bytes += stats.size;
        } catch {
            // ignore
        }
    }
    return {
        count: hashes.size,
        bytes,
        hashes: [...hashes],
    };
}

export async function computeObjectStoreBytes(storageRoot: string): Promise<number> {
    const summary = await summarizeObjectStore(storageRoot);
    return summary.checkpointDataBytes;
}
