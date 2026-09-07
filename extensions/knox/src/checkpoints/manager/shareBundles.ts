import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { createKnoxLogger } from 'core/util/knoxLog';

import { attachBundleHmac, defaultBundleHmacKeyPath } from '../store/bundleHmac';
import { exportCheckpoints } from './bundleTransfer';
import { getAuditTrail } from './events';
import type { CheckpointEngineHost } from './host';
import type { ShareCheckpointsOptions, SharedCheckpointBundle } from './types';

const log = createKnoxLogger('Checkpoints');

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

function resolveShareIds(host: CheckpointEngineHost, requested?: string[]): string[] {
    if (requested && requested.length > 0) {
        return [...new Set(requested)];
    }
    return host.checkpointHistory.map((checkpoint) => checkpoint.id);
}

export async function shareCheckpoints(
    host: CheckpointEngineHost,
    filePath: string,
    options?: ShareCheckpointsOptions,
): Promise<SharedCheckpointBundle> {
    const checkpointIds = resolveShareIds(host, options?.checkpointIds);
    const description = options?.description?.trim()
        || `Shared ${checkpointIds.length} checkpoint${checkpointIds.length === 1 ? '' : 's'}`;
    const hmacKeyPath = options?.hmacKeyPath ?? defaultBundleHmacKeyPath();
    const startedAt = Date.now();
    const bundleId = `bundle_${randomUUID()}`;

    try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await exportCheckpoints(host, filePath, { checkpointIds });
        const hmac = await attachBundleHmac(filePath, hmacKeyPath);
        const sharedAt = new Date().toISOString();
        await host.appendAuditEvent({
            action: 'share',
            resourceId: filePath,
            outcome: 'success',
            durationMs: Date.now() - startedAt,
            counts: { checkpoints: checkpointIds.length },
            details: {
                bundleId,
                description,
                checkpointIds,
                filePath,
                hmacSha256: hmac.hmacSha256,
                hmacKeyId: hmac.hmacKeyId,
            },
        }).catch(() => false);

        log.info(`📤 Shared ${checkpointIds.length} checkpoints to ${filePath}`);

        const trail = await getAuditTrail(host, 1, 'share');
        return {
            id: bundleId,
            description,
            sharedAt: trail[0]?.timestamp ?? sharedAt,
            checkpointCount: checkpointIds.length,
            checkpointIds,
            filePath,
            sharedBy: trail[0]?.userId ?? 'unknown',
            machineId: trail[0]?.userId ?? 'unknown',
            hmacSha256: hmac.hmacSha256,
            hmacKeyId: hmac.hmacKeyId,
            exists: true,
        };
    } catch (error) {
        await host.appendAuditEvent({
            action: 'share',
            resourceId: filePath,
            outcome: 'failure',
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
            details: {
                bundleId,
                description,
                checkpointIds,
                filePath,
            },
        }).catch(() => false);
        throw error;
    }
}

export async function listSharedBundles(host: CheckpointEngineHost): Promise<SharedCheckpointBundle[]> {
    const events = await getAuditTrail(host, 500, 'share');
    const bundles: SharedCheckpointBundle[] = [];
    const seen = new Set<string>();

    for (const event of events) {
        if (event.outcome !== 'success') {
            continue;
        }
        const details = event.details ?? {};
        const filePath = typeof details.filePath === 'string' && details.filePath
            ? details.filePath
            : (event.resourceId ?? '');
        if (!filePath) {
            continue;
        }
        const bundleId = typeof details.bundleId === 'string' && details.bundleId
            ? details.bundleId
            : `${event.timestamp}:${filePath}`;
        if (seen.has(bundleId)) {
            continue;
        }
        seen.add(bundleId);

        const checkpointIds = asStringArray(details.checkpointIds);
        const checkpointCount = typeof event.counts?.checkpoints === 'number'
            ? event.counts.checkpoints
            : checkpointIds.length;
        bundles.push({
            id: bundleId,
            description: typeof details.description === 'string' && details.description
                ? details.description
                : path.basename(filePath),
            sharedAt: event.timestamp,
            checkpointCount,
            checkpointIds,
            filePath,
            sharedBy: event.userId,
            machineId: event.userId,
            hmacSha256: typeof details.hmacSha256 === 'string' ? details.hmacSha256 : undefined,
            hmacKeyId: typeof details.hmacKeyId === 'string' ? details.hmacKeyId : undefined,
            exists: await fileExists(filePath),
        });
    }

    return bundles;
}

export function auditEventToPanelRecord(
    event: {
        timestamp: string;
        action: string;
        userId: string;
        resourceId?: string;
        outcome: string;
        details?: Record<string, unknown>;
        error?: string;
    },
    index: number,
): {
    id: string;
    timestamp: string;
    userId: string;
    machineId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    outcome: string;
    details: string;
} {
    const resourceId = event.resourceId ?? '';
    const resourceType = event.action === 'share' || event.action === 'export' || event.action === 'import'
        ? 'checkpoint_bundle'
        : 'checkpoint';
    const details = event.error
        ? JSON.stringify({ ...(event.details ?? {}), error: event.error })
        : JSON.stringify(event.details ?? {});
    return {
        id: `${event.timestamp}:${event.action}:${resourceId}:${index}`,
        timestamp: event.timestamp,
        userId: event.userId,
        machineId: event.userId,
        action: event.action,
        resourceType,
        resourceId,
        outcome: event.outcome === 'success' ? 'Success' : event.outcome === 'failure' ? 'Failure' : event.outcome,
        details,
    };
}
