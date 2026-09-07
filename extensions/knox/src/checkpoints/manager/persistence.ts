import * as fs from 'fs';
import * as path from 'path';

import * as vscode from 'vscode';

import { getGlobalCheckpointsPath } from 'core/util/paths';
import { createKnoxLogger } from 'core/util/knoxLog';

import { writeFileAtomic, writeFileAtomicSync } from '../store/atomicWrite';
import {
    blobObjectPaths,
    bytesFromSnapshotContent,
    gcUnreferencedBlobs,
    hydrateSnapshotContents,
    objectsDir,
    putBlob,
    referencedBlobHashes,
} from '../store/blobStore';
import { BlobEncryptionError } from '../store/blobEncryption';
import {
    CHECKPOINT_SCHEMA_VERSION,
    computeCheckpointContentSha256,
    verifyStoredCheckpointChecksum,
    type CheckpointLoadResult,
} from '../store/checkpointIntegrity';
import {
    resolveCheckpointStoragePathFor,
    workspaceStorageKey,
} from '../store/workspaceStore';
import { defaultBranch, lineageCheckpoints, parseBranches, serializeBranch, synthesizeBranchesFromHistory } from './branchLogic';
import { applySnapshotHashes } from './capture';
import { readBlobOptions, writeBlobOptions } from './blobCrypto';
import type { CheckpointEngineHost } from './host';
import {
    computeCheckpointFileStats,
    type CheckpointBranch,
    type CheckpointHealthIssue,
    type CheckpointInfo,
    type FileSnapshot,
    type MessageCheckpointMap,
} from './types';
import { workspacePathsEqual } from './workspace';

const log = createKnoxLogger('Checkpoints');

export function resolveCheckpointStoragePath(workspacePath: string | undefined): string {
    return resolveCheckpointStoragePathFor(workspacePath, {
        globalCheckpointsPath: getGlobalCheckpointsPath(),
    });
}

export function getStoragePath(host: CheckpointEngineHost): string {
    return host.getStoragePath();
}

export function getCheckpointHistoryPath(context: vscode.ExtensionContext): string {
    return path.join(context.globalStorageUri.fsPath, 'checkpoint-history.json');
}

export const CHECKPOINT_INDEX_VERSION = 1;
export const CHECKPOINT_INDEX_FILENAME = 'index.json';

export function getCheckpointIndexPath(host: CheckpointEngineHost): string {
    return path.join(getStoragePath(host), CHECKPOINT_INDEX_FILENAME);
}

export function toIndexRecord(checkpoint: CheckpointInfo): CheckpointInfo {
    const created = checkpoint.created instanceof Date
        ? checkpoint.created
        : new Date(checkpoint.created);
    return {
        id: checkpoint.id,
        description: checkpoint.description,
        created,
        messageId: checkpoint.messageId,
        stableId: checkpoint.stableId,
        workspacePath: checkpoint.workspacePath,
        workspaceKey: checkpoint.workspaceKey ?? (checkpoint.workspacePath
            ? workspaceStorageKey(checkpoint.workspacePath)
            : undefined),
        captureMode: checkpoint.captureMode,
        skippedFiles: checkpoint.skippedFiles,
        schemaVersion: checkpoint.schemaVersion,
        contentSha256: checkpoint.contentSha256,
        pinned: checkpoint.pinned,
        tags: checkpoint.tags,
        sessionId: checkpoint.sessionId,
        branchId: checkpoint.branchId,
        parentCheckpointId: checkpoint.parentCheckpointId,
        changedPaths: checkpoint.changedPaths,
        conversationContext: checkpoint.conversationContext,
        fileStats: computeCheckpointFileStats({
            fileSnapshots: checkpoint.fileSnapshots,
            fileInventory: checkpoint.fileInventory,
            fileStats: checkpoint.fileStats,
        }),
    };
}

function serializeIndexRecord(checkpoint: CheckpointInfo) {
    const indexed = toIndexRecord(checkpoint);
    return {
        ...indexed,
        created: indexed.created.toISOString(),
    };
}

