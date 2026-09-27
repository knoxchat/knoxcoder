import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import { BLOB_COMPRESS_THRESHOLD, hashBlobBytes, isBlobObjectHash } from './blobStore';
import {
    CHECKPOINT_SCHEMA_VERSION,
    verifyStoredCheckpointChecksum,
} from './checkpointIntegrity';

export const CHECKPOINT_BUNDLE_FORMAT = 'knox.checkpoint.bundle';
export const CHECKPOINT_BUNDLE_SCHEMA_VERSION = 1;

export type CheckpointBundleErrorCode =
    | 'TRUNCATED'
    | 'INVALID_FORMAT'
    | 'SCHEMA_UNSUPPORTED'
    | 'CHECKSUM_MISMATCH'
    | 'BLOB_CHECKSUM_MISMATCH'
    | 'MISSING_BLOB'
    | 'PATH_ESCAPE'
    | 'TOO_LARGE'
    | 'WORKSPACE_MISMATCH'
    | 'INCOMPLETE'
    | 'HMAC_MISMATCH';

export class CheckpointBundleError extends Error {
    constructor(
        message: string,
        readonly code: CheckpointBundleErrorCode,
    ) {
        super(message);
        this.name = 'CheckpointBundleError';
    }
}

export class CheckpointWorkspaceMismatchError extends CheckpointBundleError {
    constructor(
        readonly workspaceHint: string | undefined,
        readonly workspaceKey: string | undefined,
    ) {
        super(
            `Bundle was exported from a different workspace (${workspaceHint ?? workspaceKey ?? 'unknown'})`,
            'WORKSPACE_MISMATCH',
        );
        this.name = 'CheckpointWorkspaceMismatchError';
    }
}

export function isWorkspaceMismatchError(error: unknown): error is CheckpointWorkspaceMismatchError {
    return (
        error instanceof CheckpointWorkspaceMismatchError ||
        (error instanceof Error && error.name === 'CheckpointWorkspaceMismatchError')
    );
}

export interface CheckpointBundleBlob {
    hash: string;
    size: number;
    gzipped: boolean;
    data: string;
}

export interface CheckpointBundleV1 {
    format: typeof CHECKPOINT_BUNDLE_FORMAT;
    schemaVersion: typeof CHECKPOINT_BUNDLE_SCHEMA_VERSION;
    exportedAt: string;
    workspaceHint?: string;
    workspaceKey?: string;
    checkpointIds: string[];
    messageCheckpoints: Record<string, string>;
    stableIdCheckpoints: Record<string, string>;
    checkpoints: Array<Record<string, unknown>>;
    blobs: CheckpointBundleBlob[];
    contentSha256: string;
    /** HMAC-SHA256 of contentSha256 using the local ~/.knox key. Optional. */
    hmacSha256?: string;
    /** First 16 hex chars of sha256(key); import verifies HMAC only when this matches. */
    hmacKeyId?: string;
}

function sortRecord(record: Record<string, string> | undefined): Record<string, string> {
    const sorted: Record<string, string> = {};
    for (const key of Object.keys(record ?? {}).sort()) {
        sorted[key] = (record ?? {})[key];
    }
    return sorted;
}

/**
 * Stable payload for the bundle digest. Pretty-printed on-disk JSON and
 * insertion order cannot change the hash.
 */
