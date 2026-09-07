import * as fs from 'fs';

import { isBinaryCheckpointEncoding, snapshotContentFromBytes } from '../store/blobStore';
import { captureCompleteFileInventory } from './capture';
import type { CheckpointEngineHost } from './host';
import { reconstructStateAtCheckpoint } from './restore';
import type { CheckpointDiffResult, RestorePreview, RestorePreviewFile } from './types';
import { resolveWorkspaceRelativePath } from './workspace';

/**
 * Approximate line-level change counts for restore preview.
 * Frequency matching is enough for a summary; Pierre diffs remain optional.
 */
export function countLineDelta(
    fromText: string,
    toText: string,
): { additions: number; deletions: number; hunkCount: number } {
    if (fromText === toText) {
        return { additions: 0, deletions: 0, hunkCount: 0 };
    }
    const fromLines = fromText.length === 0 ? [] : fromText.split('\n');
    const toLines = toText.length === 0 ? [] : toText.split('\n');
    const remaining = new Map<string, number>();
    for (const line of fromLines) {
        remaining.set(line, (remaining.get(line) ?? 0) + 1);
    }
    let common = 0;
    for (const line of toLines) {
        const count = remaining.get(line) ?? 0;
        if (count > 0) {
            common++;
            remaining.set(line, count - 1);
        }
    }
    const deletions = fromLines.length - common;
    const additions = toLines.length - common;
    const max = Math.max(fromLines.length, toLines.length);
    let inHunk = false;
    let hunkCount = 0;
    for (let i = 0; i < max; i++) {
        const changed = fromLines[i] !== toLines[i];
        if (changed && !inHunk) {
            hunkCount++;
            inHunk = true;
        } else if (!changed) {
            inHunk = false;
        }
    }
    return {
        additions,
        deletions,
        hunkCount: Math.max(hunkCount, additions > 0 || deletions > 0 ? 1 : 0),
    };
}

async function readWorkspaceContent(
    fullPath: string,
    encoding: string | undefined,
): Promise<string | null> {
    try {
        const buffer = await fs.promises.readFile(fullPath);
        return snapshotContentFromBytes(buffer, encoding || 'utf8');
    } catch {
        return null;
    }
}

/**
 * Dry-run of restore: files whose reconstructed checkpoint content differs
 * from the live workspace, plus extras not in the checkpoint inventory.
 */
export async function previewRestore(
    host: CheckpointEngineHost,
    checkpointId: string,
): Promise<RestorePreview | null> {
    if (!host.currentWorkspacePath) {
        return null;
    }

    const checkpoint = host.checkpointHistory.find((entry) => entry.id === checkpointId);
    if (!checkpoint) {
        return null;
    }

    const stateAtCheckpoint = await reconstructStateAtCheckpoint(host, checkpointId);
    if (!stateAtCheckpoint) {
        return null;
    }

    const fromDisk = await host.loadCheckpointFromDisk(checkpointId);
    const skippedFiles = (fromDisk?.skippedFiles ?? checkpoint.skippedFiles ?? []).map((skipped) => ({
        path: skipped.path,
        reason: skipped.reason,
    }));
    const keepPaths = new Set([
        ...(fromDisk?.fileInventory ?? Array.from(stateAtCheckpoint.keys())),
        ...skippedFiles.map((skipped) => skipped.path),
    ]);

    const files: RestorePreviewFile[] = [];

    for (const [relativePath, resolved] of stateAtCheckpoint) {
        const sandboxed = resolveWorkspaceRelativePath(host, relativePath);
        if (!sandboxed.ok) {
            continue;
        }
        const workspaceContent = await readWorkspaceContent(sandboxed.fullPath, resolved.encoding);
        if (workspaceContent !== null && workspaceContent === resolved.content) {
            continue;
        }

        const action = workspaceContent === null ? 'create' : 'overwrite';
        const stats = isBinaryCheckpointEncoding(resolved.encoding)
            ? { additions: 0, deletions: 0, hunkCount: 1 }
            : countLineDelta(workspaceContent ?? '', resolved.content);
        files.push({
            relativePath,
            action,
            additions: stats.additions,
            deletions: stats.deletions,
            hunkCount: stats.hunkCount,
        });
    }

    const currentFiles = await captureCompleteFileInventory(host);
    for (const relativePath of currentFiles) {
        if (keepPaths.has(relativePath) || stateAtCheckpoint.has(relativePath)) {
            continue;
        }
        const sandboxed = resolveWorkspaceRelativePath(host, relativePath);
        if (!sandboxed.ok) {
            continue;
        }
        const workspaceContent = await readWorkspaceContent(sandboxed.fullPath, 'utf8');
        if (workspaceContent === null) {
            continue;
        }
        const stats = countLineDelta(workspaceContent, '');
        files.push({
            relativePath,
            action: 'delete',
            additions: stats.additions,
            deletions: stats.deletions,
            hunkCount: stats.hunkCount,
        });
    }

    files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    return {
        checkpointId,
        description: checkpoint.description,
        modified: files.filter((file) => file.action === 'overwrite').length,
        added: files.filter((file) => file.action === 'create').length,
        deleted: files.filter((file) => file.action === 'delete').length,
        files,
        writePaths: files
            .filter((file) => file.action !== 'delete')
            .map((file) => file.relativePath),
        extraPaths: files
            .filter((file) => file.action === 'delete')
            .map((file) => file.relativePath),
        skippedFiles,
    };
}

export interface CheckpointDiffSummaryFile {
    relativePath: string;
    status: 'added' | 'deleted' | 'modified';
    additions: number;
    deletions: number;
    hunkCount: number;
}

export interface CheckpointDiffSummary {
    oldCheckpoint: {
        id: string;
        description: string;
        created: string;
    } | null;
    newCheckpoint: {
        id: string;
        description: string;
        created: string;
    };
    files: CheckpointDiffSummaryFile[];
}

/** Strip file contents from a checkpoint diff and keep path + line-change counts. */
export function summarizeCheckpointDiff(diff: CheckpointDiffResult): CheckpointDiffSummary {
    return {
        oldCheckpoint: diff.oldCheckpoint,
        newCheckpoint: diff.newCheckpoint,
        files: diff.files.map((file) => {
            const binary = file.oldEncoding === 'base64' || file.newEncoding === 'base64';
            const stats = binary
                ? { additions: 0, deletions: 0, hunkCount: 1 }
                : countLineDelta(file.oldContent ?? '', file.newContent ?? '');
            return {
                relativePath: file.relativePath,
                status: file.status,
                additions: stats.additions,
                deletions: stats.deletions,
                hunkCount: stats.hunkCount,
            };
        }),
    };
}
