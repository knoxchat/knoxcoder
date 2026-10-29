/**
 * Isolated checkpoint worktree (CP-45). Reconstruct a snapshot outside the
 * main workspace so compare / test / background agents do not touch it.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { createKnoxLogger } from 'core/util/knoxLog';
import { isSafeWorktreeApplyPath } from 'core/tools/worktree';

import { writeFileAtomic } from '../store/atomicWrite';
import { generateCheckpointId } from '../checkpointId';
import type { CheckpointEngineHost } from './host';
import { getStoragePath, initializeStorageDirectories } from './persistence';
import { reconstructStateAtCheckpoint } from './restore';
import type { CheckpointWorktree, MaterializeWorktreeOptions, MaterializeWorktreeResult } from './types';
import { workspaceStorageKey } from './workspace';

const log = createKnoxLogger('Checkpoints');

export const WORKTREE_INDEX_FILENAME = 'worktrees.json';
export const MAX_CHECKPOINT_WORKTREES = 4;
export const MAX_WORKTREE_BYTES = 500 * 1024 * 1024;

export function worktreeIndexPath(host: CheckpointEngineHost): string {
    return path.join(getStoragePath(host), WORKTREE_INDEX_FILENAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseWorktree(value: unknown): CheckpointWorktree | null {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.path !== 'string' || typeof value.checkpointId !== 'string') {
        return null;
    }
    return {
        id: value.id,
        path: value.path,
        checkpointId: value.checkpointId,
        createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
        bytes: typeof value.bytes === 'number' ? value.bytes : 0,
        fileCount: typeof value.fileCount === 'number' ? value.fileCount : 0,
    };
}

export async function listWorktrees(host: CheckpointEngineHost): Promise<CheckpointWorktree[]> {
    try {
        const raw = JSON.parse(await fs.readFile(worktreeIndexPath(host), 'utf8')) as unknown;
        const rows = isRecord(raw) && Array.isArray(raw.worktrees) ? raw.worktrees : [];
        return rows.map(parseWorktree).filter((row): row is CheckpointWorktree => row !== null);
    } catch {
        return [];
    }
}

async function saveWorktrees(host: CheckpointEngineHost, worktrees: CheckpointWorktree[]): Promise<void> {
    await initializeStorageDirectories(host);
    await writeFileAtomic(worktreeIndexPath(host), `${JSON.stringify({ worktrees }, null, 2)}\n`);
}

function isInside(child: string, parent: string): boolean {
    const root = path.resolve(parent);
    const candidate = path.resolve(child);
    return candidate === root || candidate.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`);
}

export function defaultWorktreeDest(workspacePath: string, checkpointId: string): string {
    const key = workspaceStorageKey(workspacePath);
    const shortId = checkpointId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 11) || 'checkpoint';
    return path.join(os.homedir(), '.knoxcoder', 'worktrees', key, shortId);
}

async function writeReconstructedTree(
    workspacePath: string,
    destDir: string,
    state: Map<string, { content: string; encoding: string }>,
): Promise<{ fileCount: number; bytes: number; skipped: string[] }> {
    let fileCount = 0;
    let bytes = 0;
    const skipped: string[] = [];
    for (const [relativePath, file] of [...state.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        if (!isSafeWorktreeApplyPath(relativePath, workspacePath, destDir)) {
            skipped.push(relativePath);
            continue;
        }
        const target = path.join(destDir, relativePath);
        await fs.mkdir(path.dirname(target), { recursive: true });
        const payload = Buffer.from(file.content, file.encoding === 'utf16le' ? 'utf16le' : 'utf8');
        bytes += payload.length;
        if (bytes > MAX_WORKTREE_BYTES) {
            throw new Error(`Worktree exceeds ${MAX_WORKTREE_BYTES} bytes`);
        }
        await fs.writeFile(target, payload);
        fileCount += 1;
    }
    return { fileCount, bytes, skipped };
}

export async function materializeWorktree(
    host: CheckpointEngineHost,
    checkpointId: string,
    options?: MaterializeWorktreeOptions,
): Promise<MaterializeWorktreeResult> {
    await host.whenReady();
    if (!host.initialized || !host.currentWorkspacePath) {
        return { success: false, message: 'Checkpoint system is not ready' };
    }
    const history = host.checkpointHistory.find((checkpoint) => checkpoint.id === checkpointId);
    if (!history) {
        return { success: false, message: `Checkpoint ${checkpointId} not found` };
    }

    const existing = await listWorktrees(host);
    if (existing.length >= MAX_CHECKPOINT_WORKTREES) {
        return { success: false, message: `At most ${MAX_CHECKPOINT_WORKTREES} checkpoint worktrees can exist at once` };
    }

    const destDir = path.resolve(options?.destDir?.trim() || defaultWorktreeDest(host.currentWorkspacePath, checkpointId));
    if (isInside(destDir, host.currentWorkspacePath) && !options?.allowInsideWorkspace) {
        return { success: false, message: 'Refusing to materialize inside the project root' };
    }

    const state = await reconstructStateAtCheckpoint(host, checkpointId);
    if (!state) {
        return { success: false, message: `Could not reconstruct ${checkpointId}` };
    }

    await fs.rm(destDir, { recursive: true, force: true });
    await fs.mkdir(destDir, { recursive: true });
    let written: { fileCount: number; bytes: number; skipped: string[] };
    try {
        written = await writeReconstructedTree(host.currentWorkspacePath, destDir, state);
    } catch (error) {
        await fs.rm(destDir, { recursive: true, force: true });
        return { success: false, message: error instanceof Error ? error.message : String(error) };
    }

    const record: CheckpointWorktree = {
        id: `wt_${generateCheckpointId().replace(/^cp_/, '')}`,
        path: destDir,
        checkpointId,
        createdAt: new Date().toISOString(),
        bytes: written.bytes,
        fileCount: written.fileCount,
    };
    await saveWorktrees(host, [...existing, record]);
    await host.appendAuditEvent({
        action: 'worktree',
        resourceId: record.id,
        outcome: 'success',
        details: { op: 'materialize', checkpointId, path: destDir, files: written.fileCount },
    }).catch(() => false);
    log.info(`Materialized ${checkpointId} to ${destDir} (${written.fileCount} files)`);
    return {
        success: true,
        worktreeId: record.id,
        path: destDir,
        fileCount: written.fileCount,
        bytes: written.bytes,
        skipped: written.skipped,
    };
}

export async function removeWorktree(
    host: CheckpointEngineHost,
    worktreeId: string,
): Promise<{ success: boolean; message?: string }> {
    await host.whenReady();
    const existing = await listWorktrees(host);
    const record = existing.find((item) => item.id === worktreeId);
    if (!record) {
        return { success: false, message: `Worktree ${worktreeId} not found` };
    }
    await fs.rm(record.path, { recursive: true, force: true });
    await saveWorktrees(host, existing.filter((item) => item.id !== worktreeId));
    await host.appendAuditEvent({
        action: 'worktree',
        resourceId: worktreeId,
        outcome: 'success',
        details: { op: 'remove', path: record.path },
    }).catch(() => false);
    log.info(`Removed worktree ${worktreeId}`);
    return { success: true };
}
