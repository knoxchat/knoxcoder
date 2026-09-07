/**
 * CheckpointManager facade. Implementation lives in sibling modules:
 *
 *   types.ts              public types
 *   capture.ts            baseline/delta snapshot + ignore
 *   workspaceScan.ts      ignore-pruned parallel walk (CP-11)
 *   restore.ts            reconstruct + apply (CP-06)
 *   persistence.ts        manifest/index I/O (CP-05, CP-07, CP-08)
 *   store/blobStore.ts    content-addressable objects + gzip (CP-07)
 *   store/blobEncryption.ts AES-GCM at rest (CP-28)
 *   retention.ts          fold / max-count / age cleanup (CP-09, CP-36)
 *   diff.ts               checkpoint↔checkpoint and vs-workspace diffs
 *   restorePreview.ts     dry-run restore vs live workspace (CP-18)
 *   fileHistory.ts        per-file hash timeline (CP-19)
 *   create.ts             message / manual / agent create
 *   watcher.ts            FileSystemWatcher (single owner; AutoCheckpoint subscribes, CP-31)
 *   config.ts             runtime settings
 *   fileClassification.ts text vs binary/encoding (CP-30)
 *   events.ts             audit recorders (CP-20)
 *   dashboard.ts          performance dashboard from events + blobs (CP-20)
 *   aiSessionMetrics.ts   AI session line/rollback counts (CP-35)
 *   store/auditLog.ts     append-only events.jsonl (CP-20)
 *   storeHealth.ts        manifest/blob/journal integrity (CP-21)
 *   bundleTransfer.ts     checksummed import/export bundles (CP-22)
 *   shareBundles.ts       local share files + audit list (CP-27)
 *   branches.ts           durable local branching (CP-24)
 *   analysis.ts           local risk/impact/grouping heuristics (CP-26)
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import * as vscode from 'vscode';

import { createKnoxLogger } from 'core/util/knoxLog';
import { t } from '../../i18n';
import { CheckpointConflictResolver } from '../ConflictResolver';
import { DEFAULT_CHECKPOINT_IGNORE_PATTERNS } from '../checkpointIgnore';
import { hasWorkspaceChanges } from './capture';
import {
    createBranch as createCheckpointBranch,
    deleteBranch as deleteCheckpointBranch,
    getActiveBranch,
    listBranches as listCheckpointBranches,
    mergeBranches as mergeCheckpointBranches,
    switchBranch as switchCheckpointBranch,
} from './branches';
import {
    analyzeCheckpoint as analyzeCheckpointRecord,
    suggestCheckpointGroups as suggestCheckpointGroupRecords,
} from './analysis';
import { applyRuntimeConfig, loadRuntimeConfiguration, registerCheckpointConfigurationWatcher } from './config';
import { createAgentCheckpoint as createBoundAgentCheckpoint, createCheckpointForMessage as createMessageCheckpoint, createIncrementalCheckpoint as createIncrementalCheckpointRecord, createManualCheckpoint as createManualCheckpointRecord } from './create';
import { computeCheckpointDiff, computeCheckpointDiffAgainstWorkspace } from './diff';
import { previewRestore as computeRestorePreview } from './restorePreview';
import { listFileCheckpointHistory as listFileVersions } from './fileHistory';
import { getPerformanceDashboard as buildPerformanceDashboard } from './dashboard';
import { inspectStoreHealth as inspectBoundStoreHealth, repairStoreHealth as repairBoundStoreHealth, type StoreRepairOptions } from './storeHealth';
import { appendAuditEvent as persistAuditEvent, getAuditTrail as readAuditTrail, recordAISessionMetrics as persistAISessionMetrics, recordRestorationEvent as persistRestorationEvent, recordStorageSnapshot as persistStorageSnapshot } from './events';
import { summarizeObjectStore } from '../store/blobStore';
import { formatFileSize } from './format';
import type { CheckpointEngineHost } from './host';
import {
    exportCheckpoints,
    importCheckpoints,
} from './bundleTransfer';
import {
    listSharedBundles as listLocalSharedBundles,
    shareCheckpoints as shareLocalCheckpoints,
} from './shareBundles';
import {
    getCheckpointStatistics,
    showCheckpointList,
} from './lifecycle';
import {
    computeDiskStorageBytes,
    deleteCheckpointFromDisk as deleteCheckpointRecord,
    loadCheckpointFromDisk as readHydratedCheckpoint,
    readCheckpointRecord as readLeanCheckpointRecord,
    loadCheckpointHistory,
    loadIndexFromCurrentStore,
    rebuildHistoryFromManifests as rebuildHistoryIndex,
    resolveCheckpointStoragePath,
    saveCheckpointHistory as writeCheckpointHistory,
} from './persistence';
import {
    cleanupOldCheckpoints,
    enforceRetentionPolicies,
    removeFromHistory,
    removeFromHistoryAndDisk,
    setCheckpointPinned,
} from './retention';
import {
    cleanupExtraFiles as cleanupExtraFilesFromInventory,
    cleanupFilesNotInInventory as cleanupMissingInventoryFiles,
    reconstructStateAtCheckpoint,
    recoverIncompleteRestore,
    restoreCheckpoint as applyCheckpointRestore,
    restoreCheckpointFiles as applyCheckpointFileRestore,
} from './restore';
import type {
    BranchMergeResult,
    CheckpointAnalysis,
    CheckpointBranch,
    CheckpointDiffResult,
    CheckpointHealthIssue,
    CheckpointInfo,
    CheckpointPerformanceMetrics,
    ExportCheckpointsOptions,
    ImportCheckpointsOptions,
    IncrementalCheckpointOptions,
    ManualCheckpointOptions,
    MessageCheckpointMap,
    RestoreCheckpointOptions,
    RestoreCheckpointResult,
    FileCheckpointVersion,
    RestoreFilesResult,
    RestorePreview,
    ShareCheckpointsOptions,
    SharedCheckpointBundle,
    SuggestedCheckpointGroup,
} from './types';
import { normalizeCapturePath, toPosixRelative } from './pathFilter';
import { disposeFileWatcher, initializeFileWatcher, type WorkspaceFileEvent } from './watcher';
import {
    checkpointWorkspaceFolders,
    getCheckpointHistoryForWorkspace as filterHistoryForWorkspace,
    workspacePathsEqual,
    workspaceStorageKey,
} from './workspace';

const log = createKnoxLogger('Checkpoints');
const checkpointOpContext = new AsyncLocalStorage<string>();

interface WorkspaceStoreSession {
    checkpointHistory: CheckpointInfo[];
    messageCheckpoints: MessageCheckpointMap;
    stableIdCheckpoints: { [stableId: string]: string };
    lastSnapshotHashes: Map<string, string>;
    lastCheckpointTime: number;
    previousCheckpointFiles: Set<string>;
    recentlyModifiedFiles: Set<string>;
    recentlyDeletedFiles: Set<string>;
    watcherTrusted: boolean;
    branches: CheckpointBranch[];
    activeBranchId: string | undefined;
}

export class CheckpointManager implements CheckpointEngineHost {
    private static instance: CheckpointManager | undefined;

    initialized = false;
    currentWorkspacePath: string | undefined;
    workspaceFolderPaths: string[] = [];
    messageCheckpoints: MessageCheckpointMap = {};
    stableIdCheckpoints: { [stableId: string]: string } = {};
    checkpointHistory: CheckpointInfo[] = [];
    branches: CheckpointBranch[] = [];
    activeBranchId: string | undefined;
    sessionStartTime: number = Date.now();
    lastCheckpointTime: number = Date.now();
    healthIssues: CheckpointHealthIssue[] = [];
    lastCheckpointLoad: import('../store/checkpointIntegrity').CheckpointLoadResult<CheckpointInfo> | null = null;
    recentlyModifiedFiles: Set<string> = new Set();
    recentlyDeletedFiles: Set<string> = new Set();
    previousCheckpointFiles: Set<string> = new Set();
    lastSnapshotHashes: Map<string, string> = new Map();
    trackedAIFiles: Set<string> = new Set();
    /** 0 = unlimited; ignore-based pruning instead of an arbitrary depth of 10. */
    maxScanDepth: number = 0;
    maxFileSize: number = 5242880;
    captureBinaryFiles: boolean = true;
    enableCompression: boolean = true;
    encryptAtRest: boolean = false;
    encryptionKeyProvider: import('../store/blobEncryption').CheckpointEncryptionKeyProvider | undefined;
    extraTrackedExtensions: Set<string> = new Set();
    maxCheckpoints: number = 1000;
    maxStorageBytes: number = 1_000_000_000;
    maxFilesPerCheckpoint: number = 10_000;
    retentionDays: number = 7;
    autoCleanupEnabled: boolean = true;
    cleanupIntervalHours: number = 24;
    cleanupTimer: NodeJS.Timeout | undefined;
    ignoreFilter: CheckpointEngineHost['ignoreFilter'] = null;
    ignoreFilterFailed = false;
    customIgnorePatterns: string[] = [...DEFAULT_CHECKPOINT_IGNORE_PATTERNS];
    extensionContext: vscode.ExtensionContext | undefined;
    performanceMetrics: CheckpointPerformanceMetrics = {
        lastScanDuration: 0,
        totalScans: 0,
        averageScanDuration: 0,
        filesScanned: 0,
        lastScanTimestamp: 0,
    };
    fileWatcher: vscode.FileSystemWatcher | undefined;
    fileWatchers: vscode.FileSystemWatcher[] = [];
    watcherDisposables: vscode.Disposable[] = [];
    watcherDebounceTimer: NodeJS.Timeout | undefined;
    watcherTrusted = false;
    lastFullScanAt = 0;

    private readonly _onCheckpointCreated: vscode.EventEmitter<string> = new vscode.EventEmitter<string>();
    public readonly onCheckpointCreated: vscode.Event<string> = this._onCheckpointCreated.event;
    private readonly _onActiveWorkspaceChanged: vscode.EventEmitter<string | undefined> = new vscode.EventEmitter<string | undefined>();
    public readonly onActiveWorkspaceChanged: vscode.Event<string | undefined> = this._onActiveWorkspaceChanged.event;
    private readonly _onWorkspaceFileEvent: vscode.EventEmitter<WorkspaceFileEvent> = new vscode.EventEmitter<WorkspaceFileEvent>();
    public readonly onWorkspaceFileEvent: vscode.Event<WorkspaceFileEvent> = this._onWorkspaceFileEvent.event;

    private boundAgentSessionId: string | null = null;
    private boundWorkspaceSessionId: string | null = null;
    private boundWorkspaceSessionType: string | null = null;
    private turnCheckpoints = new Map<string, string>();
    private workspaceSessions = new Map<string, WorkspaceStoreSession>();

    private constructor() {}

    static getInstance(): CheckpointManager {
        if (!CheckpointManager.instance) {
            CheckpointManager.instance = new CheckpointManager();
        }
        return CheckpointManager.instance;
    }

    fireCheckpointCreated(checkpointId: string): void {
        this._onCheckpointCreated.fire(checkpointId);
    }

    notifyWorkspaceFileEvent(event: WorkspaceFileEvent): void {
        this._onWorkspaceFileEvent.fire(event);
    }

    getBoundSessionId(): string | null {
        return this.boundAgentSessionId ?? this.boundWorkspaceSessionId;
    }

    bindWorkspaceSession(sessionId: string, type?: string): void {
        this.boundWorkspaceSessionId = sessionId;
        this.boundWorkspaceSessionType = type ?? null;
        log.debug(`Bound workspace session ${sessionId}${type ? ` (${type})` : ''}`);
    }

    clearWorkspaceSession(sessionId?: string): void {
        if (!sessionId || this.boundWorkspaceSessionId === sessionId) {
            this.boundWorkspaceSessionId = null;
            this.boundWorkspaceSessionType = null;
        }
    }

    getBoundWorkspaceSessionType(): string | null {
        return this.boundWorkspaceSessionType;
    }

    getStoragePath(): string {
        return resolveCheckpointStoragePath(this.currentWorkspacePath);
    }

    async loadCheckpointFromDisk(checkpointId: string) {
        return readHydratedCheckpoint(this, checkpointId);
    }

    async saveCheckpointHistory(): Promise<void> {
        return writeCheckpointHistory(this);
    }

    async deleteCheckpointFromDisk(checkpointId: string): Promise<void> {
        return deleteCheckpointRecord(this, checkpointId);
    }

    async rebuildHistoryFromManifests(): Promise<boolean> {
        return rebuildHistoryIndex(this);
    }

    async cleanupFilesNotInInventory(
        fileInventory: string[],
        removedFiles: string[],
        failedFiles: Array<{ path: string; error: string }>,
    ): Promise<void> {
        return cleanupMissingInventoryFiles(this, fileInventory, removedFiles, failedFiles);
    }

    async cleanupExtraFiles(
        checkpointFiles: import('./types').FileSnapshot[],
        removedFiles: string[],
        failedFiles: Array<{ path: string; error: string }>,
        options?: import('./types').RestoreCheckpointOptions,
    ): Promise<void> {
        return cleanupExtraFilesFromInventory(this, checkpointFiles, removedFiles, failedFiles, options);
    }

    async initialize(context: vscode.ExtensionContext): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            this.extensionContext = context;
            this.updateWorkspacePath();
            loadRuntimeConfiguration(this);
            registerCheckpointConfigurationWatcher(this, context);
            await loadCheckpointHistory(this, context);

            this.initialized = true;
            log.info('✅ Checkpoint system initialized successfully');
            await recoverIncompleteRestore(this);
            await enforceRetentionPolicies(this);

            context.subscriptions.push(
                vscode.workspace.onDidChangeWorkspaceFolders(() => {
                    this.updateWorkspacePath();
                }),
            );

            this.updateWorkspacePath();
        } catch (error) {
            log.error('❌ Failed to initialize checkpoint system:', error);
            vscode.window.showErrorMessage(t('checkpoint.failedInitSystem', { error }));
            this.initialized = false;
        }
    }

    public dispose(): void {
        disposeFileWatcher(this);
        this._onCheckpointCreated.dispose();
        this._onActiveWorkspaceChanged.dispose();
    }

    private snapshotCurrentSession(): WorkspaceStoreSession {
        return {
            checkpointHistory: this.checkpointHistory,
            messageCheckpoints: this.messageCheckpoints,
            stableIdCheckpoints: this.stableIdCheckpoints,
            lastSnapshotHashes: this.lastSnapshotHashes,
            lastCheckpointTime: this.lastCheckpointTime,
            previousCheckpointFiles: this.previousCheckpointFiles,
            recentlyModifiedFiles: this.recentlyModifiedFiles,
            recentlyDeletedFiles: this.recentlyDeletedFiles,
            watcherTrusted: this.watcherTrusted,
            branches: this.branches,
            activeBranchId: this.activeBranchId,
        };
    }

    private applySession(session: WorkspaceStoreSession): void {
        this.checkpointHistory = session.checkpointHistory;
        this.messageCheckpoints = session.messageCheckpoints;
        this.stableIdCheckpoints = session.stableIdCheckpoints;
        this.lastSnapshotHashes = session.lastSnapshotHashes;
        this.lastCheckpointTime = session.lastCheckpointTime;
        this.previousCheckpointFiles = session.previousCheckpointFiles;
        this.recentlyModifiedFiles = session.recentlyModifiedFiles;
        this.recentlyDeletedFiles = session.recentlyDeletedFiles;
        this.watcherTrusted = session.watcherTrusted;
        this.branches = session.branches;
        this.activeBranchId = session.activeBranchId;
    }

    private resetSessionState(): void {
        this.checkpointHistory = [];
        this.messageCheckpoints = {};
        this.stableIdCheckpoints = {};
        this.lastSnapshotHashes = new Map();
        this.lastCheckpointTime = Date.now();
        this.previousCheckpointFiles = new Set();
        this.recentlyModifiedFiles = new Set();
        this.recentlyDeletedFiles = new Set();
        this.watcherTrusted = false;
        this.lastFullScanAt = 0;
        this.ignoreFilter = null;
        this.ignoreFilterFailed = false;
        this.branches = [];
        this.activeBranchId = undefined;
    }

    private stashCurrentSession(): void {
        if (!this.currentWorkspacePath) {
            return;
        }
        this.workspaceSessions.set(workspaceStorageKey(this.currentWorkspacePath), this.snapshotCurrentSession());
    }

    async switchWorkspaceFolder(folderPath: string): Promise<void> {
        if (this.currentWorkspacePath && workspacePathsEqual(this.currentWorkspacePath, folderPath)) {
            return;
        }

        if (this.currentWorkspacePath) {
            this.stashCurrentSession();
            await this.saveCheckpointHistory();
        }

        this.currentWorkspacePath = folderPath;
        this.ignoreFilter = null;
        this.ignoreFilterFailed = false;

        const cached = this.workspaceSessions.get(workspaceStorageKey(folderPath));
        if (cached) {
            this.applySession(cached);
        } else {
            this.resetSessionState();
            if (this.extensionContext) {
                await loadCheckpointHistory(this, this.extensionContext);
            } else {
                await loadIndexFromCurrentStore(this);
            }
            this.stashCurrentSession();
        }

        log.debug(`📍 Active checkpoint workspace: ${folderPath}`);
        this._onActiveWorkspaceChanged.fire(folderPath);
    }

    recordFileChangeForFolder(folderPath: string, fsPath: string, deleted: boolean): void {
        if (this.currentWorkspacePath && workspacePathsEqual(this.currentWorkspacePath, folderPath)) {
            if (deleted) {
                this.recentlyModifiedFiles.delete(fsPath);
                this.recentlyDeletedFiles.add(fsPath);
            } else {
                this.recentlyModifiedFiles.add(fsPath);
            }
            return;
        }

        const key = workspaceStorageKey(folderPath);
        let session = this.workspaceSessions.get(key);
        if (!session) {
            session = {
                checkpointHistory: [],
                messageCheckpoints: {},
                stableIdCheckpoints: {},
                lastSnapshotHashes: new Map(),
                lastCheckpointTime: Date.now(),
                previousCheckpointFiles: new Set(),
                recentlyModifiedFiles: new Set(),
                recentlyDeletedFiles: new Set(),
                watcherTrusted: false,
                branches: [],
                activeBranchId: undefined,
            };
            this.workspaceSessions.set(key, session);
        }
        if (deleted) {
            session.recentlyModifiedFiles.delete(fsPath);
            session.recentlyDeletedFiles.add(fsPath);
        } else {
            session.recentlyModifiedFiles.add(fsPath);
        }
    }

    private async withAllWorkspaceFolders<T>(fn: () => Promise<T | undefined>): Promise<T | undefined> {
        const folders = checkpointWorkspaceFolders(this);
        if (folders.length <= 1) {
            return fn();
        }

        const active = this.currentWorkspacePath;
        let result: T | undefined;
        for (const folder of folders) {
            await this.switchWorkspaceFolder(folder);
            const value = await fn();
            if (!active || workspacePathsEqual(folder, active)) {
                result = value;
            } else if (result === undefined) {
                result = value;
            }
        }
        if (active) {
            await this.switchWorkspaceFolder(active);
        }
        return result;
    }

    private async getCheckpointAffectedFiles(
        checkpointId: string,
        includeFiles?: string[],
    ): Promise<string[]> {
        if (includeFiles?.length) {
            return includeFiles;
        }
        const info = this.getCheckpointInfo(checkpointId);
        if (info?.fileInventory?.length) {
            return info.fileInventory;
        }
        const fromDisk = await readLeanCheckpointRecord(this, checkpointId);
        if (fromDisk.status === 'ok') {
            if (fromDisk.checkpoint.fileInventory?.length) {
                return fromDisk.checkpoint.fileInventory;
            }
            return (fromDisk.checkpoint.fileSnapshots ?? [])
                .map((snapshot) => snapshot.relativePath)
                .filter(Boolean);
        }
        return (info?.fileSnapshots ?? [])
            .map((snapshot) => snapshot.relativePath)
            .filter(Boolean);
    }

    /**
     * Process-wide mutex for create/restore/delete/import. Nested calls in the
     * same async context (pre-restore backup) skip re-acquire. Overlapping
     * file sets wait; disjoint sets may run in parallel.
     */
    private async withConflictGuard<T>(
        operation: string,
        affectedFiles: string[],
        fn: () => Promise<T>,
        options?: {
            promptOnOverlap?: boolean;
            onDenied?: (message: string) => T;
        },
    ): Promise<T> {
        if (checkpointOpContext.getStore()) {
            return fn();
        }

        const resolver = CheckpointConflictResolver.getInstance();
        const lease = await resolver.acquire({
            operation,
            sessionId: this.boundAgentSessionId ?? 'workspace',
            affectedFiles,
            workspacePath: this.currentWorkspacePath,
            promptOnOverlap: options?.promptOnOverlap === true,
        });
        if (!lease.success) {
            if (options?.onDenied) {
                return options.onDenied(lease.message);
            }
            throw new Error(lease.message);
        }
        try {
            return await checkpointOpContext.run(lease.operationId, fn);
        } finally {
            await lease.release();
        }
    }

    getWorkspaceFolderPaths(): string[] {
        return checkpointWorkspaceFolders(this);
    }

    async hasWorkspaceChanges(): Promise<boolean> {
        const folders = checkpointWorkspaceFolders(this);
        if (folders.length <= 1) {
            return hasWorkspaceChanges(this);
        }
        const active = this.currentWorkspacePath;
        let found = false;
        for (const folder of folders) {
            await this.switchWorkspaceFolder(folder);
            if (await hasWorkspaceChanges(this)) {
                found = true;
                break;
            }
        }
        if (active) {
            await this.switchWorkspaceFolder(active);
        }
        return found;
    }

    private updateWorkspacePath(): void {
        const folders = vscode.workspace.workspaceFolders ?? [];
        this.workspaceFolderPaths = folders.map((folder) => folder.uri.fsPath);

        if (this.workspaceFolderPaths.length === 0) {
            this.currentWorkspacePath = undefined;
            this.ignoreFilter = null;
            this.ignoreFilterFailed = false;
            disposeFileWatcher(this);
            log.debug('📍 No workspace folder found');
            return;
        }

        const stillActive = this.currentWorkspacePath
            && this.workspaceFolderPaths.some((folder) => workspacePathsEqual(folder, this.currentWorkspacePath));
        if (!stillActive) {
            this.currentWorkspacePath = this.workspaceFolderPaths[0];
        }

        this.ignoreFilter = null;
        this.ignoreFilterFailed = false;
        log.debug(`📍 Workspace folders: ${this.workspaceFolderPaths.join(', ')}`);

        disposeFileWatcher(this);
        if (this.initialized) {
            void initializeFileWatcher(this);
            if (this.currentWorkspacePath) {
                void this.switchWorkspaceFolder(this.currentWorkspacePath).then(() => {
                    this._onActiveWorkspaceChanged.fire(this.currentWorkspacePath);
                });
            }
        }
    }

    public getCurrentStoragePath(): string {
        return this.getStoragePath();
    }

    public getPerformanceMetrics(): CheckpointPerformanceMetrics {
        return { ...this.performanceMetrics };
    }

    public setMaxScanDepth(depth: number): void {
        if (depth < 0) {
            throw new Error('Max scan depth must be 0 (unlimited) or greater');
        }
        this.maxScanDepth = depth;
        log.debug(`📏 Updated max scan depth to: ${depth === 0 ? 'unlimited' : depth}`);
    }

    public setMaxFileSize(sizeInBytes: number): void {
        if (sizeInBytes < 1024) {
            throw new Error('Max file size must be at least 1KB');
        }
        this.maxFileSize = sizeInBytes;
        log.debug(`📐 Updated max file size to: ${formatFileSize(sizeInBytes)}`);
    }

    public getConfiguration(): { maxScanDepth: number; maxFileSize: number; captureBinaryFiles: boolean } {
        return {
            maxScanDepth: this.maxScanDepth,
            maxFileSize: this.maxFileSize,
            captureBinaryFiles: this.captureBinaryFiles,
        };
    }

    public applyRuntimeConfig(config: Parameters<typeof applyRuntimeConfig>[1]): void {
        applyRuntimeConfig(this, config);
    }

    getHealthIssues(): CheckpointHealthIssue[] {
        return [...this.healthIssues];
    }

    async inspectStoreHealth() {
        return inspectBoundStoreHealth(this);
    }

    async repairStoreHealth(options?: StoreRepairOptions) {
        return repairBoundStoreHealth(this, options);
    }

    getLastCheckpointLoad() {
        return this.lastCheckpointLoad;
    }

    async createCheckpointForMessage(
        messageId: string,
        description?: string,
        stableId?: string,
        conversationContext?: any,
    ): Promise<string | undefined> {
        return this.withConflictGuard('create', [], () =>
            this.withAllWorkspaceFolders(() =>
                createMessageCheckpoint(this, messageId, description, stableId, conversationContext),
            ),
        );
    }

    async createManualCheckpoint(options?: ManualCheckpointOptions): Promise<string | undefined> {
        return this.withConflictGuard(
            'create',
            options?.includeFiles ?? [],
            () => this.withAllWorkspaceFolders(() => createManualCheckpointRecord(this, options)),
        );
    }

    async reconstructStateAtCheckpoint(checkpointId: string) {
        return reconstructStateAtCheckpoint(this, checkpointId);
    }

    async restoreCheckpoint(
        checkpointId: string,
        options?: RestoreCheckpointOptions,
    ): Promise<RestoreCheckpointResult> {
        await this.activateFolderForCheckpoint(checkpointId);
        const affectedFiles = await this.getCheckpointAffectedFiles(checkpointId, options?.includeFiles);
        return this.withConflictGuard(
            'restore',
            affectedFiles,
            () => applyCheckpointRestore(this, checkpointId, options),
            {
                promptOnOverlap: options?.conflictResolution === 'prompt',
                onDenied: () => ({
                    success: false,
                    restoredFiles: [],
                    failedFiles: [],
                    conflicts: [{ path: '*', type: 'concurrent' }],
                    removedFiles: [],
                }),
            },
        );
    }

    async listFileCheckpointHistory(relativePath: string): Promise<FileCheckpointVersion[]> {
        return listFileVersions(this, relativePath);
    }

    async restoreCheckpointFiles(
        checkpointId: string,
        relativePaths: string[],
    ): Promise<RestoreFilesResult> {
        await this.activateFolderForCheckpoint(checkpointId);
        return this.withConflictGuard(
            'restore',
            relativePaths,
            () => applyCheckpointFileRestore(this, checkpointId, relativePaths),
            {
                onDenied: (message) => ({
                    success: false,
                    restoredFiles: [],
                    failedFiles: [{ path: relativePaths.join(', '), error: message }],
                }),
            },
        );
    }

    private async activateFolderForCheckpoint(checkpointId: string): Promise<void> {
        const current = this.getCheckpointInfo(checkpointId);
        if (current?.workspacePath) {
            await this.switchWorkspaceFolder(current.workspacePath);
            return;
        }
        for (const session of this.workspaceSessions.values()) {
            const found = session.checkpointHistory.find((checkpoint) => checkpoint.id === checkpointId);
            if (found?.workspacePath) {
                await this.switchWorkspaceFolder(found.workspacePath);
                return;
            }
        }
    }

    async getCheckpointStatistics() {
        return getCheckpointStatistics(this);
    }

    async cleanupOldCheckpoints(retentionDays: number = 7): Promise<number> {
        return cleanupOldCheckpoints(this, retentionDays);
    }

    async exportCheckpoints(filePath: string, options?: ExportCheckpointsOptions): Promise<void> {
        return exportCheckpoints(this, filePath, options);
    }

    async importCheckpoints(
        filePath: string,
        mergeOrOptions: boolean | ImportCheckpointsOptions = true,
    ): Promise<number> {
        return this.withConflictGuard('import', [], () =>
            importCheckpoints(this, filePath, mergeOrOptions),
        );
    }

    async showCheckpointList(): Promise<void> {
        return showCheckpointList(this);
    }

    getCheckpointForMessage(messageId: string): string | undefined {
        return this.messageCheckpoints[messageId];
    }

    getCheckpointInfo(checkpointId: string): CheckpointInfo | undefined {
        return this.checkpointHistory.find((cp) => cp.id === checkpointId);
    }

    async getCheckpointWithSnapshots(checkpointId: string): Promise<CheckpointInfo | null> {
        const fromDisk = await this.loadCheckpointFromDisk(checkpointId);
        if (fromDisk) {
            return fromDisk;
        }
        if (this.lastCheckpointLoad?.status === 'corrupt') {
            return null;
        }
        return null;
    }

    async computeCheckpointDiff(
        checkpointId: string,
        compareToCheckpointId?: string,
    ): Promise<CheckpointDiffResult | null> {
        return computeCheckpointDiff(this, checkpointId, compareToCheckpointId);
    }

    async computeCheckpointDiffAgainstWorkspace(checkpointId: string): Promise<CheckpointDiffResult | null> {
        return computeCheckpointDiffAgainstWorkspace(this, checkpointId);
    }

    async previewRestore(checkpointId: string): Promise<RestorePreview | null> {
        return computeRestorePreview(this, checkpointId);
    }

    getCheckpointHistory(): CheckpointInfo[] {
        return [...this.checkpointHistory];
    }

    getCheckpointHistoryForWorkspace(workspacePath?: string): CheckpointInfo[] {
        return filterHistoryForWorkspace(
            this.checkpointHistory,
            workspacePath ?? this.currentWorkspacePath,
        );
    }

    public removeFromHistory(checkpointId: string): boolean {
        return removeFromHistory(this, checkpointId);
    }

    public async removeFromHistoryAndDisk(checkpointId: string): Promise<boolean> {
        const affectedFiles = await this.getCheckpointAffectedFiles(checkpointId);
        return this.withConflictGuard(
            'delete',
            affectedFiles,
            () => removeFromHistoryAndDisk(this, checkpointId),
            { onDenied: () => false },
        );
    }

    public async setCheckpointPinned(checkpointId: string, pinned: boolean): Promise<boolean> {
        return setCheckpointPinned(this, checkpointId, pinned);
    }

    public async enforceRetentionPolicies(): Promise<void> {
        return enforceRetentionPolicies(this);
    }

    isReady(): boolean {
        return this.initialized && !!this.currentWorkspacePath;
    }

    getCurrentWorkspacePath(): string | undefined {
        return this.currentWorkspacePath;
    }

    async startAgentSession(sessionId: string): Promise<void> {
        this.boundAgentSessionId = sessionId;
        log.info(`Starting agent session: ${sessionId}`);
    }

    async stopAgentSession(): Promise<void> {
        this.boundAgentSessionId = null;
        this.turnCheckpoints.clear();
        this.trackedAIFiles.clear();
        log.info('Stopped agent session');
    }

    getBoundAgentSessionId(): string | null {
        return this.boundAgentSessionId;
    }

    async ensureTurnCheckpoint(params: {
        sessionId: string;
        turnId: string;
        toolName: string;
    }): Promise<string | undefined> {
        const key = `${params.sessionId}:${params.turnId}`;
        const existing = this.turnCheckpoints.get(key);
        if (existing) {
            return existing;
        }
        if (!this.boundAgentSessionId) {
            this.boundAgentSessionId = params.sessionId;
        }
        const checkpointId = await this.createCheckpointForMessage(
            `soul-turn-${params.sessionId}-${params.turnId}`,
            `Agent turn before ${params.toolName}`,
            undefined,
            {
                role: 'agent-turn',
                messageContent: `Before ${params.toolName}`,
                timestamp: new Date().toISOString(),
                index: 0,
                sessionId: params.sessionId,
                allowEmpty: true,
            },
        );
        if (checkpointId) {
            this.turnCheckpoints.set(key, checkpointId);
        }
        return checkpointId;
    }

    async setOperationMode(mode: string): Promise<void> {
        log.info(`📝 Setting operation mode to: ${mode}`);
    }

    async trackAIFiles(filePaths: string[]): Promise<void> {
        const workspacePath = this.currentWorkspacePath;
        for (const filePath of filePaths) {
            const trimmed = filePath.trim();
            if (!trimmed) {
                continue;
            }
            const relative = workspacePath
                ? normalizeCapturePath(workspacePath, trimmed)
                : toPosixRelative(trimmed);
            if (relative && relative !== '.' && !relative.startsWith('../') && relative !== '..') {
                this.trackedAIFiles.add(relative);
            } else {
                this.trackedAIFiles.add(toPosixRelative(trimmed));
            }
        }
        log.info(`👀 Tracking ${this.trackedAIFiles.size} files for AI changes`);
    }

    clearTrackedAIFiles(): void {
        this.trackedAIFiles.clear();
    }

    async createAgentCheckpoint(options: {
        description?: string;
        tags?: string[];
        sessionId?: string;
        includeFiles?: string[];
        excludeFiles?: string[];
    }): Promise<string | undefined> {
        return this.withConflictGuard(
            'create',
            options.includeFiles ?? [],
            () => createBoundAgentCheckpoint(this, options, this.boundAgentSessionId),
        );
    }

    async hasAIChanges(): Promise<boolean> {
        return hasWorkspaceChanges(this);
    }

    async getChangesetStats(): Promise<{
        files_tracked: number;
        changes_detected: number;
        memory_usage_bytes?: number;
        last_scan_duration_ms?: number;
        mode: string;
        session_id?: string;
        tracked_files?: string[];
    }> {
        const tracked = [...this.trackedAIFiles];
        return {
            files_tracked: tracked.length,
            changes_detected: this.recentlyModifiedFiles.size + this.recentlyDeletedFiles.size,
            mode: this.boundAgentSessionId
                ? 'agent'
                : (this.initialized ? 'workspace' : 'fallback'),
            session_id: this.boundAgentSessionId ?? undefined,
            tracked_files: tracked,
        };
    }

    getCheckpointForStableId(stableId: string): string | undefined {
        return this.stableIdCheckpoints[stableId];
    }

    async createIncrementalCheckpoint(options?: IncrementalCheckpointOptions): Promise<string | undefined> {
        return this.withConflictGuard(
            'create',
            options?.includeFiles ?? [],
            () => this.withAllWorkspaceFolders(() =>
                createIncrementalCheckpointRecord(this, options, this.boundAgentSessionId),
            ),
        );
    }

    async reconstructCheckpoint(checkpointId: string): Promise<any> {
        const state = await this.reconstructStateAtCheckpoint(checkpointId);
        if (!state) {
            return null;
        }
        return {
            checkpointId,
            files: Array.from(state.entries()).map(([relativePath, resolved]) => ({
                relativePath,
                encoding: resolved.encoding,
                size: resolved.content.length,
            })),
        };
    }

    async createBranch(name: string, baseCheckpointId: string, description: string = ''): Promise<CheckpointBranch | null> {
        return this.withConflictGuard(
            'branch',
            [],
            () => createCheckpointBranch(this, name, baseCheckpointId, description),
        );
    }

    async listBranches(): Promise<CheckpointBranch[]> {
        return listCheckpointBranches(this);
    }

    getActiveBranch(): CheckpointBranch | undefined {
        return getActiveBranch(this);
    }

    async switchBranch(branchId: string): Promise<boolean> {
        return this.withConflictGuard(
            'branch',
            [],
            () => switchCheckpointBranch(this, branchId),
        );
    }

    async deleteBranch(branchId: string): Promise<boolean> {
        return this.withConflictGuard(
            'branch',
            [],
            () => deleteCheckpointBranch(this, branchId),
        );
    }

    async mergeBranches(
        sourceBranchId: string,
        targetBranchId: string,
        strategy: string = 'ThreeWay',
    ): Promise<BranchMergeResult> {
        return this.withConflictGuard(
            'merge',
            [],
            () => mergeCheckpointBranches(this, sourceBranchId, targetBranchId, strategy),
        );
    }

    async analyzeCheckpoint(checkpointId: string): Promise<CheckpointAnalysis | null> {
        return analyzeCheckpointRecord(this, checkpointId);
    }

    async suggestCheckpointGroups(limit: number = 50): Promise<SuggestedCheckpointGroup[]> {
        return suggestCheckpointGroupRecords(this, limit);
    }

    async shareCheckpoints(
        filePath: string,
        options?: ShareCheckpointsOptions,
    ): Promise<SharedCheckpointBundle> {
        return this.withConflictGuard('export', [], () =>
            shareLocalCheckpoints(this, filePath, options),
        );
    }

    async listSharedBundles(): Promise<SharedCheckpointBundle[]> {
        return listLocalSharedBundles(this);
    }

    async getAuditTrail(limit: number = 100, actionFilter?: string) {
        return readAuditTrail(this, limit, actionFilter);
    }

    async getPerformanceDashboard(historyDays: number = 30) {
        return buildPerformanceDashboard(this, historyDays);
    }

    async getStorageUsage(): Promise<{
        totalBytes: number;
        checkpointDataBytes: number;
        blobCount: number;
        checkpointCount: number;
        storagePath: string;
    }> {
        const [totalBytes, objects] = await Promise.all([
            computeDiskStorageBytes(this),
            summarizeObjectStore(this.getStoragePath()),
        ]);
        return {
            totalBytes,
            checkpointDataBytes: objects.checkpointDataBytes,
            blobCount: objects.blobCount,
            checkpointCount: this.checkpointHistory.length,
            storagePath: this.getStoragePath(),
        };
    }

    async appendAuditEvent(event: Parameters<typeof persistAuditEvent>[1]): Promise<boolean> {
        return persistAuditEvent(this, event);
    }

    async recordStorageSnapshot(): Promise<boolean> {
        return persistStorageSnapshot(this);
    }

    async recordRestorationEvent(event: Parameters<typeof persistRestorationEvent>[1]): Promise<boolean> {
        return persistRestorationEvent(this, event);
    }

    async recordAISessionMetrics(metrics: Parameters<typeof persistAISessionMetrics>[1]): Promise<boolean> {
        return persistAISessionMetrics(this, metrics);
    }
}
