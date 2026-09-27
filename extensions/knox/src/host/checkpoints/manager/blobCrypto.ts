import { createKnoxLogger } from 'core/util/knoxLog';

import {
    BlobEncryptionError,
    getCheckpointEncryptionKey,
    getOrCreateCheckpointEncryptionKey,
    type CheckpointEncryptionKeyProvider,
    type SecretStore,
} from '../store/blobEncryption';
import { storeHasEncryptedBlobs, type GetBlobOptions, type PutBlobOptions } from '../store/blobStore';
import type { CheckpointEngineHost } from './host';

export type { CheckpointEncryptionKeyProvider } from '../store/blobEncryption';

const log = createKnoxLogger('Checkpoints');

function secretStoreFromHost(host: CheckpointEngineHost): SecretStore | undefined {
    return host.extensionContext?.secrets;
}

export async function resolveEncryptionKey(
    host: CheckpointEngineHost,
    createIfMissing: boolean,
): Promise<Buffer | undefined> {
    if (host.encryptionKeyProvider) {
        return createIfMissing
            ? host.encryptionKeyProvider.getOrCreate()
            : host.encryptionKeyProvider.get();
    }
    const secrets = secretStoreFromHost(host);
    if (!secrets) {
        if (createIfMissing && host.encryptAtRest) {
            throw new BlobEncryptionError(
                'Checkpoint encryption key is unavailable. Secret Storage is not initialized.',
                'missing_key',
            );
        }
        return undefined;
    }
    return createIfMissing
        ? getOrCreateCheckpointEncryptionKey(secrets)
        : getCheckpointEncryptionKey(secrets);
}

export async function writeBlobOptions(host: CheckpointEngineHost): Promise<PutBlobOptions> {
    const options: PutBlobOptions = { compress: host.enableCompression };
    if (!host.encryptAtRest) {
        return options;
    }
    const key = await resolveEncryptionKey(host, true);
    if (!key) {
        throw new BlobEncryptionError(
            'Checkpoint encryption key is unavailable.',
            'missing_key',
        );
    }
    options.encrypt = true;
    options.encryptionKey = key;
    return options;
}

export async function readBlobOptions(host: CheckpointEngineHost): Promise<GetBlobOptions> {
    let key: Buffer | undefined;
    try {
        key = await resolveEncryptionKey(host, false);
    } catch (error) {
        if (error instanceof BlobEncryptionError) {
            throw error;
        }
        throw new BlobEncryptionError(
            error instanceof Error
                ? error.message
                : 'Checkpoint encryption key is unavailable.',
            'missing_key',
        );
    }
    if (key) {
        return { encryptionKey: key };
    }

    let hasEncrypted = false;
    try {
        hasEncrypted = await storeHasEncryptedBlobs(host.getStoragePath());
    } catch (error) {
        log.debug('Could not scan checkpoint objects for encrypted blobs:', error);
    }

    if (host.encryptAtRest || hasEncrypted) {
        throw new BlobEncryptionError(
            'Checkpoint encryption key is unavailable.',
            'missing_key',
        );
    }
    return {};
}

export async function ensureEncryptionKeyIfEnabled(host: CheckpointEngineHost): Promise<void> {
    if (!host.encryptAtRest) {
        return;
    }
    await resolveEncryptionKey(host, true);
}
