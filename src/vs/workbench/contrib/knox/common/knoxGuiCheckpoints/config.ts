/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Checkpoint store / auto-capture settings. */

export interface IKnoxGuiCheckpointConfig {
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
	autoEnabled: boolean;
	autoMinIntervalMs: number;
	autoFileChangeThreshold: number;
	autoShowNotifications: boolean;
}

export const DEFAULT_CHECKPOINT_CONFIG: IKnoxGuiCheckpointConfig = {
	maxCheckpoints: 1000,
	retentionDays: 7,
	maxStorageBytes: 1_000_000_000,
	maxFilesPerCheckpoint: 10_000,
	maxFileSizeBytes: 5_242_880,
	captureBinaryFiles: true,
	enableCompression: true,
	encryptAtRest: false,
	enableAutoCheckpoints: true,
	trackedExtensions: ['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'cs', 'go', 'rs', 'php', 'rb', 'swift', 'kt', 'html', 'css', 'scss', 'json', 'yaml', 'yml', 'md', 'txt'],
	autoCleanup: true,
	cleanupIntervalHours: 24,
	autoEnabled: true,
	autoMinIntervalMs: 60_000,
	autoFileChangeThreshold: 5,
	autoShowNotifications: false,
};

export const CHECKPOINT_CLEANUP_INTERVALS = [
	{ value: 1, key: 'hourly' },
	{ value: 6, key: 'every6Hours' },
	{ value: 12, key: 'every12Hours' },
	{ value: 24, key: 'daily' },
	{ value: 72, key: 'every3Days' },
	{ value: 168, key: 'weekly' },
] as const;

const STORAGE_UNITS: Record<string, number> = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };

export function parseStorageBytes(value: string): number | null {
	const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/i);
	if (!match) {
		return null;
	}
	const size = Number(match[1]);
	const unit = (match[2]?.toUpperCase() ?? 'B');
	if (!Number.isFinite(size) || size <= 0 || !STORAGE_UNITS[unit]) {
		return null;
	}
	return Math.round(size * STORAGE_UNITS[unit]);
}

export function formatCheckpointBytes(bytes: number): string {
	const units = ['B', 'KB', 'MB', 'GB'];
	let size = bytes;
	let unitIndex = 0;
	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex += 1;
	}
	return `${size.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`;
}

export function parseTrackedExtensions(value: string): string[] {
	return Array.from(new Set(value.split(',').map(ext => ext.trim().replace(/^\.+/, '').toLowerCase()).filter(Boolean)));
}

function toNumber(value: unknown, fallback: number): number {
	const numberValue = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(numberValue) ? numberValue : fallback;
}

export function normalizeCheckpointConfig(value: Partial<IKnoxGuiCheckpointConfig> | null | undefined): IKnoxGuiCheckpointConfig {
	return {
		maxCheckpoints: toNumber(value?.maxCheckpoints, DEFAULT_CHECKPOINT_CONFIG.maxCheckpoints),
		retentionDays: toNumber(value?.retentionDays, DEFAULT_CHECKPOINT_CONFIG.retentionDays),
		maxStorageBytes: toNumber(value?.maxStorageBytes, DEFAULT_CHECKPOINT_CONFIG.maxStorageBytes),
		maxFilesPerCheckpoint: toNumber(value?.maxFilesPerCheckpoint, DEFAULT_CHECKPOINT_CONFIG.maxFilesPerCheckpoint),
		maxFileSizeBytes: toNumber(value?.maxFileSizeBytes, DEFAULT_CHECKPOINT_CONFIG.maxFileSizeBytes),
		captureBinaryFiles: typeof value?.captureBinaryFiles === 'boolean' ? value.captureBinaryFiles : DEFAULT_CHECKPOINT_CONFIG.captureBinaryFiles,
		enableCompression: typeof value?.enableCompression === 'boolean' ? value.enableCompression : DEFAULT_CHECKPOINT_CONFIG.enableCompression,
		encryptAtRest: typeof value?.encryptAtRest === 'boolean' ? value.encryptAtRest : DEFAULT_CHECKPOINT_CONFIG.encryptAtRest,
		enableAutoCheckpoints: typeof value?.enableAutoCheckpoints === 'boolean' ? value.enableAutoCheckpoints : DEFAULT_CHECKPOINT_CONFIG.enableAutoCheckpoints,
		trackedExtensions: Array.isArray(value?.trackedExtensions) ? value.trackedExtensions.map(String) : DEFAULT_CHECKPOINT_CONFIG.trackedExtensions,
		autoCleanup: typeof value?.autoCleanup === 'boolean' ? value.autoCleanup : DEFAULT_CHECKPOINT_CONFIG.autoCleanup,
		cleanupIntervalHours: toNumber(value?.cleanupIntervalHours, DEFAULT_CHECKPOINT_CONFIG.cleanupIntervalHours),
		autoEnabled: typeof value?.autoEnabled === 'boolean' ? value.autoEnabled : DEFAULT_CHECKPOINT_CONFIG.autoEnabled,
		autoMinIntervalMs: toNumber(value?.autoMinIntervalMs, DEFAULT_CHECKPOINT_CONFIG.autoMinIntervalMs),
		autoFileChangeThreshold: toNumber(value?.autoFileChangeThreshold, DEFAULT_CHECKPOINT_CONFIG.autoFileChangeThreshold),
		autoShowNotifications: typeof value?.autoShowNotifications === 'boolean' ? value.autoShowNotifications : DEFAULT_CHECKPOINT_CONFIG.autoShowNotifications,
	};
}

