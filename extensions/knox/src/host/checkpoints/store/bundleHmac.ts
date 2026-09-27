import { createHash, createHmac, randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { getKnoxGlobalPath } from 'core/util/paths';

import { writeBufferAtomic, writeFileAtomic } from './atomicWrite';
import { CheckpointBundleError, type CheckpointBundleV1 } from './checkpointBundle';

export const HMAC_KEY_FILENAME = 'hmac.key';
export const HMAC_KEY_ID_LENGTH = 16;

export function defaultBundleHmacKeyPath(): string {
    return path.join(getKnoxGlobalPath(), 'checkpoints', HMAC_KEY_FILENAME);
}

export function hmacKeyIdFromKey(key: Buffer): string {
    return createHash('sha256').update(key).digest('hex').slice(0, HMAC_KEY_ID_LENGTH);
}

export function signBundleContentSha256(contentSha256: string, key: Buffer): string {
    return createHmac('sha256', key).update(contentSha256, 'utf8').digest('hex');
}

export async function readHmacKey(keyPath: string): Promise<Buffer | null> {
    try {
        const existing = await fs.readFile(keyPath);
        return existing.length >= 32 ? existing : null;
    } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

export async function loadOrCreateHmacKey(keyPath: string): Promise<Buffer> {
    const existing = await readHmacKey(keyPath);
    if (existing) {
        return existing;
    }
    const key = randomBytes(32);
    await writeBufferAtomic(keyPath, key);
    try {
        await fs.chmod(keyPath, 0o600);
    } catch {
        // Windows and some remote FS ignore chmod; the key is still local-only.
    }
    return key;
}

export async function attachBundleHmac(
    filePath: string,
    keyPath: string = defaultBundleHmacKeyPath(),
): Promise<{ hmacSha256: string; hmacKeyId: string }> {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as CheckpointBundleV1 & Record<string, unknown>;
    if (typeof parsed.contentSha256 !== 'string' || parsed.contentSha256.length === 0) {
        throw new CheckpointBundleError('Bundle is missing contentSha256', 'CHECKSUM_MISMATCH');
    }
    const key = await loadOrCreateHmacKey(keyPath);
    const hmacSha256 = signBundleContentSha256(parsed.contentSha256, key);
    const hmacKeyId = hmacKeyIdFromKey(key);
    parsed.hmacSha256 = hmacSha256;
    parsed.hmacKeyId = hmacKeyId;
    await writeFileAtomic(filePath, JSON.stringify(parsed, null, 2), 'utf8');
    return { hmacSha256, hmacKeyId };
}

/**
 * Verify HMAC only when the bundle was signed with this machine's key.
 * A different key id (USB/email import) skips HMAC and relies on contentSha256.
 */
export function verifyOptionalBundleHmac(
    bundle: Pick<CheckpointBundleV1, 'contentSha256' | 'hmacSha256' | 'hmacKeyId'>,
    key: Buffer | null,
): void {
    if (!bundle.hmacSha256) {
        return;
    }
    if (!key) {
        return;
    }
    if (bundle.hmacKeyId && bundle.hmacKeyId !== hmacKeyIdFromKey(key)) {
        return;
    }
    const expected = signBundleContentSha256(bundle.contentSha256, key);
    if (expected !== bundle.hmacSha256) {
        throw new CheckpointBundleError('Bundle HMAC mismatch', 'HMAC_MISMATCH');
    }
}