function indexLooksFat(history: any[] | undefined): boolean {
    return (history ?? []).some((checkpoint) =>
        (Array.isArray(checkpoint?.fileSnapshots) && checkpoint.fileSnapshots.length > 0) ||
        (Array.isArray(checkpoint?.fileInventory) && checkpoint.fileInventory.length > 0),
    );
}

function parseIndexPayload(raw: string): {
    messageCheckpoints: MessageCheckpointMap;
    stableIdCheckpoints: { [stableId: string]: string };
    checkpointHistory: CheckpointInfo[];
    branches: CheckpointBranch[];
    activeBranchId?: string;
    indexVersion?: number;
    fat: boolean;
} {
    const stored = JSON.parse(raw);
    const history = stored.checkpointHistory ?? [];
    const activeBranchId = typeof stored.activeBranchId === 'string' && stored.activeBranchId.trim()
        ? stored.activeBranchId
        : undefined;
    return {
        messageCheckpoints: stored.messageCheckpoints || {},
        stableIdCheckpoints: stored.stableIdCheckpoints || {},
        checkpointHistory: history.map((cp: any) => toIndexRecord({
            ...cp,
            created: new Date(cp.created),
        })),
        branches: parseBranches(stored.branches),
        activeBranchId,
        indexVersion: stored.indexVersion,
        fat: indexLooksFat(history) || stored.indexVersion !== CHECKPOINT_INDEX_VERSION,
    };
}

