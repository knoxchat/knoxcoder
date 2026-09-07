import type { CheckpointLoadResult } from '../store/checkpointIntegrity';

export type CaptureMode = 'baseline' | 'delta';

export interface CheckpointHealthIssue {
    timestamp: string;
    kind: 'corrupt' | 'index_rebuild' | 'write_failed' | 'restore_incomplete';
    message: string;
    checkpointId?: string;
}

export interface SkippedFile {
    path: string;
    reason: 'too_large' | 'unreadable' | 'binary_disabled' | 'unsafe_path';
}

export interface CaptureResult {
    fileSnapshots: FileSnapshot[];
    skippedFiles: SkippedFile[];
    captureMode: CaptureMode;
    /** Reconstructable tracked paths at capture time (excludes skipped/too-large). */
    fileInventory: string[];
}

export interface CheckpointInfo {
    id: string;
    description: string;
    created: Date;
    messageId?: string;
    stableId?: string;
    workspacePath?: string;
    /** Stable hash of the canonical workspace path (CP-10). */
    workspaceKey?: string;
    fileSnapshots?: FileSnapshot[];
    fileInventory?: string[];
    captureMode?: CaptureMode;
    skippedFiles?: SkippedFile[];
    schemaVersion?: number;
    contentSha256?: string;
    fileStats?: CheckpointFileStats;
    /** Retention skip: pinned checkpoints are never evicted by count/age/quota. */
    pinned?: boolean;
    /** User/agent labels stored on the manifest and lean index (CP-13). */
    tags?: string[];
    /**
     * Relative paths captured in this checkpoint (capped). Used for GUI/host
     * search without sending file contents (CP-32).
     */
    changedPaths?: string[];
    /**
     * Bound chat/agent/manual session for grouping after reload (CP-31).
     * Kept off conversationContext so manual checkpoints are not classified as AI.
     */
    sessionId?: string;
    /** Named checkpoint line this snapshot belongs to (CP-24). */
    branchId?: string;
    /** Previous checkpoint on this line; reconstruct walks these links (CP-24). */
    parentCheckpointId?: string;
    conversationContext?: {
        messageContent: string;
        role: string;
        timestamp: string;
        index: number;
        sessionId?: string;
        allowEmpty?: boolean;
    };
}

export interface CheckpointFileStats {
    total: number;
    created: number;
    deleted: number;
    modified: number;
    inventoryCount?: number;
}

export interface FileSnapshot {
    relativePath: string;
    /** In-memory / hydrated content for diffs. Omitted from on-disk manifests (CP-07). */
    content?: string;
    /** SHA-256 of raw file bytes in the blob store. */
    hash?: string;
    /** Restore/diff hint: utf8, utf16le, utf16be, or base64 for binary. Storage is raw blobs. */
    encoding: string;
    lastModified: Date;
    size: number;
    deleted?: boolean;
    changeType?: 'created' | 'modified' | 'deleted';
}

/**
 * File count shown in lists / the agent tool.
 * Prefer the complete inventory (reconstructable tree) over the delta
 * snapshot array, which only records files that changed in that checkpoint.
 */
export function listedCheckpointFileCount(
    checkpoint: Pick<CheckpointInfo, 'fileInventory' | 'fileSnapshots' | 'fileStats'>,
): number {
    if (Array.isArray(checkpoint.fileInventory)) {
        return checkpoint.fileInventory.length;
    }
    if (typeof checkpoint.fileStats?.inventoryCount === 'number') {
        return checkpoint.fileStats.inventoryCount;
    }
    return (checkpoint.fileSnapshots ?? []).filter((snapshot) => !snapshot.deleted).length;
}

export function computeCheckpointFileStats(
    checkpoint: Pick<CheckpointInfo, 'fileSnapshots' | 'fileInventory' | 'fileStats'>,
): CheckpointFileStats {
    if (checkpoint.fileStats && !(checkpoint.fileSnapshots && checkpoint.fileSnapshots.length > 0)) {
        return {
            total: checkpoint.fileStats.total,
            created: checkpoint.fileStats.created,
            deleted: checkpoint.fileStats.deleted,
            modified: checkpoint.fileStats.modified,
            inventoryCount: checkpoint.fileInventory?.length ?? checkpoint.fileStats.inventoryCount,
        };
    }
    const snapshots = checkpoint.fileSnapshots ?? [];
    const created = snapshots.filter((snapshot) => snapshot.changeType === 'created').length;
    const deleted = snapshots.filter((snapshot) => snapshot.deleted || snapshot.changeType === 'deleted').length;
    return {
        total: snapshots.length,
        created,
        deleted,
        modified: Math.max(0, snapshots.length - created - deleted),
        inventoryCount: checkpoint.fileInventory?.length ?? checkpoint.fileStats?.inventoryCount,
    };
}

export interface MessageCheckpointMap {
    [messageId: string]: string;
}

export interface CheckpointFileDiff {
    relativePath: string;
    status: 'added' | 'deleted' | 'modified';
    oldContent: string | null;
    newContent: string | null;
    oldEncoding?: string;
    newEncoding?: string;
}

export interface CheckpointDiffResult {
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
    files: CheckpointFileDiff[];
}

/** Restore-oriented dry-run of what applying a checkpoint would change. */
export type RestorePreviewAction = 'overwrite' | 'create' | 'delete';

export interface RestorePreviewFile {
    relativePath: string;
    action: RestorePreviewAction;
    additions: number;
    deletions: number;
    hunkCount: number;
}

