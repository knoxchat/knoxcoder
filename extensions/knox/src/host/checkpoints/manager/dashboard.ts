import { emptyRecipeMetrics, summarizeRecipeMetrics, type RecipeMetricsSummary } from 'core/context/memory/recipes/metrics';
import { createKnoxLogger } from 'core/util/knoxLog';

import { readAuditEvents, type AuditEvent } from '../store/auditLog';
import { summarizeObjectStore } from '../store/blobStore';
import type { CheckpointEngineHost } from './host';
import { computeDiskStorageBytes } from './persistence';

const log = createKnoxLogger('Checkpoints');

export interface StorageUsageSnapshot {
    timestamp: string;
    totalBytes: number;
    checkpointDataBytes: number;
    blobCount: number;
    checkpointCount: number;
}

export interface CreationFrequencyPoint {
    bucket: string;
    count: number;
}

export interface RestorationEvent {
    timestamp: string;
    checkpointId: string;
    success: boolean;
    durationMs: number;
    filesRestored: number;
    filesFailed: number;
    error?: string;
}

export interface AISessionMetric {
    sessionId: string;
    startedAt: string;
    endedAt?: string;
    filesChanged: number;
    linesAdded?: number;
    linesDeleted?: number;
    checkpointsCreated: number;
    rollbacks?: number;
    durationSeconds: number;
}

export interface DashboardSummary {
    totalCheckpointsCreated: number;
    totalRestorations: number;
    restorationSuccessRate: number;
    avgCreationTimeMs: number;
    avgRestorationTimeMs: number;
    totalAiSessions: number;
    avgChangesPerSession: number;
    totalRollbacks: number;
}

export interface PerformanceDashboardData {
    currentStorage: StorageUsageSnapshot;
    storageHistory: StorageUsageSnapshot[];
    creationFrequency: CreationFrequencyPoint[];
    restorationEvents: RestorationEvent[];
    aiSessionMetrics: AISessionMetric[];
    /** Replay results of verified recipes (MC-71). All zero when recipes are off. */
    recipeMetrics: RecipeMetricsSummary;
    summary: DashboardSummary;
}

async function withRecipeInspectorCounts(summary: RecipeMetricsSummary): Promise<RecipeMetricsSummary> {
    try {
        const [{ RecipeStore }, { get: getBrainDb }] = await Promise.all([
            import("core/context/memory/recipes/RecipeStore"),
            import("core/context/memory/brain/store/connection"),
        ]);
        const recipes = await new RecipeStore(await getBrainDb()).list({ limit: 1000 });
        const live = recipes.filter((recipe) => recipe.status !== "retired");
        summary.projectCount = live.filter((recipe) => recipe.scope === "project").length;
        summary.globalCount = live.filter((recipe) => recipe.scope === "global").length;
    } catch {
        // Brain DB is optional for the checkpoint dashboard.
    }
    return summary;
}

