import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { writeFileAtomic } from './atomicWrite';

export const SESSIONS_FILENAME = 'sessions.json';
export const UNDO_STACK_FILENAME = 'undo-stack.json';
export const DURABLE_STATE_SCHEMA_VERSION = 1;

export interface PersistedSessionRecord {
    id: string;
    type: string;
    workspacePath: string;
    created: string;
    lastAccessed: string;
    metadata?: Record<string, unknown>;
}

export interface PersistedSessionMap {
    schemaVersion: number;
    sessions: PersistedSessionRecord[];
}

export interface PersistedUndoStack {
    schemaVersion: number;
    currentIndex: number;
    stack: string[];
    maxSize: number;
}

export function sessionsStatePath(storageRoot: string): string {
    return path.join(storageRoot, SESSIONS_FILENAME);
}

export function undoStackStatePath(storageRoot: string): string {
    return path.join(storageRoot, UNDO_STACK_FILENAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSessionRecord(value: unknown): PersistedSessionRecord | null {
    if (!isRecord(value)) {
        return null;
    }
    if (typeof value.id !== 'string' || !value.id.trim()) {
        return null;
    }
    if (typeof value.type !== 'string' || !value.type.trim()) {
        return null;
    }
    if (typeof value.workspacePath !== 'string' || !value.workspacePath.trim()) {
        return null;
    }
    if (typeof value.created !== 'string' || typeof value.lastAccessed !== 'string') {
        return null;
    }
    const metadata = isRecord(value.metadata) ? value.metadata : undefined;
    return {
        id: value.id,
        type: value.type,
        workspacePath: value.workspacePath,
        created: value.created,
        lastAccessed: value.lastAccessed,
        ...(metadata ? { metadata } : {}),
    };
}

export async function loadSessionMap(storageRoot: string): Promise<PersistedSessionRecord[]> {
    try {
        const raw = await fs.readFile(sessionsStatePath(storageRoot), 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (!isRecord(parsed) || !Array.isArray(parsed.sessions)) {
            return [];
        }
        return parsed.sessions
            .map(parseSessionRecord)
            .filter((session): session is PersistedSessionRecord => session !== null);
    } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
            return [];
        }
        return [];
    }
}

export async function saveSessionMap(
    storageRoot: string,
    sessions: PersistedSessionRecord[],
): Promise<void> {
    const payload: PersistedSessionMap = {
        schemaVersion: DURABLE_STATE_SCHEMA_VERSION,
        sessions,
    };
    await writeFileAtomic(sessionsStatePath(storageRoot), JSON.stringify(payload, null, 2), 'utf8');
}

export async function loadUndoStackState(storageRoot: string): Promise<PersistedUndoStack | null> {
    try {
        const raw = await fs.readFile(undoStackStatePath(storageRoot), 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (!isRecord(parsed) || !Array.isArray(parsed.stack)) {
            return null;
        }
        const stack = parsed.stack.filter((id): id is string => typeof id === 'string' && id.length > 0);
        const currentIndex = typeof parsed.currentIndex === 'number' && Number.isFinite(parsed.currentIndex)
            ? Math.max(-1, Math.min(Math.trunc(parsed.currentIndex), stack.length - 1))
            : stack.length - 1;
        const maxSize = typeof parsed.maxSize === 'number' && parsed.maxSize > 0
            ? Math.trunc(parsed.maxSize)
            : 50;
        return {
            schemaVersion: DURABLE_STATE_SCHEMA_VERSION,
            currentIndex,
            stack,
            maxSize,
        };
    } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
            return null;
        }
        return null;
    }
}

export async function saveUndoStackState(
    storageRoot: string,
    state: Pick<PersistedUndoStack, 'currentIndex' | 'stack' | 'maxSize'>,
): Promise<void> {
    const payload: PersistedUndoStack = {
        schemaVersion: DURABLE_STATE_SCHEMA_VERSION,
        currentIndex: state.currentIndex,
        stack: state.stack,
        maxSize: state.maxSize,
    };
    await writeFileAtomic(undoStackStatePath(storageRoot), JSON.stringify(payload, null, 2), 'utf8');
}
