import * as fs from 'fs';
import * as path from 'path';

import { createKnoxLogger } from 'core/util/knoxLog';

import { t } from '../../i18n';
import { generateCheckpointId } from '../checkpointId';
import {
    defaultBundleHmacKeyPath,
    readHmacKey,
    verifyOptionalBundleHmac,
} from '../store/bundleHmac';
import { writeFileAtomic } from '../store/atomicWrite';
import {
    blobExists,
    getBlob,
    putBlob,
    referencedBlobHashes,
} from '../store/blobStore';
import {
    CHECKPOINT_BUNDLE_FORMAT,
    CheckpointBundleError,
    CheckpointWorkspaceMismatchError,
    decodeBundleBlob,
    encodeBundleBlob,
    parseCheckpointBundleJson,
    sealCheckpointBundle,
    totalBundleBlobBytes,
    verifyCheckpointBundle,
    type CheckpointBundleV1,
} from '../store/checkpointBundle';
import { applySnapshotHashes } from './capture';
import { readBlobOptions, writeBlobOptions } from './blobCrypto';
import type { CheckpointEngineHost } from './host';
import {
    computeDiskStorageBytes,
    gcUnreferencedCheckpointBlobs,
    getStoragePath,
    initializeStorageDirectories,
    readCheckpointRecord,
    saveCheckpointToDisk,
    toIndexRecord,
} from './persistence';
import type {
    CheckpointInfo,
    ExportCheckpointsOptions,
    FileSnapshot,
    ImportCheckpointsOptions,
    MessageCheckpointMap,
    SkippedFile,
} from './types';
import { checkpointHasUnsafePaths, workspacePathsEqual, workspaceStorageKey } from './workspace';

const log = createKnoxLogger('Checkpoints');

const MIN_BUNDLE_FILE_BYTES = 10 * 1024 * 1024;

export type { ExportCheckpointsOptions, ImportCheckpointsOptions };

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function remapMappedIds(
    map: Record<string, string> | undefined,
    idMap: Map<string, string>,
): MessageCheckpointMap {
    const remapped: MessageCheckpointMap = {};
    for (const [key, value] of Object.entries(map ?? {})) {
        remapped[key] = idMap.get(value) ?? value;
    }
    return remapped;
}

function snapshotFromRecord(snapshot: Record<string, unknown>): FileSnapshot {
    const lastModifiedRaw = snapshot.lastModified;
    return {
        relativePath: typeof snapshot.relativePath === 'string' ? snapshot.relativePath : '',
        hash: typeof snapshot.hash === 'string' ? snapshot.hash : undefined,
        content: typeof snapshot.content === 'string' ? snapshot.content : undefined,
        encoding: typeof snapshot.encoding === 'string' ? snapshot.encoding : 'utf8',
        lastModified: lastModifiedRaw instanceof Date
            ? lastModifiedRaw
            : new Date(typeof lastModifiedRaw === 'string' ? lastModifiedRaw : Date.now()),
        size: typeof snapshot.size === 'number' ? snapshot.size : 0,
        deleted: snapshot.deleted === true,
        changeType: snapshot.changeType === 'created'
            || snapshot.changeType === 'modified'
            || snapshot.changeType === 'deleted'
            ? snapshot.changeType
            : undefined,
    };
}

function skippedFilesFromRecord(value: unknown): SkippedFile[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const skipped: SkippedFile[] = [];
    for (const entry of value) {
        if (!isPlainObject(entry) || typeof entry.path !== 'string' || typeof entry.reason !== 'string') {
            continue;
        }
        skipped.push({
            path: entry.path,
            reason: entry.reason as SkippedFile['reason'],
        });
    }
    return skipped.length > 0 ? skipped : undefined;
}