function average(values: number[]): number {
    if (values.length === 0) {
        return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dayBucket(iso: string): string {
    const parsed = Date.parse(iso);
    if (!Number.isFinite(parsed)) {
        return iso;
    }
    return `${new Date(parsed).toISOString().slice(0, 10)}T00:00:00.000Z`;
}

function restorationFromEvent(event: AuditEvent): RestorationEvent {
    return {
        timestamp: event.timestamp,
        checkpointId: event.resourceId ?? '',
        success: event.outcome === 'success',
        durationMs: event.durationMs ?? 0,
        filesRestored: event.counts?.filesRestored ?? 0,
        filesFailed: event.counts?.filesFailed ?? 0,
        error: event.error,
    };
}

function storageSnapshotFromEvent(event: AuditEvent): StorageUsageSnapshot {
    return {
        timestamp: event.timestamp,
        totalBytes: event.counts?.totalBytes ?? 0,
        checkpointDataBytes: event.counts?.checkpointDataBytes ?? 0,
        blobCount: event.counts?.blobCount ?? 0,
        checkpointCount: event.counts?.checkpointCount ?? 0,
    };
}

function aiSessionFromEvent(event: AuditEvent): AISessionMetric {
    const details = event.details ?? {};
    const startedAt = typeof details.startedAt === 'string' ? details.startedAt : event.timestamp;
    const endedAt = typeof details.endedAt === 'string' ? details.endedAt : undefined;
    return {
        sessionId: event.resourceId ?? '',
        startedAt,
        endedAt,
        filesChanged: event.counts?.filesChanged ?? 0,
        linesAdded: event.counts?.linesAdded,
        linesDeleted: event.counts?.linesDeleted,
        checkpointsCreated: event.counts?.checkpointsCreated ?? 0,
        rollbacks: event.counts?.rollbacks,
        durationSeconds: event.durationMs != null ? event.durationMs / 1000 : 0,
    };
}

function creationFrequency(events: AuditEvent[]): CreationFrequencyPoint[] {
    const buckets = new Map<string, number>();
    for (const event of events) {
        const bucket = dayBucket(event.timestamp);
        buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    }
    return [...buckets.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([bucket, count]) => ({ bucket, count }));
}

export function emptyPerformanceDashboard(now: Date = new Date()): PerformanceDashboardData {
    return {
        currentStorage: {
            timestamp: now.toISOString(),
            totalBytes: 0,
            checkpointDataBytes: 0,
            blobCount: 0,
            checkpointCount: 0,
        },
        storageHistory: [],
        creationFrequency: [],
        restorationEvents: [],
        aiSessionMetrics: [],
        recipeMetrics: emptyRecipeMetrics(),
        summary: {
            totalCheckpointsCreated: 0,
            totalRestorations: 0,
            restorationSuccessRate: 100,
            avgCreationTimeMs: 0,
            avgRestorationTimeMs: 0,
            totalAiSessions: 0,
            avgChangesPerSession: 0,
            totalRollbacks: 0,
        },
    };
}

export async function getPerformanceDashboard(
    host: CheckpointEngineHost,
    historyDays: number = 30,
): Promise<PerformanceDashboardData> {
    const now = new Date();
    const dashboard = emptyPerformanceDashboard(now);
    const days = Number.isFinite(historyDays) && historyDays > 0 ? historyDays : 30;
    const since = now.getTime() - days * 24 * 60 * 60 * 1000;

    try {
        const storageRoot = host.getStoragePath();
        const [events, objects, totalBytes] = await Promise.all([
            readAuditEvents(storageRoot),
            summarizeObjectStore(storageRoot),
            computeDiskStorageBytes(host),
        ]);
        const windowed = events.filter((event) => {
            const ts = Date.parse(event.timestamp);
            return Number.isFinite(ts) ? ts >= since : true;
        });

        const creates = windowed.filter((event) => event.action === 'create' && event.outcome === 'success');
        const restores = windowed.filter((event) => event.action === 'restore').map(restorationFromEvent);
        const snapshots = windowed
            .filter((event) => event.action === 'storage_snapshot')
            .map(storageSnapshotFromEvent);
        const aiSessions = windowed
            .filter((event) => event.action === 'ai_session')
            .map(aiSessionFromEvent)
            .reverse();

        const successfulRestores = restores.filter((event) => event.success).length;
        const createDurations = creates
            .map((event) => event.durationMs)
            .filter((value): value is number => typeof value === 'number');
        const restoreDurations = restores
            .map((event) => event.durationMs)
            .filter((value) => typeof value === 'number');

        dashboard.currentStorage = {
            timestamp: now.toISOString(),
            totalBytes,
            checkpointDataBytes: objects.checkpointDataBytes,
            blobCount: objects.blobCount,
            checkpointCount: host.checkpointHistory.length,
        };
        dashboard.storageHistory = snapshots;
        dashboard.creationFrequency = creationFrequency(creates);
        dashboard.restorationEvents = [...restores].reverse();
        dashboard.aiSessionMetrics = aiSessions;
        dashboard.recipeMetrics = await withRecipeInspectorCounts(summarizeRecipeMetrics(windowed));
        dashboard.summary = {
            totalCheckpointsCreated: creates.length,
            totalRestorations: restores.length,
            restorationSuccessRate: restores.length === 0
                ? 100
                : (successfulRestores / restores.length) * 100,
            avgCreationTimeMs: average(createDurations),
            avgRestorationTimeMs: average(restoreDurations),
            totalAiSessions: aiSessions.length,
            avgChangesPerSession: average(aiSessions.map((session) => session.filesChanged)),
            totalRollbacks: aiSessions.reduce((sum, session) => sum + (session.rollbacks ?? 0), 0),
        };
        return dashboard;
    } catch (error) {
        log.debug('Failed to build checkpoint performance dashboard:', error);
        dashboard.currentStorage.checkpointCount = host.checkpointHistory.length;
        return dashboard;
    }
}