export interface RestorePreview {
    checkpointId: string;
    description: string;
    modified: number;
    added: number;
    deleted: number;
    files: RestorePreviewFile[];
    /** Paths restore would write (overwrite + create). */
    writePaths: string[];
    /** Workspace files not in the checkpoint (full restore may delete). */
    extraPaths: string[];
    skippedFiles: Array<{ path: string; reason: string }>;
}

export interface CheckpointPerformanceMetrics {
    lastScanDuration: number;
    totalScans: number;
    averageScanDuration: number;
    filesScanned: number;
    lastScanTimestamp: number;
}

export interface RestoreCheckpointOptions {
    createBackup?: boolean;
    conflictResolution?: 'skip' | 'overwrite' | 'backup' | 'prompt';
    includeFiles?: string[];
    excludeFiles?: string[];
    cleanupExtraFiles?: boolean;
    /** Skip journal + nested backup (used for crash recovery rollback). */
    skipJournal?: boolean;
}

export interface RestoreCheckpointResult {
    success: boolean;
    restoredFiles: string[];
    failedFiles: Array<{ path: string; error: string }>;
    conflicts: Array<{ path: string; type: string }>;
    removedFiles: string[];
}

export interface RestoreFilesResult {
    success: boolean;
    restoredFiles: string[];
    failedFiles: Array<{ path: string; error: string }>;
}

/** One unique content version of a single file across checkpoint history (CP-19). */
export interface FileCheckpointVersion {
    checkpointId: string;
    description: string;
    created: Date;
    relativePath: string;
    hash?: string;
    deleted: boolean;
    size?: number;
    encoding?: string;
}

export interface ManualCheckpointOptions {
    description?: string;
    tags?: string[];
    includeFiles?: string[];
    excludeFiles?: string[];
    allowEmpty?: boolean;
    forceBaseline?: boolean;
    /** Prefer a delta manifest even when no baseline exists yet (incremental). */
    forceDelta?: boolean;
}

export interface AgentCheckpointOptions {
    description?: string;
    tags?: string[];
    sessionId?: string;
    includeFiles?: string[];
    excludeFiles?: string[];
}

export interface IncrementalCheckpointOptions {
    description?: string;
    tags?: string[];
    includeFiles?: string[];
    excludeFiles?: string[];
}

export interface ExportCheckpointsOptions {
    checkpointIds?: string[];
}

export interface ShareCheckpointsOptions {
    checkpointIds?: string[];
    description?: string;
    hmacKeyPath?: string;
}

export interface SharedCheckpointBundle {
    id: string;
    description: string;
    sharedAt: string;
    checkpointCount: number;
    checkpointIds: string[];
    filePath: string;
    /** Local machine id — not a remote user. */
    sharedBy: string;
    machineId: string;
    hmacSha256?: string;
    hmacKeyId?: string;
    exists: boolean;
}

export interface ImportCheckpointsOptions {
    merge?: boolean;
    /** Always allocate new checkpoint ids (also used automatically on merge collisions). */
    remapIds?: boolean;
    /** Import a bundle that was exported from a different workspace path. */
    allowWorkspaceMismatch?: boolean;
    /** Override the local HMAC key path (tests). */
    hmacKeyPath?: string;
}

export type CheckpointLoadOutcome = CheckpointLoadResult<CheckpointInfo>;

/** Durable local branch pointer (CP-24). Not git. */
export interface CheckpointBranch {
    id: string;
    name: string;
    headCheckpointId: string;
    /** Immutable fork point on the parent line. */
    baseCheckpointId: string;
    parentBranchId?: string;
    createdAt: Date;
    description?: string;
}

export interface FileHashState {
    hash?: string;
    encoding: string;
    size: number;
    deleted?: boolean;
}

export interface BranchMergeConflict {
    path: string;
    baseHash?: string;
    sourceHash?: string;
    targetHash?: string;
}

export interface BranchMergeResult {
    success: boolean;
    unavailable?: boolean;
    mergeCheckpointId?: string;
    conflicts: BranchMergeConflict[];
}

export type CheckpointRiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';
export type CheckpointImpactScope = 'Isolated' | 'Module' | 'CrossModule' | 'SystemWide';
export type CheckpointGroupKind = 'session' | 'time' | 'path';

export interface CheckpointRiskFactor {
    category: string;
    description: string;
    weight: number;
    affectedFiles: string[];
}

export interface CheckpointRiskAssessment {
    level: CheckpointRiskLevel;
    score: number;
    factors: CheckpointRiskFactor[];
    recommendations: string[];
}

export interface CheckpointAffectedFeature {
    name: string;
    impactLevel: 'Low' | 'Medium' | 'High';
    changedFiles: string[];
}

export interface CheckpointImpactAnalysis {
    affectedFeatures: CheckpointAffectedFeature[];
    affectedLayers: string[];
    scope: CheckpointImpactScope;
    uniqueDirectories: number;
    testFilesChanged: boolean;
    linesAdded: number;
    linesDeleted: number;
}

export interface SuggestedCheckpointGroup {
    id: string;
    kind: CheckpointGroupKind;
    groupName: string;
    rationale: string;
    confidence: number;
    checkpointIds: string[];
}

/** Local heuristic analysis (CP-26). Not an LLM summary. */
export interface CheckpointAnalysis {
    checkpointId: string;
    generatedDescription: string;
    riskAssessment: CheckpointRiskAssessment;
    impactAnalysis: CheckpointImpactAnalysis;
    groupingSuggestion?: SuggestedCheckpointGroup;
    counts: {
        changed: number;
        created: number;
        deleted: number;
        modified: number;
        binary: number;
        config: number;
        lockfile: number;
        tests: number;
    };
}