function checkpointFromRecord(
    record: Record<string, unknown>,
    host: CheckpointEngineHost,
): CheckpointInfo {
    const createdRaw = record.created;
    const fileSnapshots = Array.isArray(record.fileSnapshots)
        ? record.fileSnapshots.filter(isPlainObject).map(snapshotFromRecord)
        : [];
    const fileInventory = Array.isArray(record.fileInventory)
        ? record.fileInventory.filter((entry): entry is string => typeof entry === 'string')
        : undefined;
    const conversation = isPlainObject(record.conversationContext)
        ? record.conversationContext as CheckpointInfo['conversationContext']
        : undefined;
    const tags = Array.isArray(record.tags)
        ? record.tags.filter((tag): tag is string => typeof tag === 'string')
        : undefined;

    return {
        id: typeof record.id === 'string' ? record.id : generateCheckpointId(),
        description: typeof record.description === 'string' ? record.description : 'Imported checkpoint',
        created: createdRaw instanceof Date
            ? createdRaw
            : new Date(typeof createdRaw === 'string' || typeof createdRaw === 'number' ? createdRaw : Date.now()),
        messageId: typeof record.messageId === 'string' ? record.messageId : undefined,
        stableId: typeof record.stableId === 'string' ? record.stableId : undefined,
        workspacePath: host.currentWorkspacePath,
        workspaceKey: host.currentWorkspacePath
            ? workspaceStorageKey(host.currentWorkspacePath)
            : undefined,
        fileSnapshots,
        fileInventory,
        captureMode: record.captureMode === 'baseline' || record.captureMode === 'delta'
            ? record.captureMode
            : undefined,
        skippedFiles: skippedFilesFromRecord(record.skippedFiles),
        schemaVersion: typeof record.schemaVersion === 'number' ? record.schemaVersion : undefined,
        contentSha256: typeof record.contentSha256 === 'string' ? record.contentSha256 : undefined,
        pinned: record.pinned === true,
        tags: tags && tags.length > 0 ? tags : undefined,
        sessionId: typeof record.sessionId === 'string' ? record.sessionId : undefined,
        branchId: typeof record.branchId === 'string' ? record.branchId : undefined,
        parentCheckpointId: typeof record.parentCheckpointId === 'string' ? record.parentCheckpointId : undefined,
        changedPaths: Array.isArray(record.changedPaths)
            ? record.changedPaths.filter((entry): entry is string => typeof entry === 'string')
            : undefined,
        conversationContext: conversation,
        fileStats: isPlainObject(record.fileStats)
            ? {
                total: typeof record.fileStats.total === 'number' ? record.fileStats.total : fileSnapshots.length,
                created: typeof record.fileStats.created === 'number' ? record.fileStats.created : 0,
                deleted: typeof record.fileStats.deleted === 'number' ? record.fileStats.deleted : 0,
                modified: typeof record.fileStats.modified === 'number' ? record.fileStats.modified : 0,
                inventoryCount: typeof record.fileStats.inventoryCount === 'number'
                    ? record.fileStats.inventoryCount
                    : fileInventory?.length,
            }
            : undefined,
    };
}

function assertSafeCheckpoints(
    checkpoints: CheckpointInfo[],
    workspacePath: string | undefined,
): void {
    const unsafe = checkpoints.filter((checkpoint) =>
        checkpointHasUnsafePaths(checkpoint, workspacePath),
    );
    if (unsafe.length > 0) {
        throw new CheckpointBundleError(
            `Imported checkpoint contains paths that escape the workspace (${unsafe.length} checkpoint(s))`,
            'PATH_ESCAPE',
        );
    }
}

function assertWorkspaceMatch(
    host: CheckpointEngineHost,
    hint: string | undefined,
    key: string | undefined,
    allowMismatch: boolean,
): void {
    if (allowMismatch || !host.currentWorkspacePath) {
        return;
    }
    const currentKey = workspaceStorageKey(host.currentWorkspacePath);
    if (key && key !== currentKey) {
        throw new CheckpointWorkspaceMismatchError(hint, key);
    }
    if (!key && hint && !workspacePathsEqual(hint, host.currentWorkspacePath)) {
        throw new CheckpointWorkspaceMismatchError(hint, undefined);
    }
}

