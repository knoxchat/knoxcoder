import * as vscode from 'vscode';

/**
 * Single list of checkpoint setting defaults.
 * Keep in sync with `extensions/vscode/package.json` contributes.configuration
 * and the GUI CheckpointConfig defaults.
 */

export const DEFAULT_MAX_CHECKPOINTS = 1000;
export const DEFAULT_MAX_STORAGE_BYTES = 1_000_000_000;
export const DEFAULT_MAX_FILES_PER_CHECKPOINT = 10_000;
export const DEFAULT_RETENTION_DAYS = 7;
export const DEFAULT_MAX_FILE_SIZE_BYTES = 5_242_880;
export const DEFAULT_CAPTURE_BINARY_FILES = true;
export const DEFAULT_ENABLE_COMPRESSION = true;
export const DEFAULT_ENCRYPT_AT_REST = false;
export const DEFAULT_ENABLE_AUTO_CHECKPOINTS = true;
export const DEFAULT_AUTO_CLEANUP = true;
export const DEFAULT_CLEANUP_INTERVAL_HOURS = 24;

export const DEFAULT_TRACKED_EXTENSIONS: string[] = [
    'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'cs',
    'go', 'rs', 'php', 'rb', 'swift', 'kt', 'html', 'css',
    'scss', 'json', 'yaml', 'yml', 'md', 'txt',
];

export const ENGINE_SETTING_KEYS = [
    'maxFileSizeBytes',
    'captureBinaryFiles',
    'enableCompression',
    'encryptAtRest',
    'trackedExtensions',
    'maxCheckpoints',
    'maxStorageBytes',
    'maxFilesPerCheckpoint',
    'retentionDays',
    'autoCleanup',
    'cleanupIntervalHours',
] as const;

export interface AutoCheckpointSettings {
    enabled: boolean;
    minIntervalMs: number;
    maxIntervalMs: number;
    fileChangeThreshold: number;
    checkpointAfterAI: boolean;
    checkpointBeforeRisky: boolean;
    maxUndoStack: number;
    showNotifications: boolean;
    debounceMs: number;
}

export const AUTO_CHECKPOINT_DEFAULTS: AutoCheckpointSettings = {
    enabled: true,
    minIntervalMs: 60_000,
    maxIntervalMs: 300_000,
    fileChangeThreshold: 5,
    checkpointAfterAI: true,
    checkpointBeforeRisky: true,
    maxUndoStack: 50,
    showNotifications: false,
    debounceMs: 3_000,
};

export interface SmartCheckpointSettings {
    enabled: boolean;
    agentModeOnly: boolean;
    maxTrackedFiles: number;
    maxMemoryUsageMB: number;
    maxCheckpoints: number;
    maxFileSizeKB: number;
    verboseLogging: boolean;
    enableMetrics: boolean;
}

export const SMART_CHECKPOINT_DEFAULTS: SmartCheckpointSettings = {
    enabled: true,
    agentModeOnly: true,
    maxTrackedFiles: 100,
    maxMemoryUsageMB: 50,
    maxCheckpoints: 50,
    maxFileSizeKB: 100,
    verboseLogging: false,
    enableMetrics: true,
};

export interface InlineDiffSettings {
    enabled: boolean;
    showLineDecorations: boolean;
    showGutterIcons: boolean;
    showHoverPreviews: boolean;
    showCodeLens: boolean;
    highlightWordChanges: boolean;
}

export const INLINE_DIFF_DEFAULTS: InlineDiffSettings = {
    enabled: false,
    showLineDecorations: true,
    showGutterIcons: true,
    showHoverPreviews: true,
    showCodeLens: true,
    highlightWordChanges: true,
};

export function readInlineDiffSettings(): InlineDiffSettings {
    const config = vscode.workspace.getConfiguration('knox.checkpoints.inlineDiff');
    return {
        enabled: config.get('enabled', INLINE_DIFF_DEFAULTS.enabled),
        showLineDecorations: config.get('showLineDecorations', INLINE_DIFF_DEFAULTS.showLineDecorations),
        showGutterIcons: config.get('showGutterIcons', INLINE_DIFF_DEFAULTS.showGutterIcons),
        showHoverPreviews: config.get('showHoverPreviews', INLINE_DIFF_DEFAULTS.showHoverPreviews),
        showCodeLens: config.get('showCodeLens', INLINE_DIFF_DEFAULTS.showCodeLens),
        highlightWordChanges: config.get('highlightWordChanges', INLINE_DIFF_DEFAULTS.highlightWordChanges),
    };
}

