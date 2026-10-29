/**
 * Binary search over a checkpoint line (CP-46). Candidates are materialized
 * into an isolated worktree so the main workspace stays put.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { detectDangerousCommand } from 'core/tools/commandGuard';
import { createKnoxLogger } from 'core/util/knoxLog';

import { writeFileAtomic } from '../store/atomicWrite';
import { lineageCheckpoints } from './branchLogic';
import type { CheckpointEngineHost } from './host';
import { getStoragePath, initializeStorageDirectories } from './persistence';
import type { BisectOptions, BisectResult, BisectVerdict, CheckpointBisectState } from './types';
import { getCheckpointHistoryForWorkspace } from './workspace';
import { listWorktrees, materializeWorktree, removeWorktree } from './worktree';

const log = createKnoxLogger('Checkpoints');

export const BISECT_STATE_FILENAME = 'bisect.json';

/** Git-style oracle: 0 = good, 1–127 = bad, 125 = skip. Success never inspects stderr. */
export function bisectOracleExitCode(error?: unknown): number {
    if (!error) {
        return 0;
    }
    const code = (error as { code?: number }).code;
    if (typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 127) {
        return code;
    }
    return 1;
}

export function refuseDangerousBisectCommand(command: string): string | undefined {
    const danger = detectDangerousCommand(command);
    return danger ? `Command refused: ${danger}` : undefined;
}

export function bisectStatePath(host: CheckpointEngineHost): string {
    return path.join(getStoragePath(host), BISECT_STATE_FILENAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseIds(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0) : [];
}

export function parseBisectState(value: unknown): CheckpointBisectState | null {
    if (!isRecord(value) || typeof value.badId !== 'string' || !Array.isArray(value.remaining)) {
        return null;
    }
    return {
        badId: value.badId,
        goodId: typeof value.goodId === 'string' ? value.goodId : undefined,
        remaining: parseIds(value.remaining),
        current: typeof value.current === 'string' ? value.current : undefined,
        goodIds: parseIds(value.goodIds),
        badIds: parseIds(value.badIds),
        skippedIds: parseIds(value.skippedIds),
        worktreeId: typeof value.worktreeId === 'string' ? value.worktreeId : undefined,
        worktreePath: typeof value.worktreePath === 'string' ? value.worktreePath : undefined,
        firstBadId: typeof value.firstBadId === 'string' ? value.firstBadId : undefined,
        createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    };
}

export async function loadBisectState(host: CheckpointEngineHost): Promise<CheckpointBisectState | null> {
    try {
        return parseBisectState(JSON.parse(await fs.readFile(bisectStatePath(host), 'utf8')));
    } catch {
        return null;
    }
}

export async function saveBisectState(host: CheckpointEngineHost, state: CheckpointBisectState): Promise<void> {
    await initializeStorageDirectories(host);
    await writeFileAtomic(bisectStatePath(host), `${JSON.stringify(state, null, 2)}\n`);
}

export async function clearBisectState(host: CheckpointEngineHost): Promise<void> {
    try {
        await fs.unlink(bisectStatePath(host));
    } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }
}

function pickCurrent(remaining: string[]): string | undefined {
    if (remaining.length === 0) {
        return undefined;
    }
    return remaining[Math.floor((remaining.length - 1) / 2)];
}

function resultFrom(host: CheckpointEngineHost, state: CheckpointBisectState, steps: number, message?: string): BisectResult {
    const done = Boolean(state.firstBadId);
    const firstBad = done
        ? host.checkpointHistory.find((checkpoint) => checkpoint.id === state.firstBadId)
        : undefined;
    return {
        success: true,
        done,
        currentId: state.current,
        firstBadId: state.firstBadId,
        remaining: state.remaining.length,
        steps,
        worktreePath: state.worktreePath,
        message: message ?? (done ? `First bad checkpoint is ${state.firstBadId}` : undefined),
        ...(firstBad?.label || firstBad?.description ? { label: firstBad.label || firstBad.description } : {}),
        ...(firstBad?.intent ? { intent: firstBad.intent } : {}),
        ...(firstBad?.changedPaths?.length ? { changedPaths: firstBad.changedPaths } : {}),
    };
}

async function checkoutCurrent(host: CheckpointEngineHost, state: CheckpointBisectState): Promise<CheckpointBisectState> {
    if (state.worktreeId) {
        await removeWorktree(host, state.worktreeId).catch(() => ({ success: false }));
    }
    if (!state.current) {
        return { ...state, worktreeId: undefined, worktreePath: undefined };
    }
    const destDir = path.join(getStoragePath(host), 'bisect-worktree');
    const materialized = await materializeWorktree(host, state.current, { destDir });
    if (!materialized.success) {
        throw new Error(materialized.message || `Could not materialize ${state.current}`);
    }
    return {
        ...state,
        worktreeId: materialized.worktreeId,
        worktreePath: materialized.path,
    };
}

function rangeIds(host: CheckpointEngineHost, badId: string, goodId?: string): string[] | { message: string } {
    const history = getCheckpointHistoryForWorkspace(host.checkpointHistory, host.currentWorkspacePath);
    const chain = lineageCheckpoints(history, badId);
    if (!chain || chain.length === 0) {
        return { message: `No ancestor line for ${badId}` };
    }
    const ids = chain.map((checkpoint) => checkpoint.id);
    if (!goodId) {
        const branch = host.branches.find((item) => item.id === host.activeBranchId);
        goodId = branch?.baseCheckpointId && ids.includes(branch.baseCheckpointId)
            ? branch.baseCheckpointId
            : ids[0];
    }
    const goodIndex = ids.indexOf(goodId);
    if (goodIndex < 0) {
        return { message: `Good checkpoint ${goodId} is not an ancestor of ${badId}` };
    }
    return ids.slice(goodIndex + 1);
}