async function assertImportFitsQuota(
    host: CheckpointEngineHost,
    incomingBytes: number,
    merge: boolean,
): Promise<void> {
    if (host.maxStorageBytes < 1) {
        return;
    }
    if (incomingBytes > host.maxStorageBytes) {
        throw new CheckpointBundleError(
            t('checkpoint.error.quotaExceeded', {
                used: incomingBytes,
                limit: host.maxStorageBytes,
            }),
            'TOO_LARGE',
        );
    }
    if (!merge) {
        return;
    }
    const current = await computeDiskStorageBytes(host);
    if (current + incomingBytes > host.maxStorageBytes) {
        throw new CheckpointBundleError(
            t('checkpoint.error.quotaExceeded', {
                used: current + incomingBytes,
                limit: host.maxStorageBytes,
            }),
            'TOO_LARGE',
        );
    }
}

async function collectExportIds(
    host: CheckpointEngineHost,
    requested: string[] | undefined,
): Promise<string[]> {
    if (!requested || requested.length === 0) {
        const ids = host.checkpointHistory.map((checkpoint) => checkpoint.id);
        if (ids.length === 0) {
            throw new CheckpointBundleError('No checkpoints to export', 'INCOMPLETE');
        }
        return ids;
    }
    const known = new Set(host.checkpointHistory.map((checkpoint) => checkpoint.id));
    const missing = requested.filter((id) => !known.has(id));
    if (missing.length > 0) {
        throw new CheckpointBundleError(
            `Cannot export unknown checkpoint(s): ${missing.join(', ')}`,
            'INCOMPLETE',
        );
    }
    return [...new Set(requested)];
}

function checkpointToBundleRecord(checkpoint: CheckpointInfo): Record<string, unknown> {
    return {
        id: checkpoint.id,
        description: checkpoint.description,
        created: checkpoint.created instanceof Date
            ? checkpoint.created.toISOString()
            : checkpoint.created,
        messageId: checkpoint.messageId,
        stableId: checkpoint.stableId,
        workspacePath: checkpoint.workspacePath,
        workspaceKey: checkpoint.workspaceKey,
        captureMode: checkpoint.captureMode,
        skippedFiles: checkpoint.skippedFiles,
        schemaVersion: checkpoint.schemaVersion,
        contentSha256: checkpoint.contentSha256,
        fileInventory: checkpoint.fileInventory,
        fileStats: checkpoint.fileStats,
        pinned: checkpoint.pinned,
        tags: checkpoint.tags,
        sessionId: checkpoint.sessionId,
        branchId: checkpoint.branchId,
        parentCheckpointId: checkpoint.parentCheckpointId,
        changedPaths: checkpoint.changedPaths,
        conversationContext: checkpoint.conversationContext,
        fileSnapshots: (checkpoint.fileSnapshots ?? []).map((snapshot) => ({
            relativePath: snapshot.relativePath,
            hash: snapshot.hash,
            encoding: snapshot.encoding,
            lastModified: snapshot.lastModified instanceof Date
                ? snapshot.lastModified.toISOString()
                : snapshot.lastModified,
            size: snapshot.size,
            deleted: snapshot.deleted,
            changeType: snapshot.changeType,
        })),
    };
}

function assignImportedId(
    checkpoint: CheckpointInfo,
    usedIds: Set<string>,
    remapIds: boolean,
): { previous: string; next: string } {
    const previous = checkpoint.id;
    if (!remapIds && previous && !usedIds.has(previous)) {
        usedIds.add(previous);
        return { previous, next: previous };
    }
    const next = generateCheckpointId();
    checkpoint.id = next;
    usedIds.add(next);
    return { previous, next };
}