export function buildCanonicalBundlePayload(
    bundle: Omit<CheckpointBundleV1, 'contentSha256'> & { contentSha256?: string },
): Record<string, unknown> {
    return {
        format: CHECKPOINT_BUNDLE_FORMAT,
        schemaVersion: CHECKPOINT_BUNDLE_SCHEMA_VERSION,
        exportedAt: bundle.exportedAt ?? '',
        workspaceHint: bundle.workspaceHint ?? '',
        workspaceKey: bundle.workspaceKey ?? '',
        checkpointIds: [...(bundle.checkpointIds ?? [])].sort(),
        messageCheckpoints: sortRecord(bundle.messageCheckpoints),
        stableIdCheckpoints: sortRecord(bundle.stableIdCheckpoints),
        checkpoints: [...(bundle.checkpoints ?? [])]
            .map((checkpoint) => ({
                id: typeof checkpoint.id === 'string' ? checkpoint.id : '',
                schemaVersion: typeof checkpoint.schemaVersion === 'number' ? checkpoint.schemaVersion : 0,
                contentSha256: typeof checkpoint.contentSha256 === 'string' ? checkpoint.contentSha256 : '',
            }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        blobs: [...(bundle.blobs ?? [])]
            .map((blob) => ({
                hash: blob.hash,
                size: blob.size,
                gzipped: blob.gzipped === true,
                data: blob.data,
            }))
            .sort((a, b) => a.hash.localeCompare(b.hash)),
    };
}

export function computeBundleContentSha256(
    bundle: Omit<CheckpointBundleV1, 'contentSha256'> & { contentSha256?: string },
): string {
    return createHash('sha256')
        .update(JSON.stringify(buildCanonicalBundlePayload(bundle)), 'utf8')
        .digest('hex');
}

export function encodeBundleBlob(bytes: Buffer): CheckpointBundleBlob {
    const hash = hashBlobBytes(bytes);
    const gzipped = bytes.length >= BLOB_COMPRESS_THRESHOLD;
    const payload = gzipped ? gzipSync(bytes) : bytes;
    return {
        hash,
        size: bytes.length,
        gzipped,
        data: payload.toString('base64'),
    };
}

export function decodeBundleBlob(blob: CheckpointBundleBlob): Buffer {
    if (!isBlobObjectHash(blob.hash)) {
        throw new CheckpointBundleError(`Invalid blob hash ${blob.hash}`, 'BLOB_CHECKSUM_MISMATCH');
    }
    let packed: Buffer;
    try {
        packed = Buffer.from(blob.data, 'base64');
    } catch (error) {
        throw new CheckpointBundleError(
            `Blob ${blob.hash} is not valid base64: ${error instanceof Error ? error.message : String(error)}`,
            'BLOB_CHECKSUM_MISMATCH',
        );
    }
    let bytes: Buffer;
    try {
        bytes = blob.gzipped ? gunzipSync(packed) : packed;
    } catch (error) {
        throw new CheckpointBundleError(
            `Blob ${blob.hash} could not be decompressed: ${error instanceof Error ? error.message : String(error)}`,
            'BLOB_CHECKSUM_MISMATCH',
        );
    }
    if (typeof blob.size === 'number' && blob.size >= 0 && bytes.length !== blob.size) {
        throw new CheckpointBundleError(
            `Blob ${blob.hash} size mismatch (expected ${blob.size}, got ${bytes.length})`,
            'BLOB_CHECKSUM_MISMATCH',
        );
    }
    const actual = hashBlobBytes(bytes);
    if (actual !== blob.hash) {
        throw new CheckpointBundleError(
            `Blob ${blob.hash} failed checksum (got ${actual})`,
            'BLOB_CHECKSUM_MISMATCH',
        );
    }
    return bytes;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringRecord(value: unknown): Record<string, string> {
    if (!isPlainObject(value)) {
        return {};
    }
    const record: Record<string, string> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === 'string') {
            record[key] = entry;
        }
    }
    return record;
}

function referencedHashesFromCheckpoint(checkpoint: Record<string, unknown>): string[] {
    const snapshots = checkpoint.fileSnapshots;
    if (!Array.isArray(snapshots)) {
        return [];
    }
    const hashes: string[] = [];
    for (const snapshot of snapshots) {
        if (!isPlainObject(snapshot)) {
            continue;
        }
        if (snapshot.deleted === true || snapshot.changeType === 'deleted') {
            continue;
        }
        if (typeof snapshot.hash === 'string' && isBlobObjectHash(snapshot.hash)) {
            hashes.push(snapshot.hash);
        }
    }
    return hashes;
}

function verifyCheckpointRecord(checkpoint: Record<string, unknown>): void {
    const id = typeof checkpoint.id === 'string' ? checkpoint.id : '';
    if (!id) {
        throw new CheckpointBundleError('Bundle checkpoint is missing an id', 'INVALID_FORMAT');
    }
    const schemaVersion = typeof checkpoint.schemaVersion === 'number'
        ? checkpoint.schemaVersion
        : CHECKPOINT_SCHEMA_VERSION;
    if (schemaVersion > CHECKPOINT_SCHEMA_VERSION) {
        throw new CheckpointBundleError(
            `Unsupported checkpoint schemaVersion ${schemaVersion} in ${id}`,
            'SCHEMA_UNSUPPORTED',
        );
    }
    const checksum = verifyStoredCheckpointChecksum({
        id,
        schemaVersion,
        contentSha256: typeof checkpoint.contentSha256 === 'string' ? checkpoint.contentSha256 : undefined,
        fileInventory: Array.isArray(checkpoint.fileInventory)
            ? checkpoint.fileInventory.filter((entry): entry is string => typeof entry === 'string')
            : undefined,
        skippedFiles: Array.isArray(checkpoint.skippedFiles)
            ? checkpoint.skippedFiles.filter((entry): entry is { path: string; reason: string } =>
                isPlainObject(entry) && typeof entry.path === 'string' && typeof entry.reason === 'string')
            : undefined,
        fileSnapshots: Array.isArray(checkpoint.fileSnapshots)
            ? checkpoint.fileSnapshots.filter(isPlainObject).map((snapshot) => ({
                relativePath: typeof snapshot.relativePath === 'string' ? snapshot.relativePath : '',
                content: typeof snapshot.content === 'string' ? snapshot.content : undefined,
                hash: typeof snapshot.hash === 'string' ? snapshot.hash : undefined,
                encoding: typeof snapshot.encoding === 'string' ? snapshot.encoding : 'utf8',
                size: typeof snapshot.size === 'number' ? snapshot.size : 0,
                deleted: snapshot.deleted === true,
                changeType: typeof snapshot.changeType === 'string' ? snapshot.changeType : undefined,
            }))
            : undefined,
    });
    if (!checksum.ok) {
        throw new CheckpointBundleError(
            `Checkpoint ${id} failed integrity check: ${checksum.reason}`,
            'CHECKSUM_MISMATCH',
        );
    }
}

export function parseCheckpointBundleJson(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch (error) {
        throw new CheckpointBundleError(
            `Truncated or invalid checkpoint bundle: ${error instanceof Error ? error.message : String(error)}`,
            'TRUNCATED',
        );
    }
}

export function isCheckpointBundle(value: unknown): value is CheckpointBundleV1 {
    return isPlainObject(value)
        && value.format === CHECKPOINT_BUNDLE_FORMAT
        && value.schemaVersion === CHECKPOINT_BUNDLE_SCHEMA_VERSION;
}

export function verifyCheckpointBundle(value: unknown): CheckpointBundleV1 {
    if (!isPlainObject(value)) {
        throw new CheckpointBundleError('Invalid checkpoint bundle format', 'INVALID_FORMAT');
    }
    if (value.format !== CHECKPOINT_BUNDLE_FORMAT) {
        throw new CheckpointBundleError('Invalid checkpoint bundle format', 'INVALID_FORMAT');
    }
    if (typeof value.schemaVersion !== 'number') {
        throw new CheckpointBundleError('Bundle is missing schemaVersion', 'INVALID_FORMAT');
    }
    if (value.schemaVersion !== CHECKPOINT_BUNDLE_SCHEMA_VERSION) {
        throw new CheckpointBundleError(
            `Unsupported bundle schemaVersion ${value.schemaVersion}`,
            'SCHEMA_UNSUPPORTED',
        );
    }
    if (!Array.isArray(value.checkpoints) || !Array.isArray(value.blobs) || !Array.isArray(value.checkpointIds)) {
        throw new CheckpointBundleError('Bundle is missing checkpoints, blobs, or checkpointIds', 'INVALID_FORMAT');
    }
    if (typeof value.contentSha256 !== 'string' || value.contentSha256.length === 0) {
        throw new CheckpointBundleError('Bundle is missing contentSha256', 'CHECKSUM_MISMATCH');
    }

    const bundle: CheckpointBundleV1 = {
        format: CHECKPOINT_BUNDLE_FORMAT,
        schemaVersion: CHECKPOINT_BUNDLE_SCHEMA_VERSION,
        exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : '',
        workspaceHint: typeof value.workspaceHint === 'string' ? value.workspaceHint : undefined,
        workspaceKey: typeof value.workspaceKey === 'string' ? value.workspaceKey : undefined,
        checkpointIds: value.checkpointIds.filter((id): id is string => typeof id === 'string'),
        messageCheckpoints: asStringRecord(value.messageCheckpoints),
        stableIdCheckpoints: asStringRecord(value.stableIdCheckpoints),
        checkpoints: value.checkpoints.filter(isPlainObject),
        blobs: value.blobs.filter(isPlainObject).map((blob) => ({
            hash: typeof blob.hash === 'string' ? blob.hash : '',
            size: typeof blob.size === 'number' ? blob.size : -1,
            gzipped: blob.gzipped === true,
            data: typeof blob.data === 'string' ? blob.data : '',
        })),
        contentSha256: value.contentSha256,
        hmacSha256: typeof value.hmacSha256 === 'string' && value.hmacSha256.length > 0
            ? value.hmacSha256
            : undefined,
        hmacKeyId: typeof value.hmacKeyId === 'string' && value.hmacKeyId.length > 0
            ? value.hmacKeyId
            : undefined,
    };

    const expected = computeBundleContentSha256(bundle);
    if (expected !== bundle.contentSha256) {
        throw new CheckpointBundleError('Bundle contentSha256 mismatch', 'CHECKSUM_MISMATCH');
    }

    if (bundle.checkpoints.length !== bundle.checkpointIds.length) {
        throw new CheckpointBundleError(
            'Bundle checkpoint list does not match checkpointIds',
            'INVALID_FORMAT',
        );
    }

    const checkpointIds = new Set(bundle.checkpointIds);
    for (const checkpoint of bundle.checkpoints) {
        const id = typeof checkpoint.id === 'string' ? checkpoint.id : '';
        if (!checkpointIds.has(id)) {
            throw new CheckpointBundleError(
                `Bundle checkpoint ${id} is not listed in checkpointIds`,
                'INVALID_FORMAT',
            );
        }
        verifyCheckpointRecord(checkpoint);
    }

    const blobByHash = new Map<string, CheckpointBundleBlob>();
    for (const blob of bundle.blobs) {
        decodeBundleBlob(blob);
        blobByHash.set(blob.hash, blob);
    }

    for (const checkpoint of bundle.checkpoints) {
        for (const hash of referencedHashesFromCheckpoint(checkpoint)) {
            if (!blobByHash.has(hash)) {
                throw new CheckpointBundleError(
                    `Bundle is missing blob ${hash} referenced by ${String(checkpoint.id)}`,
                    'MISSING_BLOB',
                );
            }
        }
    }

    return bundle;
}

export function sealCheckpointBundle(
    bundle: Omit<CheckpointBundleV1, 'format' | 'schemaVersion' | 'contentSha256'>,
): CheckpointBundleV1 {
    const unsigned: Omit<CheckpointBundleV1, 'contentSha256'> = {
        format: CHECKPOINT_BUNDLE_FORMAT,
        schemaVersion: CHECKPOINT_BUNDLE_SCHEMA_VERSION,
        ...bundle,
    };
    return {
        ...unsigned,
        contentSha256: computeBundleContentSha256(unsigned),
    };
}

export function totalBundleBlobBytes(blobs: CheckpointBundleBlob[]): number {
    return blobs.reduce((sum, blob) => sum + Math.max(0, blob.size), 0);
}
