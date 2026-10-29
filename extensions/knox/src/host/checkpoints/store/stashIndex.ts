import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { writeFileAtomic } from './atomicWrite';
import { referencedBlobHashes } from './blobStore';
import type { FileSnapshot, SkippedFile } from '../manager/types';

export const STASH_DIRNAME = 'stash';
export const STASH_INDEX_FILENAME = 'index.json';
export const STASH_SCHEMA_VERSION = 1;
export const STASH_ID_PREFIX = 'st_';

export interface CheckpointStashEntry {
    id: string;
    message?: string;
    createdAt: Date;
    /** Head at push time. Apply three-way-merges against this tree. */
    baseCheckpointId?: string;
    branchId?: string;
    fileSnapshots: FileSnapshot[];
    skippedFiles?: SkippedFile[];
}

export interface CheckpointStashListItem {
    id: string;
    message?: string;
    createdAt: Date;
    baseCheckpointId?: string;
    branchId?: string;
    fileCount: number;
}

interface PersistedStashIndex {
    schemaVersion: number;
    entries: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stashDir(storageRoot: string): string {
    return path.join(storageRoot, STASH_DIRNAME);
}

export function stashIndexPath(storageRoot: string): string {
    return path.join(stashDir(storageRoot), STASH_INDEX_FILENAME);
}

function parseDate(value: unknown): Date {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
    }
    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }
    return new Date();
}

function parseSnapshot(value: unknown): FileSnapshot | null {
    if (!isRecord(value) || typeof value.relativePath !== 'string' || !value.relativePath.trim()) {
        return null;
    }
    const encoding = typeof value.encoding === 'string' && value.encoding.trim()
        ? value.encoding
        : 'utf8';
    const deleted = value.deleted === true || value.changeType === 'deleted';
    const changeType = value.changeType === 'created' || value.changeType === 'modified' || value.changeType === 'deleted'
        ? value.changeType
        : (deleted ? 'deleted' : 'modified');
    return {
        relativePath: value.relativePath,
        hash: typeof value.hash === 'string' ? value.hash : undefined,
        encoding,
        lastModified: parseDate(value.lastModified),
        size: typeof value.size === 'number' && Number.isFinite(value.size) ? value.size : 0,
        deleted: deleted || undefined,
        changeType,
    };
}

function parseSkipped(value: unknown): SkippedFile | null {
    if (!isRecord(value) || typeof value.path !== 'string') {
        return null;
    }
    const reason = value.reason;
    if (
        reason !== 'too_large'
        && reason !== 'unreadable'
        && reason !== 'binary_disabled'
        && reason !== 'unsafe_path'
    ) {
        return null;
    }
    return { path: value.path, reason };
}

function parseEntry(value: unknown): CheckpointStashEntry | null {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id.startsWith(STASH_ID_PREFIX)) {
        return null;
    }
    const snapshots = Array.isArray(value.fileSnapshots)
        ? value.fileSnapshots.map(parseSnapshot).filter((snapshot): snapshot is FileSnapshot => snapshot !== null)
        : [];
    const skipped = Array.isArray(value.skippedFiles)
        ? value.skippedFiles.map(parseSkipped).filter((item): item is SkippedFile => item !== null)
        : undefined;
    return {
        id: value.id,
        message: typeof value.message === 'string' && value.message.trim() ? value.message.trim() : undefined,
        createdAt: parseDate(value.createdAt),
        baseCheckpointId: typeof value.baseCheckpointId === 'string' && value.baseCheckpointId.trim()
            ? value.baseCheckpointId
            : undefined,
        branchId: typeof value.branchId === 'string' && value.branchId.trim() ? value.branchId : undefined,
        fileSnapshots: snapshots,
        skippedFiles: skipped?.length ? skipped : undefined,
    };
}

function serializeSnapshot(snapshot: FileSnapshot) {
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
    };
}

function serializeEntry(entry: CheckpointStashEntry) {
    return {
        id: entry.id,
        message: entry.message,
        createdAt: entry.createdAt instanceof Date ? entry.createdAt.toISOString() : entry.createdAt,
        baseCheckpointId: entry.baseCheckpointId,
        branchId: entry.branchId,
        fileSnapshots: entry.fileSnapshots.map(serializeSnapshot),
        skippedFiles: entry.skippedFiles,
    };
}

export function toStashListItem(entry: CheckpointStashEntry): CheckpointStashListItem {
    return {
        id: entry.id,
        message: entry.message,
        createdAt: entry.createdAt,
        baseCheckpointId: entry.baseCheckpointId,
        branchId: entry.branchId,
        fileCount: entry.fileSnapshots.length,
    };
}

export async function loadStashIndex(storageRoot: string): Promise<CheckpointStashEntry[]> {
    try {
        const raw = await fs.readFile(stashIndexPath(storageRoot), 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (!isRecord(parsed) || !Array.isArray(parsed.entries)) {
            return [];
        }
        return parsed.entries
            .map(parseEntry)
            .filter((entry): entry is CheckpointStashEntry => entry !== null);
    } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
            return [];
        }
        return [];
    }
}

export async function saveStashIndex(
    storageRoot: string,
    entries: readonly CheckpointStashEntry[],
): Promise<void> {
    const payload: PersistedStashIndex = {
        schemaVersion: STASH_SCHEMA_VERSION,
        entries: entries.map(serializeEntry),
    };
    await writeFileAtomic(stashIndexPath(storageRoot), JSON.stringify(payload, null, 2), 'utf8');
}

/** Blob hashes named by stash entries. Used so GC cannot free parked dirty trees. */
export async function collectStashBlobHashes(storageRoot: string): Promise<string[]> {
    const entries = await loadStashIndex(storageRoot);
    const hashes: string[] = [];
    for (const entry of entries) {
        hashes.push(...referencedBlobHashes(entry.fileSnapshots));
    }
    return hashes;
}

export async function collectStashBaseCheckpointIds(storageRoot: string): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const entry of await loadStashIndex(storageRoot)) {
        if (entry.baseCheckpointId) {
            ids.add(entry.baseCheckpointId);
        }
    }
    return ids;
}
