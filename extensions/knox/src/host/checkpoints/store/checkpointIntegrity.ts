import { createHash } from 'node:crypto';

/** Manifest schema: 1 = inlined content; 2 = path → blob hash (CP-07). */
export const CHECKPOINT_SCHEMA_VERSION = 2;
export const CHECKPOINT_SCHEMA_VERSION_V1 = 1;

export type CheckpointLoadStatus = 'ok' | 'not_found' | 'corrupt';

export type CheckpointLoadResult<T> =
    | { status: 'ok'; checkpoint: T }
    | { status: 'not_found' }
    | { status: 'corrupt'; reason: string };

export interface CanonicalSnapshot {
    relativePath: string;
    content: string;
    hash: string;
    encoding: string;
    size: number;
    deleted: boolean;
    changeType: string | null;
}

export interface CanonicalIntegrityInput {
    id: string;
    schemaVersion?: number;
    fileInventory?: string[];
    skippedFiles?: Array<{ path: string; reason: string }>;
    fileSnapshots?: Array<{
        relativePath: string;
        content?: string;
        hash?: string;
        encoding: string;
        size: number;
        deleted?: boolean;
        changeType?: string;
    }>;
}

function snapshotSchemaVersion(input: CanonicalIntegrityInput): number {
    return input.schemaVersion ?? CHECKPOINT_SCHEMA_VERSION_V1;
}

/**
 * Stable object used for checksums. Key order is defined here so pretty-printed
 * on-disk JSON (and insertion-order churn) cannot change the digest.
 *
 * Schema 1 hashes inlined `content`. Schema 2 hashes blob `hash` instead so
 * checkpoint JSON no longer needs file bytes in the checksum payload.
 */
export function buildCanonicalIntegrityPayload(input: CanonicalIntegrityInput): {
    schemaVersion: number;
    id: string;
    fileInventory: string[];
    skippedFiles: Array<{ path: string; reason: string }>;
    fileSnapshots: CanonicalSnapshot[];
} {
    const schemaVersion = snapshotSchemaVersion(input);
    const useBlobHash = schemaVersion >= CHECKPOINT_SCHEMA_VERSION;
    return {
        schemaVersion,
        id: input.id,
        fileInventory: [...(input.fileInventory ?? [])].sort(),
        skippedFiles: [...(input.skippedFiles ?? [])]
            .map((skipped) => ({ path: skipped.path, reason: skipped.reason }))
            .sort((a, b) => a.path.localeCompare(b.path)),
        fileSnapshots: [...(input.fileSnapshots ?? [])]
            .map((snapshot) => ({
                relativePath: snapshot.relativePath,
                content: useBlobHash ? '' : (snapshot.content ?? ''),
                hash: useBlobHash ? (snapshot.hash ?? '') : '',
                encoding: snapshot.encoding,
                size: snapshot.size,
                deleted: snapshot.deleted === true,
                changeType: snapshot.changeType ?? null,
            }))
            .sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    };
}

export function computeCheckpointContentSha256(input: CanonicalIntegrityInput): string {
    const canonical = JSON.stringify(buildCanonicalIntegrityPayload(input));
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function verifyStoredCheckpointChecksum(
    data: CanonicalIntegrityInput & { contentSha256?: string },
): { ok: true } | { ok: false; reason: string } {
    if (typeof data.contentSha256 !== 'string' || data.contentSha256.length === 0) {
        // Legacy manifests written before CP-05 have no digest.
        return { ok: true };
    }
    if (!data.id) {
        return { ok: false, reason: 'missing id' };
    }
    const expected = computeCheckpointContentSha256(data);
    if (expected !== data.contentSha256) {
        return { ok: false, reason: 'contentSha256 mismatch' };
    }
    return { ok: true };
}
