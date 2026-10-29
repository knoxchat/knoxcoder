/**
 * Rename / copy detection between parent and child inventories (CP-40).
 * Same blob hash is score 100. Text similarity is a line LCS / Dice ratio.
 * Lexical only — no embeddings or ML.
 */

import { getBlob, isBinaryCheckpointEncoding, snapshotContentFromBytes } from '../store/blobStore';
import { readBlobOptions } from './blobCrypto';
import type { CheckpointEngineHost } from './host';
import { toPosixRelative } from './pathFilter';
import type { CheckpointFileDiff, FileSnapshot } from './types';

export const RENAME_SIMILARITY_THRESHOLD = 0.6;
export const RENAME_SIMILARITY_SIZE_CAP = 256 * 1024;
export const RENAME_SIMILARITY_LINE_CAP = 4000;

export interface DetectFile {
    relativePath: string;
    hash?: string;
    content?: string;
    encoding?: string;
    size?: number;
}

export type LineageKind = 'rename' | 'copy';

export interface LineageMatch {
    kind: LineageKind;
    from: string;
    to: string;
    /** 0–100, git-style. Hash or identical content is 100. */
    score: number;
}

export interface DetectOptions {
    threshold?: number;
    similaritySizeCap?: number;
}

export function posixDetectPath(relativePath: string): string {
    return toPosixRelative(relativePath).replace(/\\/g, '/');
}

export function snapshotIsDeleted(
    snapshot: Pick<FileSnapshot, 'deleted' | 'changeType'>,
): boolean {
    return snapshot.deleted === true || snapshot.changeType === 'deleted';
}

export function contentSimilarity(left: string, right: string): number {
    if (left === right) {
        return 1;
    }
    const a = left.length === 0 ? [] : left.split('\n');
    const b = right.length === 0 ? [] : right.split('\n');
    if (a.length === 0 && b.length === 0) {
        return 1;
    }
    if (a.length === 0 || b.length === 0) {
        return 0;
    }
    if (a.length + b.length > RENAME_SIMILARITY_LINE_CAP * 2) {
        return bagSimilarity(a, b);
    }
    const lcs = lcsLength(a, b);
    return (2 * lcs) / (a.length + b.length);
}

function bagSimilarity(a: string[], b: string[]): number {
    const remaining = new Map<string, number>();
    for (const line of a) {
        remaining.set(line, (remaining.get(line) ?? 0) + 1);
    }
    let common = 0;
    for (const line of b) {
        const count = remaining.get(line) ?? 0;
        if (count > 0) {
            common += 1;
            remaining.set(line, count - 1);
        }
    }
    return (2 * common) / (a.length + b.length);
}

function lcsLength(a: string[], b: string[]): number {
    const n = a.length;
    const m = b.length;
    if (n === 0 || m === 0) {
        return 0;
    }
    let prev = new Uint32Array(m + 1);
    let next = new Uint32Array(m + 1);
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            next[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], next[j - 1]);
        }
        const swap = prev;
        prev = next;
        next = swap;
        next.fill(0);
    }
    return prev[m];
}

function fileLooksBinary(file: DetectFile): boolean {
    if (isBinaryCheckpointEncoding(file.encoding)) {
        return true;
    }
    if (file.content && file.content.includes('\0')) {
        return true;
    }
    return false;
}

function fileSize(file: DetectFile): number {
    if (typeof file.size === 'number' && Number.isFinite(file.size)) {
        return file.size;
    }
    if (typeof file.content === 'string') {
        return file.content.length;
    }
    return 0;
}

function pairScore(left: DetectFile, right: DetectFile, sizeCap: number): number {
    if (left.hash && right.hash && left.hash === right.hash) {
        return 100;
    }
    if (left.content != null && right.content != null && left.content === right.content) {
        return 100;
    }
    if (fileLooksBinary(left) || fileLooksBinary(right)) {
        return 0;
    }
    if (fileSize(left) > sizeCap || fileSize(right) > sizeCap) {
        return 0;
    }
    if (left.content == null || right.content == null) {
        return 0;
    }
    return Math.round(contentSimilarity(left.content, right.content) * 100);
}