export function validateCheckpointConfig(config: IKnoxGuiCheckpointConfig): Partial<Record<keyof IKnoxGuiCheckpointConfig, boolean>> {
	return {
		maxCheckpoints: !(Number.isInteger(config.maxCheckpoints) && config.maxCheckpoints >= 1 && config.maxCheckpoints <= 10000),
		retentionDays: !(Number.isInteger(config.retentionDays) && config.retentionDays >= 1 && config.retentionDays <= 365),
		maxStorageBytes: !(config.maxStorageBytes >= 1024 * 1024),
		maxFilesPerCheckpoint: !(Number.isInteger(config.maxFilesPerCheckpoint) && config.maxFilesPerCheckpoint >= 1 && config.maxFilesPerCheckpoint <= 100000),
		maxFileSizeBytes: !(config.maxFileSizeBytes >= 1024),
		autoMinIntervalMs: !(Number.isInteger(config.autoMinIntervalMs) && config.autoMinIntervalMs >= 1000 && config.autoMinIntervalMs <= 3_600_000),
		autoFileChangeThreshold: !(Number.isInteger(config.autoFileChangeThreshold) && config.autoFileChangeThreshold >= 1 && config.autoFileChangeThreshold <= 10000),
	};
}

/** `CheckpointConfig.tsx` `getValidationErrors`: per-field i18n keys; storage sizes are validated from the raw text. */
export function checkpointConfigFieldErrors(config: IKnoxGuiCheckpointConfig, storageInput: string, fileSizeInput: string): Partial<Record<keyof IKnoxGuiCheckpointConfig, string>> {
	const numeric = validateCheckpointConfig(config);
	const errors: Partial<Record<keyof IKnoxGuiCheckpointConfig, string>> = {};
	const fileSize = parseStorageBytes(fileSizeInput);
	if (fileSize === null || fileSize < 1024) {
		errors.maxFileSizeBytes = 'checkpointInvalidFileSize';
	}
	if (numeric.maxCheckpoints) {
		errors.maxCheckpoints = 'checkpointInvalidMaxCheckpoints';
	}
	if (numeric.retentionDays) {
		errors.retentionDays = 'checkpointInvalidRetentionDays';
	}
	const storage = parseStorageBytes(storageInput);
	if (storage === null || storage < 1024 * 1024) {
		errors.maxStorageBytes = 'checkpointInvalidStorageSize';
	}
	if (numeric.maxFilesPerCheckpoint) {
		errors.maxFilesPerCheckpoint = 'checkpointInvalidMaxFiles';
	}
	if (numeric.autoMinIntervalMs) {
		errors.autoMinIntervalMs = 'checkpointInvalidAutoInterval';
	}
	if (numeric.autoFileChangeThreshold) {
		errors.autoFileChangeThreshold = 'checkpointInvalidAutoFileThreshold';
	}
	return errors;
}

/** `hasChanges`: an unparseable storage input that differs from the saved value also counts as a change. */
export function checkpointConfigIsDirty(draft: IKnoxGuiCheckpointConfig, original: IKnoxGuiCheckpointConfig | undefined, storageInput: string): boolean {
	const saved = original ?? DEFAULT_CHECKPOINT_CONFIG;
	return checkpointConfigHasChanges(draft, saved) || (parseStorageBytes(storageInput) === null && storageInput.trim() !== formatCheckpointBytes(saved.maxStorageBytes));
}

/** `getNumberValue`: `parseInt`, falling back when the field is empty or non-numeric. */
export function checkpointConfigNumber(value: string, fallback: number): number {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : fallback;
}

export function checkpointConfigHasErrors(errors: Partial<Record<keyof IKnoxGuiCheckpointConfig, boolean>>): boolean {
	return Object.values(errors).some(Boolean);
}

export function checkpointConfigHasChanges(draft: IKnoxGuiCheckpointConfig, original?: IKnoxGuiCheckpointConfig): boolean {
	return JSON.stringify(draft) !== JSON.stringify(original ?? DEFAULT_CHECKPOINT_CONFIG);
}
