import * as vscode from 'vscode';

import { createKnoxLogger } from 'core/util/knoxLog';

import {
    appendAuditEvent as writeAuditEvent,
    listAuditTrail,
    type AuditEvent,
    type AuditEventInput,
} from '../store/auditLog';
import { summarizeObjectStore } from '../store/blobStore';
import type { CheckpointEngineHost } from './host';
import { computeDiskStorageBytes } from './persistence';

const log = createKnoxLogger('Checkpoints');

function currentUserId(): string {
    try {
        return vscode.env.machineId || 'unknown';
    } catch {
        return 'unknown';
    }
}

function measuredCounts(values: Record<string, number | undefined>): Record<string, number> | undefined {
    const counts: Record<string, number> = {};
    for (const [key, value] of Object.entries(values)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            counts[key] = value;
        }
    }
    return Object.keys(counts).length > 0 ? counts : undefined;
}

export async function appendAuditEvent(
    host: CheckpointEngineHost,
    event: AuditEventInput,
): Promise<boolean> {
    try {
        await writeAuditEvent(host.getStoragePath(), {
            ...event,
            userId: event.userId ?? currentUserId(),
        });
        return true;
    } catch (error) {
        log.debug('Failed to append checkpoint audit event:', error);
        return false;
    }
}

export async function recordRestorationEvent(
    host: CheckpointEngineHost,
    event: {
        timestamp: string;
        checkpointId: string;
        success: boolean;
        durationMs: number;
        filesRestored: number;
        filesFailed: number;
        error?: string;
    },
): Promise<boolean> {
    return appendAuditEvent(host, {
        timestamp: event.timestamp,
        action: 'restore',
        resourceId: event.checkpointId,
        outcome: event.success ? 'success' : 'failure',
        durationMs: event.durationMs,
        counts: measuredCounts({
            filesRestored: event.filesRestored,
            filesFailed: event.filesFailed,
        }),
        error: event.error,
    });
}

export async function recordAISessionMetrics(
    host: CheckpointEngineHost,
    metrics: {
        sessionId: string;
        startedAt: string;
        endedAt?: string;
        filesChanged: number;
        linesAdded?: number;
        linesDeleted?: number;
        checkpointsCreated: number;
        rollbacks?: number;
        durationSeconds: number;
    },
): Promise<boolean> {
    return appendAuditEvent(host, {
        action: 'ai_session',
        resourceId: metrics.sessionId,
        outcome: 'success',
        durationMs: Math.round(metrics.durationSeconds * 1000),
        counts: measuredCounts({
            filesChanged: metrics.filesChanged,
            checkpointsCreated: metrics.checkpointsCreated,
            linesAdded: metrics.linesAdded,
            linesDeleted: metrics.linesDeleted,
            rollbacks: metrics.rollbacks,
        }),
        details: {
            startedAt: metrics.startedAt,
            ...(metrics.endedAt ? { endedAt: metrics.endedAt } : {}),
        },
    });
}

export async function recordStorageSnapshot(host: CheckpointEngineHost): Promise<boolean> {
    try {
        const storageRoot = host.getStoragePath();
        const objects = await summarizeObjectStore(storageRoot);
        const totalBytes = await computeDiskStorageBytes(host);
        return appendAuditEvent(host, {
            action: 'storage_snapshot',
            outcome: 'success',
            counts: measuredCounts({
                totalBytes,
                checkpointDataBytes: objects.checkpointDataBytes,
                blobCount: objects.blobCount,
                checkpointCount: host.checkpointHistory.length,
            }),
        });
    } catch (error) {
        log.debug('Failed to record checkpoint storage snapshot:', error);
        return false;
    }
}

export async function getAuditTrail(
    host: CheckpointEngineHost,
    limit: number = 100,
    actionFilter?: string,
): Promise<AuditEvent[]> {
    try {
        return await listAuditTrail(host.getStoragePath(), limit, actionFilter);
    } catch (error) {
        log.debug('Failed to read checkpoint audit trail:', error);
        return [];
    }
}
