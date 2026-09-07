import type * as vscode from 'vscode';

import type { IgnoreLike } from '../checkpointIgnore';
import type { CheckpointEncryptionKeyProvider } from '../store/blobEncryption';
import type { AuditEventInput } from '../store/auditLog';
import type { CheckpointLoadResult } from '../store/checkpointIntegrity';
import type {
    CheckpointBranch,
    CheckpointHealthIssue,
    CheckpointInfo,
    CheckpointPerformanceMetrics,
    FileSnapshot,
    ManualCheckpointOptions,
    MessageCheckpointMap,
    RestoreCheckpointOptions,
} from './types';

export interface CheckpointIgnoreFilter extends IgnoreLike {
    add(patterns: string | readonly string[]): this;
}

/**
 * Mutable engine state shared by capture / restore / persistence modules.
 * Not a public API — CheckpointManager is the facade callers use.
 */
export interface CheckpointEngineHost {
    initialized: boolean;
    currentWorkspacePath: string | undefined;
    workspaceFolderPaths: string[];
    messageCheckpoints: MessageCheckpointMap;
    stableIdCheckpoints: { [stableId: string]: string };
    checkpointHistory: CheckpointInfo[];
    /** Named restore lines persisted in the workspace index (CP-24). */
    branches: CheckpointBranch[];
    activeBranchId: string | undefined;
    sessionStartTime: number;
    lastCheckpointTime: number;
    healthIssues: CheckpointHealthIssue[];
    lastCheckpointLoad: CheckpointLoadResult<CheckpointInfo> | null;
    recentlyModifiedFiles: Set<string>;
    recentlyDeletedFiles: Set<string>;
    previousCheckpointFiles: Set<string>;
    lastSnapshotHashes: Map<string, string>;
    /**
     * Paths the agent asked to track (CP-13). Agent/incremental captures restrict
     * to these plus watcher hits when the set is non-empty.
     */
    trackedAIFiles: Set<string>;
    /** 0 = unlimited (ignore-based pruning). Positive values are a user safety cap. */
    maxScanDepth: number;
    maxFileSize: number;
    captureBinaryFiles: boolean;
    enableCompression: boolean;
    encryptAtRest: boolean;
    encryptionKeyProvider: CheckpointEncryptionKeyProvider | undefined;
    extraTrackedExtensions: Set<string>;
    maxCheckpoints: number;
    maxStorageBytes: number;
    maxFilesPerCheckpoint: number;
    retentionDays: number;
    autoCleanupEnabled: boolean;
    cleanupIntervalHours: number;
    cleanupTimer: NodeJS.Timeout | undefined;
    ignoreFilter: CheckpointIgnoreFilter | null;
    ignoreFilterFailed: boolean;
    customIgnorePatterns: string[];
    extensionContext: vscode.ExtensionContext | undefined;
    performanceMetrics: CheckpointPerformanceMetrics;
    fileWatcher: vscode.FileSystemWatcher | undefined;
    fileWatchers: vscode.FileSystemWatcher[];
    watcherDisposables: vscode.Disposable[];
    watcherDebounceTimer: NodeJS.Timeout | undefined;
    /**
     * True after a complete walk while watchers are active. Delta capture can
     * then use watcher events + the hash index instead of a full mtime scan.
     */
    watcherTrusted: boolean;
    lastFullScanAt: number;
    recordFileChangeForFolder(folderPath: string, fsPath: string, deleted: boolean): void;
    fireCheckpointCreated(checkpointId: string): void;
    notifyWorkspaceFileEvent(event: {
        uri: vscode.Uri;
        kind: 'modified' | 'created' | 'deleted';
        folderPath: string;
    }): void;
    getBoundSessionId(): string | null;
    getStoragePath(): string;
    loadCheckpointFromDisk(checkpointId: string): Promise<CheckpointInfo | null>;
    saveCheckpointHistory(): Promise<void>;
    deleteCheckpointFromDisk(checkpointId: string): Promise<void>;
    rebuildHistoryFromManifests(): Promise<boolean>;
    createManualCheckpoint(options?: ManualCheckpointOptions): Promise<string | undefined>;
    cleanupFilesNotInInventory(
        fileInventory: string[],
        removedFiles: string[],
        failedFiles: Array<{ path: string; error: string }>,
    ): Promise<void>;
    cleanupExtraFiles(
        checkpointFiles: FileSnapshot[],
        removedFiles: string[],
        failedFiles: Array<{ path: string; error: string }>,
        options?: RestoreCheckpointOptions,
    ): Promise<void>;
    appendAuditEvent(event: AuditEventInput): Promise<boolean>;
    recordStorageSnapshot(): Promise<boolean>;
    recordRestorationEvent(event: {
        timestamp: string;
        checkpointId: string;
        success: boolean;
        durationMs: number;
        filesRestored: number;
        filesFailed: number;
        error?: string;
    }): Promise<boolean>;
}