export async function bisectStart(host: CheckpointEngineHost, options: BisectOptions): Promise<BisectResult> {
    await host.whenReady();
    const remaining = rangeIds(host, options.bad, options.good);
    if (!Array.isArray(remaining)) {
        return { success: false, done: false, remaining: 0, steps: 0, message: remaining.message };
    }
    if (remaining.length === 0) {
        return { success: false, done: false, remaining: 0, steps: 0, message: 'Nothing to bisect between good and bad' };
    }
    let state: CheckpointBisectState = {
        badId: options.bad,
        goodId: options.good,
        remaining,
        current: pickCurrent(remaining),
        goodIds: options.good ? [options.good] : [],
        badIds: [options.bad],
        skippedIds: [],
        createdAt: new Date().toISOString(),
    };
    state = await checkoutCurrent(host, state);
    await saveBisectState(host, state);
    await host.appendAuditEvent({
        action: 'bisect',
        resourceId: state.current,
        outcome: 'success',
        details: { op: 'start', remaining: state.remaining.length },
    }).catch(() => false);
    log.info(`Bisect started; current ${state.current} (${state.remaining.length} remaining)`);
    return resultFrom(host, state, 0);
}

function applyVerdict(state: CheckpointBisectState, verdict: BisectVerdict): CheckpointBisectState {
    const current = state.current;
    if (!current) {
        return state;
    }
    const index = state.remaining.indexOf(current);
    if (verdict === 'skip') {
        const remaining = state.remaining.filter((id) => id !== current);
        return {
            ...state,
            remaining,
            skippedIds: [...state.skippedIds, current],
            current: pickCurrent(remaining),
        };
    }
    if (verdict === 'good') {
        const remaining = index >= 0 ? state.remaining.slice(index + 1) : state.remaining.filter((id) => id !== current);
        const next: CheckpointBisectState = {
            ...state,
            remaining,
            goodIds: [...state.goodIds, current],
            current: pickCurrent(remaining),
        };
        if (remaining.length === 0) {
            next.firstBadId = state.badIds[state.badIds.length - 1] ?? state.badId;
            next.current = next.firstBadId;
        } else if (remaining.length === 1) {
            next.firstBadId = remaining[0];
            next.current = remaining[0];
            next.remaining = [];
        }
        return next;
    }
    const remaining = index >= 0 ? state.remaining.slice(0, index + 1) : [current];
    const next: CheckpointBisectState = {
        ...state,
        remaining,
        badIds: [...state.badIds, current],
        current: pickCurrent(remaining),
    };
    if (remaining.length <= 1) {
        next.firstBadId = remaining[0] ?? current;
        next.current = next.firstBadId;
        next.remaining = [];
    }
    return next;
}

export async function bisectMark(host: CheckpointEngineHost, verdict: BisectVerdict): Promise<BisectResult> {
    await host.whenReady();
    const loaded = await loadBisectState(host);
    if (!loaded) {
        return { success: false, done: false, remaining: 0, steps: 0, message: 'No bisect in progress' };
    }
    if (loaded.firstBadId) {
        return resultFrom(host, loaded, 0);
    }
    let state = applyVerdict(loaded, verdict);
    if (state.current) {
        state = await checkoutCurrent(host, state);
    }
    await saveBisectState(host, state);
    await host.appendAuditEvent({
        action: 'bisect',
        resourceId: state.current,
        outcome: 'success',
        details: { op: verdict, firstBadId: state.firstBadId },
    }).catch(() => false);
    return resultFrom(host, state, 1);
}

export async function bisectReset(host: CheckpointEngineHost): Promise<{ success: boolean; message?: string }> {
    await host.whenReady();
    const state = await loadBisectState(host);
    if (state?.worktreeId) {
        await removeWorktree(host, state.worktreeId).catch(() => ({ success: false }));
    }
    await clearBisectState(host);
    await host.appendAuditEvent({
        action: 'bisect',
        outcome: 'success',
        details: { op: 'reset' },
    }).catch(() => false);
    return { success: true };
}

export async function bisectRun(
    host: CheckpointEngineHost,
    predicate: (checkpointId: string, worktreePath: string) => Promise<number>,
): Promise<BisectResult> {
    let state = await loadBisectState(host);
    if (!state) {
        return { success: false, done: false, remaining: 0, steps: 0, message: 'No bisect in progress' };
    }
    let steps = 0;
    while (!state.firstBadId && state.current && steps < 64) {
        const path = state.worktreePath;
        if (!path) {
            return { success: false, done: false, remaining: state.remaining.length, steps, message: 'Bisect worktree is missing' };
        }
        const code = await predicate(state.current, path);
        const verdict: BisectVerdict = code === 0 ? 'good' : code === 125 ? 'skip' : 'bad';
        const marked = await bisectMark(host, verdict);
        steps += 1;
        if (!marked.success) {
            return { ...marked, steps };
        }
        state = await loadBisectState(host) ?? state;
        if (state.firstBadId) {
            return resultFrom(host, state, steps);
        }
    }
    return resultFrom(host, state, steps);
}

export { listWorktrees };