async function persistImportedCheckpoints(
    host: CheckpointEngineHost,
    checkpoints: CheckpointInfo[],
    maps: {
        messageCheckpoints: MessageCheckpointMap;
        stableIdCheckpoints: Record<string, string>;
    },
    options: { merge: boolean; remapIds: boolean },
): Promise<number> {
    await initializeStorageDirectories(host);
    const usedIds = new Set(
        options.merge ? host.checkpointHistory.map((checkpoint) => checkpoint.id) : [],
    );
    const idMap = new Map<string, string>();
    const imported: CheckpointInfo[] = [];

    for (const checkpoint of checkpoints) {
        const { previous, next } = assignImportedId(checkpoint, usedIds, options.remapIds);
        idMap.set(previous, next);
        await saveCheckpointToDisk(host, checkpoint);
        imported.push(checkpoint);
        applySnapshotHashes(host, checkpoint.fileSnapshots ?? []);
    }

    const messageCheckpoints = remapMappedIds(maps.messageCheckpoints, idMap);
    const stableIdCheckpoints = remapMappedIds(maps.stableIdCheckpoints, idMap);

    if (options.merge) {
        const existingIds = new Set(host.checkpointHistory.map((checkpoint) => checkpoint.id));
        host.checkpointHistory.push(
            ...imported.filter((checkpoint) => !existingIds.has(checkpoint.id)).map(toIndexRecord),
        );
        Object.assign(host.messageCheckpoints, messageCheckpoints);
        Object.assign(host.stableIdCheckpoints, stableIdCheckpoints);
    } else {
        const importedIds = new Set(imported.map((checkpoint) => checkpoint.id));
        const previousIds = host.checkpointHistory.map((checkpoint) => checkpoint.id);
        host.checkpointHistory = imported.map(toIndexRecord);
        host.messageCheckpoints = messageCheckpoints;
        host.stableIdCheckpoints = stableIdCheckpoints;
        const storagePath = getStoragePath(host);
        for (const oldId of previousIds) {
            if (importedIds.has(oldId)) {
                continue;
            }
            try {
                await fs.promises.unlink(path.join(storagePath, `${oldId}.json`));
            } catch (error: unknown) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                    throw error;
                }
            }
        }
        await gcUnreferencedCheckpointBlobs(host);
    }

    await host.saveCheckpointHistory();
    const newest = imported.reduce((latest, checkpoint) =>
        checkpoint.created.getTime() > latest ? checkpoint.created.getTime() : latest,
        0,
    );
    if (newest > 0) {
        host.lastCheckpointTime = newest;
    }
    return imported.length;
}

export async function exportCheckpoints(
    host: CheckpointEngineHost,
    filePath: string,
    options?: ExportCheckpointsOptions,
): Promise<void> {
    const startedAt = Date.now();
    try {
        const ids = await collectExportIds(host, options?.checkpointIds);
        const storagePath = getStoragePath(host);
        const checkpoints: Array<Record<string, unknown>> = [];
        const blobHashes = new Set<string>();

        for (const id of ids) {
            const result = await readCheckpointRecord(host, id);
            if (result.status !== 'ok') {
                throw new CheckpointBundleError(
                    result.status === 'corrupt'
                        ? `Cannot export corrupt checkpoint ${id}: ${result.reason}`
                        : `Cannot export missing checkpoint ${id}`,
                    result.status === 'corrupt' ? 'CHECKSUM_MISMATCH' : 'INCOMPLETE',
                );
            }
            checkpoints.push(checkpointToBundleRecord(result.checkpoint));
            for (const hash of referencedBlobHashes(result.checkpoint.fileSnapshots)) {
                blobHashes.add(hash);
            }
        }

        const blobs = [];
        for (const hash of [...blobHashes].sort()) {
            const bytes = await getBlob(storagePath, hash, await readBlobOptions(host));
            blobs.push(encodeBundleBlob(bytes));
        }

        const exportedIds = new Set(ids);
        const messageCheckpoints: Record<string, string> = {};
        for (const [messageId, checkpointId] of Object.entries(host.messageCheckpoints)) {
            if (exportedIds.has(checkpointId)) {
                messageCheckpoints[messageId] = checkpointId;
            }
        }
        const stableIdCheckpoints: Record<string, string> = {};
        for (const [stableId, checkpointId] of Object.entries(host.stableIdCheckpoints)) {
            if (exportedIds.has(checkpointId)) {
                stableIdCheckpoints[stableId] = checkpointId;
            }
        }

        const bundle = sealCheckpointBundle({
            exportedAt: new Date().toISOString(),
            workspaceHint: host.currentWorkspacePath,
            workspaceKey: host.currentWorkspacePath
                ? workspaceStorageKey(host.currentWorkspacePath)
                : undefined,
            checkpointIds: ids,
            messageCheckpoints,
            stableIdCheckpoints,
            checkpoints,
            blobs,
        });

        await writeFileAtomic(filePath, JSON.stringify(bundle, null, 2), 'utf8');
        log.info(`📦 Exported ${ids.length} checkpoints to ${filePath}`);
        await host.appendAuditEvent({
            action: 'export',
            resourceId: filePath,
            outcome: 'success',
            durationMs: Date.now() - startedAt,
            counts: { checkpoints: ids.length, blobs: blobs.length },
        }).catch(() => false);
    } catch (error) {
        await host.appendAuditEvent({
            action: 'export',
            resourceId: filePath,
            outcome: 'failure',
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
        }).catch(() => false);
        throw error;
    }
}