export function readAutoCheckpointSettings(): AutoCheckpointSettings {
    const config = vscode.workspace.getConfiguration('knox.checkpoints.auto');
    return {
        enabled: config.get('enabled', AUTO_CHECKPOINT_DEFAULTS.enabled),
        minIntervalMs: config.get('minIntervalMs', AUTO_CHECKPOINT_DEFAULTS.minIntervalMs),
        maxIntervalMs: config.get('maxIntervalMs', AUTO_CHECKPOINT_DEFAULTS.maxIntervalMs),
        fileChangeThreshold: config.get('fileChangeThreshold', AUTO_CHECKPOINT_DEFAULTS.fileChangeThreshold),
        checkpointAfterAI: config.get('checkpointAfterAI', AUTO_CHECKPOINT_DEFAULTS.checkpointAfterAI),
        checkpointBeforeRisky: config.get('checkpointBeforeRisky', AUTO_CHECKPOINT_DEFAULTS.checkpointBeforeRisky),
        maxUndoStack: config.get('maxUndoStack', AUTO_CHECKPOINT_DEFAULTS.maxUndoStack),
        showNotifications: config.get('showNotifications', AUTO_CHECKPOINT_DEFAULTS.showNotifications),
        debounceMs: config.get('debounceMs', AUTO_CHECKPOINT_DEFAULTS.debounceMs),
    };
}

export function readSmartCheckpointSettings(): SmartCheckpointSettings {
    const config = vscode.workspace.getConfiguration('knox.checkpoints.smart');
    return {
        enabled: config.get('enabled', SMART_CHECKPOINT_DEFAULTS.enabled),
        agentModeOnly: config.get('agentModeOnly', SMART_CHECKPOINT_DEFAULTS.agentModeOnly),
        maxTrackedFiles: config.get('maxTrackedFiles', SMART_CHECKPOINT_DEFAULTS.maxTrackedFiles),
        maxMemoryUsageMB: config.get('maxMemoryUsageMB', SMART_CHECKPOINT_DEFAULTS.maxMemoryUsageMB),
        maxCheckpoints: config.get('maxCheckpoints', SMART_CHECKPOINT_DEFAULTS.maxCheckpoints),
        maxFileSizeKB: config.get('maxFileSizeKB', SMART_CHECKPOINT_DEFAULTS.maxFileSizeKB),
        verboseLogging: config.get('verboseLogging', SMART_CHECKPOINT_DEFAULTS.verboseLogging),
        enableMetrics: config.get('enableMetrics', SMART_CHECKPOINT_DEFAULTS.enableMetrics),
    };
}

/** package.json default is true — do not fall back to false. */
export function isAiAutoCheckpointsEnabled(): boolean {
    try {
        return vscode.workspace.getConfiguration('knox.checkpoints').get(
            'enableAutoCheckpoints',
            DEFAULT_ENABLE_AUTO_CHECKPOINTS,
        ) === true;
    } catch {
        return DEFAULT_ENABLE_AUTO_CHECKPOINTS;
    }
}

export function defaultCheckpointConfig(): {
    maxCheckpoints: number;
    retentionDays: number;
    maxStorageBytes: number;
    maxFilesPerCheckpoint: number;
    maxFileSizeBytes: number;
    captureBinaryFiles: boolean;
    enableCompression: boolean;
    encryptAtRest: boolean;
    enableAutoCheckpoints: boolean;
    trackedExtensions: string[];
    autoCleanup: boolean;
    cleanupIntervalHours: number;
} {
    return {
        maxCheckpoints: DEFAULT_MAX_CHECKPOINTS,
        retentionDays: DEFAULT_RETENTION_DAYS,
        maxStorageBytes: DEFAULT_MAX_STORAGE_BYTES,
        maxFilesPerCheckpoint: DEFAULT_MAX_FILES_PER_CHECKPOINT,
        maxFileSizeBytes: DEFAULT_MAX_FILE_SIZE_BYTES,
        captureBinaryFiles: DEFAULT_CAPTURE_BINARY_FILES,
        enableCompression: DEFAULT_ENABLE_COMPRESSION,
        encryptAtRest: DEFAULT_ENCRYPT_AT_REST,
        enableAutoCheckpoints: DEFAULT_ENABLE_AUTO_CHECKPOINTS,
        trackedExtensions: [...DEFAULT_TRACKED_EXTENSIONS],
        autoCleanup: DEFAULT_AUTO_CLEANUP,
        cleanupIntervalHours: DEFAULT_CLEANUP_INTERVAL_HOURS,
    };
}