async function readIndexFile(filePath: string): Promise<ReturnType<typeof parseIndexPayload> | null> {
    try {
        if (!fs.existsSync(filePath)) {
            return null;
        }
        return parseIndexPayload(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        log.warn(`Failed to read checkpoint index ${filePath}:`, error);
        return null;
    }
}

export async function rebuildSnapshotHashIndexFromDisk(host: CheckpointEngineHost): Promise<void> {
    host.lastSnapshotHashes.clear();
    const chronological = [...host.checkpointHistory].sort(
        (a, b) => a.created.getTime() - b.created.getTime(),
    );
    const headId = host.activeBranchId
        ? host.branches.find((branch) => branch.id === host.activeBranchId)?.headCheckpointId
        : chronological[chronological.length - 1]?.id;
    const chain = headId
        ? (lineageCheckpoints(chronological, headId) ?? chronological)
        : chronological;
    for (const checkpoint of chain) {
        const result = await readCheckpointRecord(host, checkpoint.id);
        if (result.status !== 'ok') {
            continue;
        }
        applySnapshotHashes(host, result.checkpoint.fileSnapshots ?? []);
        if (!checkpoint.fileStats) {
            checkpoint.fileStats = computeCheckpointFileStats(result.checkpoint);
        }
        if (checkpoint.id === headId && result.checkpoint.fileInventory) {
            host.previousCheckpointFiles = new Set(result.checkpoint.fileInventory);
        }
    }
    const head = headId
        ? host.checkpointHistory.find((checkpoint) => checkpoint.id === headId)
        : undefined;
    if (head) {
        host.lastCheckpointTime = head.created.getTime();
    }
    log.debug(`🔎 Rebuilt snapshot hash index from manifests for ${host.lastSnapshotHashes.size} files`);
}

export function recordHealthIssue(
    host: CheckpointEngineHost,
    issue: Omit<CheckpointHealthIssue, 'timestamp'>,
): void {
    host.healthIssues.push({
        ...issue,
        timestamp: new Date().toISOString(),
    });
    if (host.healthIssues.length > 100) {
        host.healthIssues = host.healthIssues.slice(-100);
    }
}

export async function initializeStorageDirectories(host: CheckpointEngineHost): Promise<void> {
    const storagePath = getStoragePath(host);
    try {
        await fs.promises.mkdir(storagePath, { recursive: true });
        await fs.promises.mkdir(objectsDir(storagePath), { recursive: true });
        log.info(`📁 Initialized checkpoint storage: ${storagePath}`);
    } catch (error) {
        log.error(`❌ Failed to initialize storage directories: ${error}`);
        throw error;
    }
}

function isDeletedSnapshot(snapshot: FileSnapshot): boolean {
    return snapshot.deleted === true || snapshot.changeType === 'deleted';
}

async function ensureSnapshotBlob(
    host: CheckpointEngineHost,
    snapshot: FileSnapshot,
): Promise<FileSnapshot> {
    if (isDeletedSnapshot(snapshot) || snapshot.hash) {
        return snapshot;
    }
    if (snapshot.content == null) {
        return snapshot;
    }
    const bytes = bytesFromSnapshotContent(snapshot.content, snapshot.encoding || 'utf8');
    const hash = await putBlob(getStoragePath(host), bytes, await writeBlobOptions(host));
    return { ...snapshot, hash };
}

function serializeSnapshotForDisk(snapshot: FileSnapshot) {
    return {
        relativePath: snapshot.relativePath,
        hash: snapshot.hash,
        encoding: snapshot.encoding,
        lastModified: snapshot.lastModified instanceof Date
            ? snapshot.lastModified.toISOString()
            : snapshot.lastModified,
        size: snapshot.size,
        deleted: snapshot.deleted,
        changeType: snapshot.changeType,
        // Schema 1 fallback: keep inlined content only when no blob hash exists.
        ...(snapshot.hash ? {} : snapshot.content != null ? { content: snapshot.content } : {}),
    };
}

export async function hydrateCheckpointSnapshots(
    host: CheckpointEngineHost,
    snapshots: FileSnapshot[] | undefined,
): Promise<FileSnapshot[]> {
    if (!snapshots || snapshots.length === 0) {
        return snapshots ?? [];
    }
    return hydrateSnapshotContents(getStoragePath(host), snapshots, await readBlobOptions(host));
}

async function collectBlobHashesFromManifestFile(filePath: string): Promise<string[]> {
    try {
        const data = JSON.parse(await fs.promises.readFile(filePath, 'utf8')) as {
            fileSnapshots?: Array<{ hash?: string; deleted?: boolean; changeType?: string }>;
        };
        return referencedBlobHashes(data.fileSnapshots);
    } catch {
        return [];
    }
}

export async function collectReferencedBlobHashes(host: CheckpointEngineHost): Promise<Set<string>> {
    const hashes = new Set<string>();
    for (const checkpoint of host.checkpointHistory) {
        for (const hash of referencedBlobHashes(checkpoint.fileSnapshots)) {
            hashes.add(hash);
        }
    }

    const storagePath = getStoragePath(host);
    let entries: string[];
    try {
        entries = await fs.promises.readdir(storagePath);
    } catch {
        return hashes;
    }

    for (const entry of entries) {
        if (!entry.startsWith('cp_') || !entry.endsWith('.json')) {
            continue;
        }
        const checkpointId = entry.slice(0, -'.json'.length);
        const result = await readCheckpointRecord(host, checkpointId);
        if (result.status === 'ok') {
            for (const hash of referencedBlobHashes(result.checkpoint.fileSnapshots)) {
                hashes.add(hash);
            }
            continue;
        }
        // Checksum-failed JSON can still name real blobs. Keep them so auto-GC
        // cannot delete recoverable objects while the manifest is on disk.
        for (const hash of await collectBlobHashesFromManifestFile(path.join(storagePath, entry))) {
            hashes.add(hash);
        }
    }

    return hashes;
}

export async function gcUnreferencedCheckpointBlobs(host: CheckpointEngineHost): Promise<{
    deleted: number;
    bytesReclaimed: number;
}> {
    try {
        const referenced = await collectReferencedBlobHashes(host);
        const result = await gcUnreferencedBlobs(getStoragePath(host), referenced);
        if (result.deleted > 0) {
            log.info(`🧹 GC removed ${result.deleted} unreferenced blobs (${result.bytesReclaimed} bytes)`);
        }
        return result;
    } catch (error) {
        log.warn('Failed to garbage-collect checkpoint blobs:', error);
        return { deleted: 0, bytesReclaimed: 0 };
    }
}

export async function saveCheckpointToDisk(
    host: CheckpointEngineHost,
    checkpointInfo: CheckpointInfo,
): Promise<void> {
    const storagePath = getStoragePath(host);
    const checkpointFile = path.join(storagePath, `${checkpointInfo.id}.json`);

    try {
        const snapshots = await Promise.all(
            (checkpointInfo.fileSnapshots ?? []).map((snapshot) => ensureSnapshotBlob(host, snapshot)),
        );
        checkpointInfo.fileSnapshots = snapshots;
        checkpointInfo.schemaVersion = CHECKPOINT_SCHEMA_VERSION;

        const contentSha256 = computeCheckpointContentSha256({
            id: checkpointInfo.id,
            schemaVersion: CHECKPOINT_SCHEMA_VERSION,
            fileInventory: checkpointInfo.fileInventory,
            skippedFiles: checkpointInfo.skippedFiles,
            fileSnapshots: snapshots,
        });
        checkpointInfo.contentSha256 = contentSha256;

        const checkpointData = {
            ...checkpointInfo,
            schemaVersion: CHECKPOINT_SCHEMA_VERSION,
            contentSha256,
            created: checkpointInfo.created.toISOString(),
            fileSnapshots: snapshots.map(serializeSnapshotForDisk),
        };

        await writeFileAtomic(checkpointFile, JSON.stringify(checkpointData, null, 2), 'utf8');
        log.info(`💾 Saved checkpoint ${checkpointInfo.id} to disk with ${snapshots.length} files`);
    } catch (error) {
        recordHealthIssue(host, {
            kind: 'write_failed',
            checkpointId: checkpointInfo.id,
            message: error instanceof Error ? error.message : String(error),
        });
        log.error(`Failed to save checkpoint ${checkpointInfo.id} to disk:`, error);
        throw error;
    }
}

export async function readCheckpointRecord(
    host: CheckpointEngineHost,
    checkpointId: string,
): Promise<CheckpointLoadResult<CheckpointInfo>> {
    const checkpointFile = path.join(getStoragePath(host), `${checkpointId}.json`);

    let content: string;
    try {
        content = await fs.promises.readFile(checkpointFile, 'utf8');
    } catch (error: any) {
        if (error?.code === 'ENOENT') {
            return { status: 'not_found' };
        }
        return {
            status: 'corrupt',
            reason: `unreadable: ${error instanceof Error ? error.message : String(error)}`,
        };
    }

    let data: any;
    try {
        data = JSON.parse(content);
    } catch (error) {
        return {
            status: 'corrupt',
            reason: `invalid json: ${error instanceof Error ? error.message : String(error)}`,
        };
    }

    const checksum = verifyStoredCheckpointChecksum({
        id: data.id ?? checkpointId,
        schemaVersion: data.schemaVersion,
        contentSha256: data.contentSha256,
        fileInventory: data.fileInventory,
        skippedFiles: data.skippedFiles,
        fileSnapshots: data.fileSnapshots,
    });
    if (!checksum.ok) {
        return { status: 'corrupt', reason: checksum.reason };
    }

    return {
        status: 'ok',
        checkpoint: {
            ...data,
            created: new Date(data.created),
            fileSnapshots: data.fileSnapshots?.map((snapshot: any) => ({
                ...snapshot,
                lastModified: new Date(snapshot.lastModified),
            })),
        },
    };
}

export async function loadCheckpointFromDisk(
    host: CheckpointEngineHost,
    checkpointId: string,
): Promise<CheckpointInfo | null> {
    const result = await readCheckpointRecord(host, checkpointId);
    host.lastCheckpointLoad = result;
    if (result.status === 'corrupt') {
        recordHealthIssue(host, {
            kind: 'corrupt',
            checkpointId,
            message: result.reason,
        });
        log.error(`Checkpoint ${checkpointId} is corrupt: ${result.reason}`);
        return null;
    }
    if (result.status === 'not_found') {
        return null;
    }
    try {
        result.checkpoint.fileSnapshots = await hydrateCheckpointSnapshots(
            host,
            result.checkpoint.fileSnapshots,
        );
    } catch (error) {
        if (error instanceof BlobEncryptionError) {
            throw error;
        }
        const reason = error instanceof Error ? error.message : String(error);
        host.lastCheckpointLoad = { status: 'corrupt', reason };
        recordHealthIssue(host, {
            kind: 'corrupt',
            checkpointId,
            message: reason,
        });
        log.error(`Checkpoint ${checkpointId} is missing blobs: ${reason}`);
        return null;
    }
    return result.checkpoint;
}

export async function rebuildHistoryFromManifests(host: CheckpointEngineHost): Promise<boolean> {
    const storagePath = getStoragePath(host);
    let entries: string[] = [];
    if (fs.existsSync(storagePath)) {
        try {
            entries = await fs.promises.readdir(storagePath);
        } catch (error) {
            log.error('Failed to scan checkpoint manifests for index rebuild:', error);
            return false;
        }
    }

    const loaded: CheckpointInfo[] = [];
    const snapshotById = new Map<string, FileSnapshot[]>();
    for (const entry of entries) {
        if (!entry.startsWith('cp_') || !entry.endsWith('.json')) {
            continue;
        }
        const checkpointId = entry.slice(0, -'.json'.length);
        const result = await readCheckpointRecord(host, checkpointId);
        if (result.status === 'ok') {
            snapshotById.set(result.checkpoint.id, result.checkpoint.fileSnapshots ?? []);
            loaded.push(toIndexRecord(result.checkpoint));
        } else if (result.status === 'corrupt') {
            recordHealthIssue(host, {
                kind: 'corrupt',
                checkpointId,
                message: result.reason,
            });
        }
    }

    loaded.sort((a, b) => a.created.getTime() - b.created.getTime());
    host.checkpointHistory = loaded;
    host.messageCheckpoints = {};
    host.stableIdCheckpoints = {};
    host.branches = synthesizeBranchesFromHistory(loaded);
    host.activeBranchId = defaultBranch(host.branches)?.id;
    host.lastSnapshotHashes.clear();
    for (const checkpoint of loaded) {
        if (checkpoint.messageId) {
            host.messageCheckpoints[checkpoint.messageId] = checkpoint.id;
        }
        if (checkpoint.stableId) {
            host.stableIdCheckpoints[checkpoint.stableId] = checkpoint.id;
        }
        applySnapshotHashes(host, snapshotById.get(checkpoint.id) ?? []);
    }
    await host.saveCheckpointHistory();
    log.info(`Rebuilt checkpoint index from ${loaded.length} on-disk manifests`);
    return true;
}

export async function saveCheckpointHistory(host: CheckpointEngineHost): Promise<void> {
    try {
        host.checkpointHistory = host.checkpointHistory.map(toIndexRecord);
        const payload = {
            indexVersion: CHECKPOINT_INDEX_VERSION,
            messageCheckpoints: host.messageCheckpoints,
            stableIdCheckpoints: host.stableIdCheckpoints,
            checkpointHistory: host.checkpointHistory.map(serializeIndexRecord),
            branches: (host.branches ?? []).map(serializeBranch),
            activeBranchId: host.activeBranchId,
            lastUpdated: new Date().toISOString(),
        };
        const serialized = JSON.stringify(payload, null, 2);

        const storagePath = getStoragePath(host);
        await fs.promises.mkdir(storagePath, { recursive: true });
        await writeFileAtomic(getCheckpointIndexPath(host), serialized, 'utf8');

        const context = host.extensionContext;
        if (!context) {
            return;
        }
        const historyPath = getCheckpointHistoryPath(context);
        const storageDir = path.dirname(historyPath);
        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
        }
        writeFileAtomicSync(historyPath, serialized, 'utf8');
    } catch (error) {
        log.error('Failed to save checkpoint history:', error);
    }
}

