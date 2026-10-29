import type { CheckpointLoadResult } from '../store/checkpointIntegrity';

export type CaptureMode = 'baseline' | 'delta';

export interface CheckpointHealthIssue {
    timestamp: string;
    kind: 'corrupt' | 'index_rebuild' | 'write_failed' | 'restore_incomplete' | 'quota_exceeded';
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
    /**
     * MC-61: what the user asked for in the turn that produced this checkpoint
     * (redacted, one line, capped). Optional; manifests written before it load unchanged.
     */
    intent?: string;
    /** MC-60: short summary of the turn ("Add JWT middleware · 3 files in src/auth"). Optional. */
    label?: string;
    /** Named checkpoint line this snapshot belongs to (CP-24). */
    branchId?: string;
    /** Previous checkpoint on this line; reconstruct walks these links (CP-24). */
    parentCheckpointId?: string;
    /**
     * Every parent, first parent first. `parentCheckpointId` stays the first
     * entry so lineage and replay keep walking one chain. A merge stores the
     * target head, then the source head. Absent on checkpoints saved before
     * that field existed.
     */
    parentCheckpointIds?: string[];
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
    /** Rename pairs recorded at capture (CP-40). Counted separately from created/deleted. */
    renamed?: number;
    copied?: number;
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
    /** Parent path when this snapshot is a rename of that file (CP-40). */
    renamedFrom?: string;
    /** Parent path when this snapshot is a copy of that file (CP-40). */
    copiedFrom?: string;
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
            ...(checkpoint.fileStats.renamed ? { renamed: checkpoint.fileStats.renamed } : {}),
            ...(checkpoint.fileStats.copied ? { copied: checkpoint.fileStats.copied } : {}),
        };
    }
    const snapshots = checkpoint.fileSnapshots ?? [];
    const renameSources = new Set(
        snapshots
            .map((snapshot) => snapshot.renamedFrom)
            .filter((path): path is string => typeof path === 'string' && path.length > 0),
    );
    const renamed = snapshots.filter((snapshot) => snapshot.renamedFrom && !snapshot.deleted).length;
    const copied = snapshots.filter((snapshot) => snapshot.copiedFrom && !snapshot.renamedFrom && !snapshot.deleted).length;
    const created = snapshots.filter((snapshot) =>
        snapshot.changeType === 'created' && !snapshot.renamedFrom && !snapshot.copiedFrom,
    ).length;
    const deleted = snapshots.filter((snapshot) =>
        (snapshot.deleted || snapshot.changeType === 'deleted')
        && !renameSources.has(snapshot.relativePath)
        && !renameSources.has(snapshot.relativePath.replace(/\\/g, '/')),
    ).length;
    const modified = snapshots.filter((snapshot) => {
        if (snapshot.deleted || snapshot.changeType === 'deleted') {
            return false;
        }
        if (snapshot.renamedFrom || snapshot.copiedFrom || snapshot.changeType === 'created') {
            return false;
        }
        return true;
    }).length;
    return {
        total: snapshots.length,
        created,
        deleted,
        modified,
        inventoryCount: checkpoint.fileInventory?.length ?? checkpoint.fileStats?.inventoryCount,
        ...(renamed > 0 ? { renamed } : {}),
        ...(copied > 0 ? { copied } : {}),
    };
}

export interface MessageCheckpointMap {
    [messageId: string]: string;
}

