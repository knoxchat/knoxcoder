import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { writeFileAtomic } from './atomicWrite';

export const AUDIT_LOG_FILENAME = 'events.jsonl';
export const AUDIT_LOG_MAX_EVENTS = 10_000;
export const AUDIT_LOG_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type AuditAction =
    | 'create'
    | 'restore'
    | 'delete'
    | 'import'
    | 'export'
    | 'share'
    | 'pin'
    | 'unpin'
    | 'ai_session'
    | 'storage_snapshot'
    | 'branch';

export type AuditOutcome = 'success' | 'failure';

export interface AuditEvent {
    timestamp: string;
    action: AuditAction;
    userId: string;
    resourceId?: string;
    outcome: AuditOutcome;
    durationMs?: number;
    counts?: Record<string, number>;
    error?: string;
    details?: Record<string, unknown>;
}

export type AuditEventInput = Omit<AuditEvent, 'timestamp' | 'userId' | 'outcome'> & {
    timestamp?: string;
    userId?: string;
    outcome: AuditOutcome;
};

export interface AuditLogLimits {
    maxEvents?: number;
    maxAgeMs?: number;
}

export function eventsLogPath(storageRoot: string): string {
    return path.join(storageRoot, AUDIT_LOG_FILENAME);
}

function isAuditAction(value: unknown): value is AuditAction {
    return (
        value === 'create' ||
        value === 'restore' ||
        value === 'delete' ||
        value === 'import' ||
        value === 'export' ||
        value === 'share' ||
        value === 'pin' ||
        value === 'unpin' ||
        value === 'ai_session' ||
        value === 'storage_snapshot' ||
        value === 'branch'
    );
}

function normalizeEvent(event: AuditEventInput): AuditEvent {
    const record: AuditEvent = {
        timestamp: event.timestamp ?? new Date().toISOString(),
        action: event.action,
        userId: event.userId || 'unknown',
        outcome: event.outcome,
    };
    if (event.resourceId) {
        record.resourceId = event.resourceId;
    }
    if (typeof event.durationMs === 'number' && Number.isFinite(event.durationMs)) {
        record.durationMs = event.durationMs;
    }
    if (event.counts && Object.keys(event.counts).length > 0) {
        record.counts = event.counts;
    }
    if (event.error) {
        record.error = event.error;
    }
    if (event.details && Object.keys(event.details).length > 0) {
        record.details = event.details;
    }
    return record;
}

export async function readAuditEvents(storageRoot: string): Promise<AuditEvent[]> {
    let raw: string;
    try {
        raw = await fs.readFile(eventsLogPath(storageRoot), 'utf8');
    } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }

    const events: AuditEvent[] = [];
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        try {
            const parsed = JSON.parse(trimmed) as Partial<AuditEvent>;
            if (
                parsed &&
                typeof parsed.timestamp === 'string' &&
                isAuditAction(parsed.action) &&
                (parsed.outcome === 'success' || parsed.outcome === 'failure')
            ) {
                events.push(parsed as AuditEvent);
            }
        } catch {
            // Skip a corrupt line rather than dropping the whole log.
        }
    }
    return events;
}

function serializeEvents(events: AuditEvent[]): string {
    if (events.length === 0) {
        return '';
    }
    return `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
}

export function rotateAuditEvents(
    events: AuditEvent[],
    limits: AuditLogLimits = {},
    nowMs: number = Date.now(),
): AuditEvent[] {
    const maxEvents = limits.maxEvents ?? AUDIT_LOG_MAX_EVENTS;
    const maxAgeMs = limits.maxAgeMs ?? AUDIT_LOG_MAX_AGE_MS;
    const cutoff = nowMs - maxAgeMs;
    const kept = events.filter((event) => {
        const ts = Date.parse(event.timestamp);
        return Number.isFinite(ts) ? ts >= cutoff : true;
    });
    if (kept.length > maxEvents) {
        return kept.slice(kept.length - maxEvents);
    }
    return kept;
}

async function maybeRotate(
    storageRoot: string,
    events: AuditEvent[],
    limits?: AuditLogLimits,
): Promise<AuditEvent[]> {
    const rotated = rotateAuditEvents(events, limits);
    if (rotated.length < events.length) {
        await writeFileAtomic(eventsLogPath(storageRoot), serializeEvents(rotated), 'utf8');
    }
    return rotated;
}

export async function appendAuditEvent(
    storageRoot: string,
    event: AuditEventInput,
    limits?: AuditLogLimits,
): Promise<AuditEvent> {
    const record = normalizeEvent(event);
    await fs.mkdir(storageRoot, { recursive: true });
    await fs.appendFile(eventsLogPath(storageRoot), `${JSON.stringify(record)}\n`, 'utf8');
    const events = await readAuditEvents(storageRoot);
    await maybeRotate(storageRoot, events, limits);
    return record;
}

export async function listAuditTrail(
    storageRoot: string,
    limit: number = 100,
    actionFilter?: string,
): Promise<AuditEvent[]> {
    const events = await readAuditEvents(storageRoot);
    const filtered = actionFilter
        ? events.filter((event) => event.action === actionFilter)
        : events;
    const cap = Math.max(0, limit);
    return filtered.slice(-cap).reverse();
}