function applyLoadedIndex(
    host: CheckpointEngineHost,
    stored: {
        messageCheckpoints: MessageCheckpointMap;
        stableIdCheckpoints: { [stableId: string]: string };
        checkpointHistory: CheckpointInfo[];
        branches?: CheckpointBranch[];
        activeBranchId?: string;
    },
): void {
    host.messageCheckpoints = stored.messageCheckpoints;
    host.stableIdCheckpoints = stored.stableIdCheckpoints;
    host.checkpointHistory = stored.checkpointHistory;
    host.branches = stored.branches ?? [];
    host.activeBranchId = stored.activeBranchId
        && host.branches.some((branch) => branch.id === stored.activeBranchId)
        ? stored.activeBranchId
        : host.branches[0]?.id;
}

export async function loadIndexFromCurrentStore(host: CheckpointEngineHost): Promise<boolean> {
    const stored = await readIndexFile(getCheckpointIndexPath(host));
    if (stored) {
        applyLoadedIndex(host, stored);
        await rebuildSnapshotHashIndexFromDisk(host);
        return true;
    }
    const rebuilt = await rebuildHistoryFromManifests(host);
    if (rebuilt) {
        await rebuildSnapshotHashIndexFromDisk(host);
    }
    return rebuilt;
}

export async function maybeMigrateLegacyGlobalStore(host: CheckpointEngineHost): Promise<boolean> {
    const dest = getStoragePath(host);
    const workspacePath = host.currentWorkspacePath;
    if (!workspacePath || dest.includes(`${path.sep}.knox-debug${path.sep}`)) {
        return false;
    }

    const destIndex = path.join(dest, CHECKPOINT_INDEX_FILENAME);
    if (fs.existsSync(destIndex)) {
        return false;
    }

    const legacyRoot = getGlobalCheckpointsPath();
    if (path.resolve(dest) === path.resolve(legacyRoot)) {
        return false;
    }

    const parsed = await readIndexFile(path.join(legacyRoot, CHECKPOINT_INDEX_FILENAME));
    if (!parsed || parsed.checkpointHistory.length === 0) {
        return false;
    }

    const currentKey = workspaceStorageKey(workspacePath);
    const matching = parsed.checkpointHistory.filter((checkpoint) => {
        if (checkpoint.workspaceKey) {
            return checkpoint.workspaceKey === currentKey;
        }
        return checkpoint.workspacePath
            ? workspacePathsEqual(checkpoint.workspacePath, workspacePath)
            : false;
    });
    if (matching.length === 0) {
        return false;
    }

    await fs.promises.mkdir(dest, { recursive: true });
    await fs.promises.mkdir(objectsDir(dest), { recursive: true });

    const matchingIds = new Set(matching.map((checkpoint) => checkpoint.id));
    for (const checkpoint of matching) {
        const srcJson = path.join(legacyRoot, `${checkpoint.id}.json`);
        const destJson = path.join(dest, `${checkpoint.id}.json`);
        try {
            await fs.promises.copyFile(srcJson, destJson);
        } catch {
            log.warn(`Legacy checkpoint ${checkpoint.id} missing during workspace migration`);
        }
    }

    const referenced = new Set<string>();
    for (const checkpoint of matching) {
        const result = await readCheckpointRecord(host, checkpoint.id);
        if (result.status === 'ok') {
            for (const hash of referencedBlobHashes(result.checkpoint.fileSnapshots)) {
                referenced.add(hash);
            }
        }
    }
    for (const hash of referenced) {
        const src = blobObjectPaths(legacyRoot, hash);
        const destPaths = blobObjectPaths(dest, hash);
        await fs.promises.mkdir(destPaths.dir, { recursive: true });
        try {
            if (fs.existsSync(src.gz)) {
                await fs.promises.copyFile(src.gz, destPaths.gz);
            } else if (fs.existsSync(src.raw)) {
                await fs.promises.copyFile(src.raw, destPaths.raw);
            }
        } catch {
            // blob already copied or missing
        }
    }

    host.checkpointHistory = matching.map((checkpoint) => toIndexRecord(checkpoint));
    host.messageCheckpoints = Object.fromEntries(
        Object.entries(parsed.messageCheckpoints).filter(([, id]) => matchingIds.has(id)),
    );
    host.stableIdCheckpoints = Object.fromEntries(
        Object.entries(parsed.stableIdCheckpoints).filter(([, id]) => matchingIds.has(id)),
    );
    await saveCheckpointHistory(host);
    log.info(`🔄 Migrated ${matching.length} checkpoints into isolated store ${dest}`);
    return true;
}