export function detectRenamesAndCopies(
    added: DetectFile[],
    removed: DetectFile[],
    surviving: DetectFile[] = [],
    options?: DetectOptions,
): LineageMatch[] {
    const threshold = Math.round((options?.threshold ?? RENAME_SIMILARITY_THRESHOLD) * 100);
    const sizeCap = options?.similaritySizeCap ?? RENAME_SIMILARITY_SIZE_CAP;
    const usedAdded = new Set<string>();
    const usedRemoved = new Set<string>();
    const matches: LineageMatch[] = [];

    const take = (kind: LineageKind, from: string, to: string, score: number): boolean => {
        if (!from || !to || from === to || usedAdded.has(to)) {
            return false;
        }
        if (kind === 'rename' && usedRemoved.has(from)) {
            return false;
        }
        usedAdded.add(to);
        if (kind === 'rename') {
            usedRemoved.add(from);
        }
        matches.push({ kind, from, to, score });
        return true;
    };

    const byHash = (files: DetectFile[]): Map<string, DetectFile[]> => {
        const map = new Map<string, DetectFile[]>();
        for (const file of files) {
            if (!file.hash) {
                continue;
            }
            const list = map.get(file.hash) ?? [];
            list.push(file);
            map.set(file.hash, list);
        }
        return map;
    };

    const removedByHash = byHash(removed);
    const survivingByHash = byHash(surviving);

    for (const dest of added) {
        if (!dest.hash) {
            continue;
        }
        const renameSource = (removedByHash.get(dest.hash) ?? []).find(
            (source) => !usedRemoved.has(source.relativePath),
        );
        if (renameSource) {
            take('rename', renameSource.relativePath, dest.relativePath, 100);
        }
    }

    for (const dest of added) {
        if (usedAdded.has(dest.relativePath) || !dest.hash) {
            continue;
        }
        const live = survivingByHash.get(dest.hash)?.[0];
        if (live) {
            take('copy', live.relativePath, dest.relativePath, 100);
            continue;
        }
        const gone = removedByHash.get(dest.hash)?.[0];
        if (gone) {
            take('copy', gone.relativePath, dest.relativePath, 100);
        }
    }

    const remainingAdded = added.filter((file) => !usedAdded.has(file.relativePath));
    const remainingRemoved = removed.filter((file) => !usedRemoved.has(file.relativePath));
    const candidates: LineageMatch[] = [];

    const consider = (kind: LineageKind, source: DetectFile, dest: DetectFile) => {
        const score = pairScore(source, dest, sizeCap);
        if (score >= threshold) {
            candidates.push({ kind, from: source.relativePath, to: dest.relativePath, score });
        }
    };

    for (const dest of remainingAdded) {
        for (const source of remainingRemoved) {
            consider('rename', source, dest);
        }
        for (const source of surviving) {
            consider('copy', source, dest);
        }
        for (const source of removed) {
            if (usedRemoved.has(source.relativePath)) {
                consider('copy', source, dest);
            }
        }
    }

    candidates.sort((left, right) => {
        if (right.score !== left.score) {
            return right.score - left.score;
        }
        if (left.kind !== right.kind) {
            return left.kind === 'rename' ? -1 : 1;
        }
        const byTo = left.to.localeCompare(right.to);
        return byTo !== 0 ? byTo : left.from.localeCompare(right.from);
    });

    for (const candidate of candidates) {
        take(candidate.kind, candidate.from, candidate.to, candidate.score);
    }

    return matches;
}

export function applyLineageMatches(
    snapshots: FileSnapshot[],
    matches: LineageMatch[],
): FileSnapshot[] {
    if (matches.length === 0) {
        return snapshots;
    }
    const byPath = new Map<string, FileSnapshot>();
    for (const snapshot of snapshots) {
        if (snapshotIsDeleted(snapshot)) {
            continue;
        }
        byPath.set(posixDetectPath(snapshot.relativePath), snapshot);
    }
    for (const match of matches) {
        const dest = byPath.get(posixDetectPath(match.to));
        if (!dest) {
            continue;
        }
        if (match.kind === 'rename') {
            dest.renamedFrom = dest.renamedFrom ?? match.from;
        } else if (!dest.renamedFrom) {
            dest.copiedFrom = dest.copiedFrom ?? match.from;
        }
    }
    return snapshots;
}

export async function annotateSnapshotsFromParentIndex(
    snapshots: FileSnapshot[],
    parentHashes: Map<string, string>,
    loadContent?: (hash: string) => Promise<string | undefined>,
): Promise<FileSnapshot[]> {
    if (snapshots.length === 0 || parentHashes.size === 0) {
        return snapshots;
    }

    const added: DetectFile[] = [];
    const removed: DetectFile[] = [];
    const deletedPaths = new Set<string>();

    for (const snapshot of snapshots) {
        const relativePath = posixDetectPath(snapshot.relativePath);
        if (snapshotIsDeleted(snapshot)) {
            deletedPaths.add(relativePath);
            removed.push({
                relativePath,
                hash: snapshot.hash || parentHashes.get(relativePath) || parentHashes.get(snapshot.relativePath),
                content: snapshot.content,
                encoding: snapshot.encoding,
                size: snapshot.size,
            });
            continue;
        }
        const existed = parentHashes.has(relativePath) || parentHashes.has(snapshot.relativePath);
        if (snapshot.changeType === 'created' || !existed) {
            added.push({
                relativePath,
                hash: snapshot.hash,
                content: snapshot.content,
                encoding: snapshot.encoding,
                size: snapshot.size,
            });
        }
    }

    if (added.length === 0) {
        return snapshots;
    }

    const surviving: DetectFile[] = [];
    for (const [path, hash] of parentHashes) {
        const relativePath = posixDetectPath(path);
        if (deletedPaths.has(relativePath)) {
            continue;
        }
        surviving.push({ relativePath, hash });
    }

    const hashMatches = detectRenamesAndCopies(added, removed, surviving);
    const matchedTo = new Set(hashMatches.map((match) => match.to));
    const unmatchedAdded = added.filter((file) => !matchedTo.has(file.relativePath));
    if (unmatchedAdded.length === 0 || !loadContent) {
        return applyLineageMatches(snapshots, hashMatches);
    }

    const usedRemoved = new Set(
        hashMatches.filter((match) => match.kind === 'rename').map((match) => match.from),
    );
    const unmatchedRemoved = removed.filter((file) => !usedRemoved.has(file.relativePath));
    const loadInto = async (file: DetectFile) => {
        if (file.content != null || !file.hash) {
            return;
        }
        file.content = await loadContent(file.hash);
    };
    await Promise.all([
        ...unmatchedAdded.map(loadInto),
        ...unmatchedRemoved.map(loadInto),
    ]);

    const stillNeedCopy = unmatchedAdded.some((file) => file.content != null)
        && unmatchedRemoved.every((file) => file.content == null);
    if (stillNeedCopy && surviving.length > 0 && surviving.length <= 32) {
        await Promise.all(surviving.map(loadInto));
    }

    const similar = detectRenamesAndCopies(unmatchedAdded, unmatchedRemoved, surviving);
    return applyLineageMatches(snapshots, [...hashMatches, ...similar]);
}

