import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** VS Code SecretStorage / OS keychain key. Never stored in the workspace. */
export const CHECKPOINT_ENCRYPTION_SECRET_ID = 'knox.checkpoints.encryptAtRest';

const MAGIC = Buffer.from('KNXE');
const VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const FLAG_GZIP = 0x01;
const HEADER_LENGTH = MAGIC.length + 2; // magic + version + flags

export type BlobEncryptionErrorCode = 'missing_key' | 'decrypt_failed';

export class BlobEncryptionError extends Error {
    constructor(
        message: string,
        readonly code: BlobEncryptionErrorCode,
    ) {
        super(message);
        this.name = 'BlobEncryptionError';
    }
}

export interface SecretStore {
    get(key: string): Thenable<string | undefined> | Promise<string | undefined>;
    store(key: string, value: string): Thenable<void> | Promise<void>;
}

export interface CheckpointEncryptionKeyProvider {
    get(): Promise<Buffer | undefined>;
    getOrCreate(): Promise<Buffer>;
}

export function memoryEncryptionKeyProvider(initial?: Buffer): CheckpointEncryptionKeyProvider {
    let stored = initial;
    return {
        async get() {
            return stored;
        },
        async getOrCreate() {
            if (!stored) {
                stored = randomBytes(KEY_LENGTH);
            }
            return stored;
        },
    };
}

export function isEncryptedBlobBytes(bytes: Buffer): boolean {
    return bytes.length >= MAGIC.length && bytes.subarray(0, MAGIC.length).equals(MAGIC);
}

function requireKey(key: Buffer | undefined): Buffer {
    if (!key || key.length !== KEY_LENGTH) {
        throw new BlobEncryptionError(
            'Checkpoint encryption key is unavailable. Restore cannot decrypt blobs.',
            'missing_key',
        );
    }
    return key;
}

/**
 * Encrypt payload bytes (already gzipped when `gzipped` is true).
 * Layout: KNXE | version | flags | iv(12) | tag(16) | ciphertext
 */
export function encryptBlobPayload(payload: Buffer, key: Buffer, gzipped: boolean): Buffer {
    const secret = requireKey(key);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', secret, iv);
    const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
    const tag = cipher.getAuthTag();
    const header = Buffer.alloc(HEADER_LENGTH);
    MAGIC.copy(header, 0);
    header[4] = VERSION;
    header[5] = gzipped ? FLAG_GZIP : 0;
    return Buffer.concat([header, iv, tag, ciphertext]);
}

export function decryptBlobPayload(
    encrypted: Buffer,
    key: Buffer | undefined,
): { payload: Buffer; gzipped: boolean } {
    if (!isEncryptedBlobBytes(encrypted) || encrypted.length < HEADER_LENGTH + IV_LENGTH + TAG_LENGTH) {
        throw new BlobEncryptionError(
            'Failed to decrypt checkpoint blob. The encryption key is missing or incorrect.',
            'decrypt_failed',
        );
    }
    const secret = requireKey(key);
    const version = encrypted[4];
    if (version !== VERSION) {
        throw new BlobEncryptionError(
            `Failed to decrypt checkpoint blob: unsupported encryption version ${version}.`,
            'decrypt_failed',
        );
    }
    const gzipped = (encrypted[5] & FLAG_GZIP) !== 0;
    const ivStart = HEADER_LENGTH;
    const tagStart = ivStart + IV_LENGTH;
    const cipherStart = tagStart + TAG_LENGTH;
    const iv = encrypted.subarray(ivStart, tagStart);
    const tag = encrypted.subarray(tagStart, cipherStart);
    const ciphertext = encrypted.subarray(cipherStart);
    try {
        const decipher = createDecipheriv('aes-256-gcm', secret, iv);
        decipher.setAuthTag(tag);
        const payload = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return { payload, gzipped };
    } catch {
        throw new BlobEncryptionError(
            'Failed to decrypt checkpoint blob. The encryption key is missing or incorrect.',
            'decrypt_failed',
        );
    }
}

export async function getCheckpointEncryptionKey(secrets: SecretStore): Promise<Buffer | undefined> {
    const hex = await secrets.get(CHECKPOINT_ENCRYPTION_SECRET_ID);
    if (!hex) {
        return undefined;
    }
    try {
        const key = Buffer.from(hex, 'hex');
        return key.length === KEY_LENGTH ? key : undefined;
    } catch {
        return undefined;
    }
}

export async function getOrCreateCheckpointEncryptionKey(secrets: SecretStore): Promise<Buffer> {
    const existing = await getCheckpointEncryptionKey(secrets);
    if (existing) {
        return existing;
    }
    const key = randomBytes(KEY_LENGTH);
    await secrets.store(CHECKPOINT_ENCRYPTION_SECRET_ID, key.toString('hex'));
    return key;
}