async function importLegacyCheckpoints(
    host: CheckpointEngineHost,
    importData: Record<string, unknown>,
    options: Required<Pick<ImportCheckpointsOptions, 'merge' | 'remapIds' | 'allowWorkspaceMismatch'>>,
): Promise<CheckpointInfo[]> {
    if (!Array.isArray(importData.checkpoints)) {
        throw new CheckpointBundleError('Invalid backup file format', 'INVALID_FORMAT');
    }

    const hint = typeof importData.workspace === 'string' ? importData.workspace : undefined;
    assertWorkspaceMatch(host, hint, undefined, options.allowWorkspaceMismatch);

    const checkpoints = importData.checkpoints.filter(isPlainObject).map((record) =>
        checkpointFromRecord(record, host),
    );
    if (checkpoints.length === 0) {
        throw new CheckpointBundleError('Invalid backup file format', 'INVALID_FORMAT');
    }
    assertSafeCheckpoints(checkpoints, host.currentWorkspacePath);

    const incomplete = checkpoints.some((checkpoint) => {
        const snapshots = checkpoint.fileSnapshots ?? [];
        if (snapshots.length === 0 && (checkpoint.fileInventory?.length ?? 0) === 0) {
            return false;
        }
        return snapshots.some((snapshot) =>
            !snapshot.deleted
            && snapshot.changeType !== 'deleted'
            && snapshot.content == null
            && !snapshot.hash,
        );
    });
    if (incomplete) {
        throw new CheckpointBundleError(
            'Legacy bundle is missing file contents; re-export from a current Knox build',
            'INCOMPLETE',
        );
    }
    return checkpoints;
}

async function incomingBlobBytes(
    host: CheckpointEngineHost,
    bundle: CheckpointBundleV1,
): Promise<number> {
    const storagePath = getStoragePath(host);
    let bytes = 0;
    for (const blob of bundle.blobs) {
        if (await blobExists(storagePath, blob.hash)) {
            continue;
        }
        bytes += Math.max(0, blob.size);
    }
    return bytes;
}

async function importVerifiedBundle(
    host: CheckpointEngineHost,
    bundle: CheckpointBundleV1,
    options: Required<Pick<ImportCheckpointsOptions, 'merge' | 'remapIds' | 'allowWorkspaceMismatch'>>,
): Promise<CheckpointInfo[]> {
    assertWorkspaceMatch(
        host,
        bundle.workspaceHint,
        bundle.workspaceKey,
        options.allowWorkspaceMismatch,
    );

    const checkpoints = bundle.checkpoints.map((record) => checkpointFromRecord(record, host));
    assertSafeCheckpoints(checkpoints, host.currentWorkspacePath);

    const incomingBytes = options.merge
        ? await incomingBlobBytes(host, bundle)
        : totalBundleBlobBytes(bundle.blobs);
    await assertImportFitsQuota(host, incomingBytes, options.merge);

    await initializeStorageDirectories(host);
    const storagePath = getStoragePath(host);
    for (const blob of bundle.blobs) {
        const bytes = decodeBundleBlob(blob);
        await putBlob(storagePath, bytes, await writeBlobOptions(host));
    }

    return checkpoints;
}

