import * as fs from 'fs';

import * as vscode from 'vscode';

import { getCheckpointConfigPath } from 'core/util/paths';
import { createKnoxLogger } from 'core/util/knoxLog';

import {
    DEFAULT_MAX_CHECKPOINTS,
    DEFAULT_MAX_FILES_PER_CHECKPOINT,
    DEFAULT_MAX_STORAGE_BYTES,
    DEFAULT_RETENTION_DAYS,
    ENGINE_SETTING_KEYS,
} from '../checkpointSettings';
import { formatFileSize } from './format';
import type { CheckpointEngineHost } from './host';
import { cleanupOldCheckpoints } from './retention';
import { ensureEncryptionKeyIfEnabled } from './blobCrypto';

export {
    DEFAULT_MAX_CHECKPOINTS,
    DEFAULT_MAX_FILES_PER_CHECKPOINT,
    DEFAULT_MAX_STORAGE_BYTES,
    DEFAULT_RETENTION_DAYS,
};

const log = createKnoxLogger('Checkpoints');

export interface RuntimeCheckpointConfig {
    maxFileSizeBytes?: number;
    captureBinaryFiles?: boolean;
    enableCompression?: boolean;
    encryptAtRest?: boolean;
    trackedExtensions?: string[];
    maxCheckpoints?: number;
    maxStorageBytes?: number;
    maxFilesPerCheckpoint?: number;
    retentionDays?: number;
    autoCleanup?: boolean;
    cleanupIntervalHours?: number;
}

export function applyRuntimeConfig(host: CheckpointEngineHost, config: RuntimeCheckpointConfig): void {
    if (typeof config.maxFileSizeBytes === 'number' && config.maxFileSizeBytes >= 1024) {
        host.maxFileSize = config.maxFileSizeBytes;
    }
    if (typeof config.captureBinaryFiles === 'boolean') {
        host.captureBinaryFiles = config.captureBinaryFiles;
    }
    if (typeof config.enableCompression === 'boolean') {
        host.enableCompression = config.enableCompression;
    }
    if (typeof config.encryptAtRest === 'boolean') {
        host.encryptAtRest = config.encryptAtRest;
        if (host.encryptAtRest) {
            void ensureEncryptionKeyIfEnabled(host).catch((error) => {
                log.warn('⚠️ Failed to create checkpoint encryption key:', error);
            });
        }
    }
    if (Array.isArray(config.trackedExtensions)) {
        host.extraTrackedExtensions = new Set(
            config.trackedExtensions
                .map((ext) => String(ext).toLowerCase().replace(/^\.+/, ''))
                .filter(Boolean),
        );
    }
    if (typeof config.maxCheckpoints === 'number' && config.maxCheckpoints >= 1) {
        host.maxCheckpoints = Math.floor(config.maxCheckpoints);
    }
    if (typeof config.maxStorageBytes === 'number' && config.maxStorageBytes >= 1) {
        host.maxStorageBytes = Math.floor(config.maxStorageBytes);
    }
    if (typeof config.maxFilesPerCheckpoint === 'number' && config.maxFilesPerCheckpoint >= 1) {
        host.maxFilesPerCheckpoint = Math.floor(config.maxFilesPerCheckpoint);
    }
    if (typeof config.retentionDays === 'number' && config.retentionDays >= 1) {
        host.retentionDays = Math.floor(config.retentionDays);
    }
    if (typeof config.autoCleanup === 'boolean') {
        host.autoCleanupEnabled = config.autoCleanup;
    }
    if (typeof config.cleanupIntervalHours === 'number' && config.cleanupIntervalHours >= 1) {
        host.cleanupIntervalHours = Math.floor(config.cleanupIntervalHours);
    }
    scheduleAutoCleanup(host);
    log.info(`⚙️ Checkpoint runtime config: maxFileSize=${formatFileSize(host.maxFileSize)}, binaryCapture=${host.captureBinaryFiles}, compression=${host.enableCompression}, encryptAtRest=${host.encryptAtRest}, extraExtensions=${host.extraTrackedExtensions.size}, maxCheckpoints=${host.maxCheckpoints}, maxStorageBytes=${formatFileSize(host.maxStorageBytes)}, maxFilesPerCheckpoint=${host.maxFilesPerCheckpoint}, retentionDays=${host.retentionDays}, autoCleanup=${host.autoCleanupEnabled}`);
}

export function loadRuntimeConfiguration(host: CheckpointEngineHost): void {
    const merged: RuntimeCheckpointConfig = {};

    try {
        const configPath = getCheckpointConfigPath();
        if (fs.existsSync(configPath)) {
            Object.assign(merged, JSON.parse(fs.readFileSync(configPath, 'utf8')));
        }
    } catch (error) {
        log.warn('⚠️ Failed to read checkpoint config file:', error);
    }

    try {
        const settings = vscode.workspace.getConfiguration('knox.checkpoints');
        for (const key of ENGINE_SETTING_KEYS) {
            const value = settings.get(key);
            if (value !== undefined && value !== null) {
                (merged as any)[key] = value;
            }
        }
    } catch (error) {
        log.warn('⚠️ Failed to read checkpoint VSCode settings:', error);
    }

    applyRuntimeConfig(host, merged);
}

export function scheduleAutoCleanup(host: CheckpointEngineHost): void {
    if (host.cleanupTimer) {
        clearInterval(host.cleanupTimer);
        host.cleanupTimer = undefined;
    }

    if (!host.autoCleanupEnabled) {
        return;
    }

    const intervalMs = Math.max(1, host.cleanupIntervalHours) * 60 * 60 * 1000;
    host.cleanupTimer = setInterval(() => {
        void cleanupOldCheckpoints(host, host.retentionDays).catch((error) => {
            log.warn('⚠️ Scheduled checkpoint cleanup failed:', error);
        });
    }, intervalMs);

    host.cleanupTimer.unref?.();
}

export function registerCheckpointConfigurationWatcher(
    host: CheckpointEngineHost,
    context: vscode.ExtensionContext,
): void {
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (ENGINE_SETTING_KEYS.some((key) => event.affectsConfiguration(`knox.checkpoints.${key}`))) {
                loadRuntimeConfiguration(host);
            }
        }),
    );
}