export interface CheckpointFileDiff {
    relativePath: string;
    status: 'added' | 'deleted' | 'modified' | 'renamed' | 'copied';
    /** Previous path when status is renamed or copied (CP-40). */
    oldPath?: string;
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

export interface FileHistoryOptions {
    /** Walk `renamedFrom` and hash-similarity (git log --follow). Default true. */
    follow?: boolean;
}

/** One current line attributed to the checkpoint that last introduced it (CP-44). */
export interface BlameLine {
    line: number;
    text: string;
    checkpointId?: string;
    label?: string;
    description?: string;
    originPath?: string;
}

export interface BlameRange {
    startLine: number;
    endLine: number;
    checkpointId?: string;
    label?: string;
    description?: string;
    originPath?: string;
}

export interface BlameOptions {
    atCheckpointId?: string;
}

export interface BlameResult {
    relativePath: string;
    atCheckpointId?: string;
    unsupported?: 'binary' | 'missing';
    lines: BlameLine[];
}

/** Isolated reconstructable tree (CP-45). */
export interface CheckpointWorktree {
    id: string;
    path: string;
    checkpointId: string;
    createdAt: string;
    bytes: number;
    fileCount: number;
}

export interface MaterializeWorktreeOptions {
    destDir?: string;
    allowInsideWorkspace?: boolean;
}

export type BisectVerdict = 'good' | 'bad' | 'skip';

export interface CheckpointBisectState {
    badId: string;
    goodId?: string;
    remaining: string[];
    current?: string;
    goodIds: string[];
    badIds: string[];
    skippedIds: string[];
    worktreeId?: string;
    worktreePath?: string;
    firstBadId?: string;
    createdAt: string;
}

export interface BisectOptions {
    bad: string;
    good?: string;
}

export interface BisectResult {
    success: boolean;
    done: boolean;
    currentId?: string;
    firstBadId?: string;
    remaining: number;
    steps: number;
    worktreePath?: string;
    message?: string;
    label?: string;
    intent?: string;
    changedPaths?: string[];
}

export interface MaterializeWorktreeResult {
    success: boolean;
    worktreeId?: string;
    path?: string;
    fileCount?: number;
    bytes?: number;
    skipped?: string[];
    message?: string;
}

export interface ManualCheckpointOptions {
    description?: string;
    /** MC-61: user intent to record on the manifest. */
    intent?: string;
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
    /** MC-63: recipes to ship in the bundle (already trimmed by `toBundleRecipe`). Their blobs are included. */
    recipes?: Array<{ steps: Array<{ blobHash?: string; baseBlobHash?: string }> }>;
}

export interface ShareCheckpointsOptions {
    checkpointIds?: string[];
    /** MC-63: see `ExportCheckpointsOptions.recipes`. */
    recipes?: ExportCheckpointsOptions['recipes'];
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
    /**
     * MC-63: called after a verified bundle's checkpoints and blobs are stored, with the bundle's
     * raw (untrusted) recipes and the hashes of its blobs. Failures do not fail the import.
     */
    onRecipes?: (recipes: unknown[], blobHashes: ReadonlySet<string>) => Promise<void>;
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

/** CP-39: `git switch` analog. `'none'` is pointer-only; `'hard'` restores the head. */
export type BranchCheckoutMode = 'none' | 'hard';

export interface SwitchBranchOptions {
    checkout?: BranchCheckoutMode;
    /** Override `knox.checkpoints.autoStashOnCheckout`. */
    autoStash?: boolean;
}

export interface SwitchBranchResult {
    success: boolean;
    checkout: BranchCheckoutMode;
    branchId?: string;
    headCheckpointId?: string;
    stashed?: boolean;
    stashId?: string;
    restoredFiles?: string[];
    removedFiles?: string[];
    detached?: boolean;
    refused?: 'dirty' | 'stash_failed' | 'restore_failed' | 'missing';
    message?: string;
}

export interface CheckoutCheckpointOptions {
    autoStash?: boolean;
}

export interface CheckoutCheckpointResult extends SwitchBranchResult {
    checkpointId?: string;
}

/** Durable detached HEAD (CP-39). Not a hidden branch. */
export interface DetachedCheckoutState {
    checkpointId: string;
    previousBranchId?: string;
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
    mergeInProgress?: boolean;
    message?: string;
}

export type CheckpointMergeOperation = 'merge' | 'cherry_pick' | 'revert';

/** In-progress merge / cherry-pick / revert (CP-43). */
export interface CheckpointMergeState {
    operation: CheckpointMergeOperation;
    sourceId: string;
    targetId: string;
    sourceHeadId?: string;
    targetHeadId: string;
    targetBranchId?: string;
    lcaId?: string;
    conflictPaths: string[];
    autoMergedPaths?: string[];
    autoMerged?: Array<{
        path: string;
        hash?: string;
        encoding: string;
        size: number;
        deleted?: boolean;
    }>;
    inventory?: string[];
    preMergeCheckpointId?: string;
    stashId?: string;
    sourceName?: string;
    targetName?: string;
    oursLabel?: string;
    theirsLabel?: string;
    description?: string;
    label?: string;
    intent?: string;
    tags?: string[];
    createdAt?: string;
}

export interface MergeContinueResult {
    success: boolean;
    checkpointId?: string;
    conflicts: Array<{ path: string }>;
    message?: string;
}

/** Lean stash stack row (CP-38). File bytes stay in the blob store. */
export interface CheckpointStashListItem {
    id: string;
    message?: string;
    createdAt: Date;
    baseCheckpointId?: string;
    branchId?: string;
    fileCount: number;
}

export interface StashPushResult {
    success: boolean;
    empty: boolean;
    stashId?: string;
    fileCount?: number;
    message?: string;
}

export interface StashApplyResult {
    success: boolean;
    empty?: boolean;
    stashId?: string;
    restoredFiles: string[];
    removedFiles: string[];
    conflicts: Array<{ path: string }>;
    message?: string;
}

/** CP-41: apply one checkpoint's parent→source delta onto HEAD. */
export interface CherryPickOptions {
    onto?: string;
}

export interface CherryPickResult {
    success: boolean;
    empty?: boolean;
    checkpointId?: string;
    sourceId?: string;
    ontoId?: string;
    restoredFiles: string[];
    removedFiles: string[];
    conflicts: Array<{ path: string }>;
    message?: string;
    mergeInProgress?: boolean;
}

/** CP-42: inverse of cherry-pick. `mainline` is git `-m` (1-based). */
export interface RevertOptions {
    onto?: string;
    mainline?: number;
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

/** CP-47 portable unified patch. */
export interface ExportPatchResult {
    success: boolean;
    patch?: string;
    checkpointId?: string;
    fileCount?: number;
    message?: string;
}

export interface ApplyPatchResult {
    success: boolean;
    checkpointId?: string;
    restoredFiles: string[];
    removedFiles: string[];
    conflicts: Array<{ path: string }>;
    message?: string;
}