export async function importCheckpoints(
    host: CheckpointEngineHost,
    filePath: string,
    mergeOrOptions: boolean | ImportCheckpointsOptions = true,
): Promise<number> {
    const options: Required<Pick<ImportCheckpointsOptions, 'merge' | 'remapIds' | 'allowWorkspaceMismatch'>> & {
        hmacKeyPath?: string;
    } = {
        merge: typeof mergeOrOptions === 'boolean'
            ? mergeOrOptions
            : mergeOrOptions.merge !== false,
        remapIds: typeof mergeOrOptions === 'object' && mergeOrOptions.remapIds === true,
        allowWorkspaceMismatch: typeof mergeOrOptions === 'object'
            && mergeOrOptions.allowWorkspaceMismatch === true,
        hmacKeyPath: typeof mergeOrOptions === 'object' ? mergeOrOptions.hmacKeyPath : undefined,
    };
    const startedAt = Date.now();
    try {
        const stats = await fs.promises.stat(filePath);
        const maxFileBytes = Math.max(host.maxStorageBytes * 3, MIN_BUNDLE_FILE_BYTES);
        if (host.maxStorageBytes >= 1 && stats.size > maxFileBytes) {
            throw new CheckpointBundleError(
                `Checkpoint bundle is too large (${stats.size} bytes)`,
                'TOO_LARGE',
            );
        }

        const raw = await fs.promises.readFile(filePath, 'utf8');
        const parsed = parseCheckpointBundleJson(raw);

        let checkpoints: CheckpointInfo[];
        let messageCheckpoints: MessageCheckpointMap = {};
        let stableIdCheckpoints: Record<string, string> = {};

        if (isPlainObject(parsed) && parsed.format === CHECKPOINT_BUNDLE_FORMAT) {
            const bundle = verifyCheckpointBundle(parsed);
            if (bundle.hmacSha256) {
                const hmacKey = await readHmacKey(options.hmacKeyPath ?? defaultBundleHmacKeyPath());
                verifyOptionalBundleHmac(bundle, hmacKey);
            }
            checkpoints = await importVerifiedBundle(host, bundle, options);
            messageCheckpoints = bundle.messageCheckpoints;
            stableIdCheckpoints = bundle.stableIdCheckpoints;
        } else if (isPlainObject(parsed)) {
            checkpoints = await importLegacyCheckpoints(host, parsed, options);
            messageCheckpoints = isPlainObject(parsed.messageCheckpoints)
                ? Object.fromEntries(
                    Object.entries(parsed.messageCheckpoints).filter(
                        (entry): entry is [string, string] => typeof entry[1] === 'string',
                    ),
                )
                : {};
        } else {
            throw new CheckpointBundleError('Invalid backup file format', 'INVALID_FORMAT');
        }

        const importedCount = await persistImportedCheckpoints(
            host,
            checkpoints,
            { messageCheckpoints, stableIdCheckpoints },
            options,
        );

        log.info(`📥 Imported ${importedCount} checkpoints from ${filePath}`);
        await host.appendAuditEvent({
            action: 'import',
            resourceId: filePath,
            outcome: 'success',
            durationMs: Date.now() - startedAt,
            counts: { checkpoints: importedCount },
        }).catch(() => false);
        await host.recordStorageSnapshot().catch(() => false);
        return importedCount;
    } catch (error) {
        log.error(`Failed to import checkpoints from ${filePath}:`, error);
        await host.appendAuditEvent({
            action: 'import',
            resourceId: filePath,
            outcome: 'failure',
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
        }).catch(() => false);
        throw error;
    }
}