export async function loadCheckpointHistory(
    host: CheckpointEngineHost,
    context: vscode.ExtensionContext,
): Promise<void> {
    try {
        await maybeMigrateLegacyGlobalStore(host);
        const storageDir = path.dirname(getCheckpointHistoryPath(context));
        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
        }

        const fromStore = await readIndexFile(getCheckpointIndexPath(host));
        const fromGlobal = fromStore ? null : await readIndexFile(getCheckpointHistoryPath(context));
        const stored = fromStore ?? fromGlobal;

        if (stored) {
            applyLoadedIndex(host, stored);
            log.info(`✅ Loaded ${host.checkpointHistory.length} checkpoints from disk storage`);
            if (stored.fat) {
                await saveCheckpointHistory(host);
            }
        } else {
            const oldStored = context.globalState.get<{
                messageCheckpoints: MessageCheckpointMap;
                stableIdCheckpoints: { [stableId: string]: string };
                checkpointHistory: CheckpointInfo[];
            }>('knox.checkpointHistory');

            if (oldStored) {
                log.info('🔄 Migrating checkpoint history from globalState to disk...');
                host.messageCheckpoints = oldStored.messageCheckpoints || {};
                host.stableIdCheckpoints = oldStored.stableIdCheckpoints || {};
                host.checkpointHistory = (oldStored.checkpointHistory ?? []).map((cp) =>
                    toIndexRecord({
                        ...cp,
                        created: new Date(cp.created),
                    }),
                );

                await saveCheckpointHistory(host);
                await context.globalState.update('knox.checkpointHistory', undefined);
                log.info('✅ Migration complete - checkpoint history moved to disk');
            } else {
                const rebuilt = await rebuildHistoryFromManifests(host);
                if (rebuilt) {
                    await saveCheckpointHistory(host);
                }
            }
        }

        if (Object.keys(host.stableIdCheckpoints).length === 0 && host.checkpointHistory.length > 0) {
            host.stableIdCheckpoints = {};
            host.checkpointHistory.forEach((cp) => {
                if (cp.stableId) {
                    host.stableIdCheckpoints[cp.stableId] = cp.id;
                }
            });
        }

        await rebuildSnapshotHashIndexFromDisk(host);
    } catch (error) {
        log.error('Failed to load checkpoint history:', error);
        recordHealthIssue(host, {
            kind: 'index_rebuild',
            message: error instanceof Error ? error.message : String(error),
        });
        const rebuilt = await rebuildHistoryFromManifests(host);
        if (rebuilt) {
            await saveCheckpointHistory(host);
        }
    }
}