export async function annotateCaptureSnapshots(
    host: CheckpointEngineHost,
    snapshots: FileSnapshot[],
): Promise<FileSnapshot[]> {
    if (snapshots.length === 0 || host.lastSnapshotHashes.size === 0) {
        return snapshots;
    }
    const storagePath = host.getStoragePath();
    const blobOpts = await readBlobOptions(host);
    return annotateSnapshotsFromParentIndex(
        snapshots,
        host.lastSnapshotHashes,
        async (hash) => {
            try {
                const bytes = await getBlob(storagePath, hash, blobOpts);
                if (bytes.length > RENAME_SIMILARITY_SIZE_CAP) {
                    return undefined;
                }
                if (bytes.includes(0)) {
                    return undefined;
                }
                return snapshotContentFromBytes(bytes, 'utf8');
            } catch {
                return undefined;
            }
        },
    );
}

export function collapseDiffByLineage<T extends CheckpointFileDiff>(
    files: T[],
    snapshots?: Array<Pick<FileSnapshot, 'relativePath' | 'renamedFrom' | 'copiedFrom' | 'deleted' | 'changeType'>>,
): T[] {
    if (files.length === 0) {
        return files;
    }

    const byPath = new Map(files.map((file) => [posixDetectPath(file.relativePath), file]));
    const consumed = new Set<string>();
    const collapsed: T[] = [];

    const adopt = (dest: T, status: 'renamed' | 'copied', oldPath: string, source?: T) => {
        dest.status = status;
        dest.oldPath = oldPath;
        if (source) {
            dest.oldContent = source.oldContent ?? dest.oldContent;
            dest.oldEncoding = source.oldEncoding ?? dest.oldEncoding;
            if (status === 'copied' && dest.oldContent == null) {
                dest.oldContent = source.newContent ?? source.oldContent;
                dest.oldEncoding = source.newEncoding ?? source.oldEncoding;
            }
        }
        collapsed.push(dest);
        consumed.add(posixDetectPath(dest.relativePath));
        if (status === 'renamed') {
            consumed.add(posixDetectPath(oldPath));
        }
    };

    for (const snapshot of snapshots ?? []) {
        if (snapshotIsDeleted(snapshot)) {
            continue;
        }
        const dest = byPath.get(posixDetectPath(snapshot.relativePath));
        if (!dest || consumed.has(posixDetectPath(dest.relativePath))) {
            continue;
        }
        if (snapshot.renamedFrom) {
            const source = byPath.get(posixDetectPath(snapshot.renamedFrom));
            adopt(dest, 'renamed', posixDetectPath(snapshot.renamedFrom), source);
        } else if (snapshot.copiedFrom) {
            const source = byPath.get(posixDetectPath(snapshot.copiedFrom));
            adopt(dest, 'copied', posixDetectPath(snapshot.copiedFrom), source);
        }
    }

    const remaining = files.filter((file) => !consumed.has(posixDetectPath(file.relativePath)));
    const added = remaining.filter((file) => file.status === 'added');
    const deleted = remaining.filter((file) => file.status === 'deleted');
    const matches = detectRenamesAndCopies(
        added.map((file) => ({
            relativePath: posixDetectPath(file.relativePath),
            content: file.newContent ?? undefined,
            encoding: file.newEncoding,
        })),
        deleted.map((file) => ({
            relativePath: posixDetectPath(file.relativePath),
            content: file.oldContent ?? undefined,
            encoding: file.oldEncoding,
        })),
    );

    for (const match of matches) {
        const dest = byPath.get(match.to);
        const source = byPath.get(match.from);
        if (!dest || consumed.has(match.to)) {
            continue;
        }
        adopt(dest, match.kind === 'rename' ? 'renamed' : 'copied', match.from, source);
    }

    for (const file of files) {
        if (!consumed.has(posixDetectPath(file.relativePath))) {
            collapsed.push(file);
        }
    }

    return collapsed.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}
