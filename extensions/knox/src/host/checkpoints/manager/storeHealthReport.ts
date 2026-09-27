export interface StoreHealthReport {
    corruptManifests: Array<{ checkpointId: string; reason: string }>;
    missingBlobs: Array<{ checkpointId: string; hash: string }>;
    manifestsWithoutBlobs: Array<{ checkpointId: string; missingBlobCount: number }>;
    orphanBlobCount: number;
    orphanBlobBytes: number;
    indexNeedsRebuild: boolean;
    incompleteJournal: boolean;
    journalCheckpointId?: string;
    validManifestCount: number;
}

export function emptyStoreHealthReport(): StoreHealthReport {
    return {
        corruptManifests: [],
        missingBlobs: [],
        manifestsWithoutBlobs: [],
        orphanBlobCount: 0,
        orphanBlobBytes: 0,
        indexNeedsRebuild: false,
        incompleteJournal: false,
        validManifestCount: 0,
    };
}

export function storeHealthIsAutoFixable(report: StoreHealthReport): boolean {
    const canGcOrphans = report.orphanBlobCount > 0 && report.corruptManifests.length === 0;
    return report.incompleteJournal || report.indexNeedsRebuild || canGcOrphans;
}

export interface StoreRepairCounts {
    journalRecovered: boolean;
    indexRebuilt: boolean;
    blobsDeleted: number;
}

/** GC succeeded when there was nothing to collect, or remaining orphans are blocked by corrupt manifests. */
export function gcOrphansSucceeded(
    before: StoreHealthReport,
    result: StoreRepairCounts,
    after: StoreHealthReport,
): boolean {
    if (before.orphanBlobCount === 0) {
        return true;
    }
    if (after.orphanBlobCount === 0) {
        return result.blobsDeleted > 0;
    }
    return result.blobsDeleted > 0
        && after.orphanBlobCount < before.orphanBlobCount
        && after.corruptManifests.length > 0;
}

/** Full repair succeeded when nothing auto-fixable remains. */
export function repairAllSucceeded(after: StoreHealthReport): boolean {
    return !storeHealthIsAutoFixable(after);
}

export function storeHealthSeverity(report: StoreHealthReport): 'healthy' | 'warning' | 'critical' {
    if (report.incompleteJournal || report.manifestsWithoutBlobs.length > 0) {
        return 'critical';
    }
    if (report.corruptManifests.length > 0) {
        return report.validManifestCount === 0 ? 'critical' : 'warning';
    }
    if (report.missingBlobs.length > 0 || report.indexNeedsRebuild || report.orphanBlobCount > 0) {
        return 'warning';
    }
    return 'healthy';
}