export async function deleteCheckpointFromDisk(
    host: CheckpointEngineHost,
    checkpointId: string,
): Promise<void> {
    const checkpointFile = path.join(getStoragePath(host), `${checkpointId}.json`);
    try {
        await fs.promises.access(checkpointFile);
        await fs.promises.unlink(checkpointFile);
        log.info(`🗑️ Deleted checkpoint file from disk: ${checkpointId}.json`);
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            log.warn(`⚠️ Checkpoint file not found on disk: ${checkpointId}.json`);
        } else {
            log.error(`Failed to delete checkpoint file ${checkpointId}.json:`, error);
            throw error;
        }
    }
    await gcUnreferencedCheckpointBlobs(host);
}

async function sumDirectoryBytes(dirPath: string): Promise<number> {
    let total = 0;
    let entries: fs.Dirent[];
    try {
        entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    } catch {
        return 0;
    }
    for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name.includes('.tmp')) {
            continue;
        }
        const fullPath = path.join(dirPath, entry.name);
        try {
            if (entry.isDirectory()) {
                total += await sumDirectoryBytes(fullPath);
            } else if (entry.isFile()) {
                const stats = await fs.promises.stat(fullPath);
                total += stats.size;
            }
        } catch {
            // ignore missing/racy files
        }
    }
    return total;
}

export async function computeDiskStorageBytes(host: CheckpointEngineHost): Promise<number> {
    return sumDirectoryBytes(getStoragePath(host));
}
