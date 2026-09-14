/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { knoxMiniSearchIds, parseKnoxSessionDate } from './knoxHistory.js';
import { knoxProtocolObject, knoxUnwrapProtocol } from './knoxGuiProtocol.js';

export const CHECKPOINT_LIST_PAGE_SIZE = 50;

export interface IKnoxCheckpointFileSnapshot {
	relativePath: string;
	content: string;
	encoding?: string;
	lastModified?: string;
	size?: number;
}

export interface IKnoxCheckpointMetadata {
	id: string;
	description: string;
	dateCreated: string;
	workspacePath?: string;
	messageId?: string;
	fileSnapshots?: IKnoxCheckpointFileSnapshot[];
	conversationContext?: {
		messageContent: string;
		role: string;
		timestamp: string;
		index: number;
		sessionId?: string;
	};
	sessionId?: string;
	pinned?: boolean;
	tags?: string[];
	changedPaths?: string[];
	fileStats?: {
		total: number;
		created: number;
		modified: number;
		deleted: number;
	};
}

export interface IKnoxCheckpointCatalogItem {
	id: string;
	description: string;
	dateCreated: string;
}

export interface IKnoxCheckpointWorkspaceFolder {
	path: string;
	name: string;
}

export interface IKnoxCheckpointListResult {
	checkpoints: IKnoxCheckpointMetadata[];
	total: number;
	hasMore: boolean;
	compareCatalog: IKnoxCheckpointCatalogItem[];
	workspaceFolders: IKnoxCheckpointWorkspaceFolder[];
	activeWorkspacePath?: string;
}

export type KnoxRestorePreviewAction = 'overwrite' | 'create' | 'delete';

export interface IKnoxRestorePreviewFile {
	relativePath: string;
	action: KnoxRestorePreviewAction;
	additions: number;
	deletions: number;
	hunkCount: number;
}

export interface IKnoxRestorePreview {
	checkpointId: string;
	description: string;
	modified: number;
	added: number;
	deleted: number;
	files: IKnoxRestorePreviewFile[];
	writePaths: string[];
	extraPaths: string[];
	skippedFiles: Array<{ path: string; reason: string }>;
}

export interface IKnoxCheckpointDiffFile {
	relativePath: string;
	oldContent: string | null;
	newContent: string | null;
	oldEncoding?: string;
	newEncoding?: string;
}

export interface IKnoxCheckpointDiffSide {
	id: string;
	description: string;
	created: string;
}

export interface IKnoxCheckpointDiff {
	oldCheckpoint?: IKnoxCheckpointDiffSide;
	newCheckpoint: IKnoxCheckpointDiffSide;
	files: IKnoxCheckpointDiffFile[];
}

export interface IKnoxCheckpointTimelineItem {
	id: string;
	description: string;
	created: string;
	type: 'manual' | 'auto' | 'ai' | 'merge' | 'branch-point';
	branchId?: string;
	parentId?: string;
	tags: string[];
	fileChanges?: { added: number; modified: number; deleted: number };
	metadata?: { messageContent?: string; role?: string };
	isIncremental: boolean;
}

export interface IKnoxCheckpointBranch {
	id: string;
	name: string;
	color: string;
	baseCheckpointId: string;
	checkpoints: string[];
	isActive: boolean;
}

export interface IKnoxCheckpointTimeline {
	checkpoints: IKnoxCheckpointTimelineItem[];
	branches: IKnoxCheckpointBranch[];
	activeBranchId?: string;
}

export interface IKnoxCheckpointRiskFactor {
	category: string;
	description: string;
	weight: number;
	affectedFiles: string[];
}

export interface IKnoxCheckpointAnalysis {
	checkpointId?: string;
	generatedDescription: string;
	riskAssessment: {
		level: 'Low' | 'Medium' | 'High' | 'Critical';
		score: number;
		factors: IKnoxCheckpointRiskFactor[];
		recommendations: string[];
	};
	impactAnalysis: {
		affectedFeatures: Array<{ name: string; impactLevel: 'Low' | 'Medium' | 'High'; changedFiles: string[] }>;
		affectedLayers: string[];
		scope: string;
		uniqueDirectories?: number;
		testFilesChanged?: boolean;
		linesAdded?: number;
		linesDeleted?: number;
	};
	groupingSuggestion?: IKnoxCheckpointGroupingSuggestion;
}

export interface IKnoxCheckpointGroupingSuggestion {
	id?: string;
	kind?: 'session' | 'time' | 'path';
	groupName: string;
	rationale: string;
	confidence: number;
	checkpointIds: string[];
}

export interface IKnoxCheckpointDashboardData {
	currentStorage?: {
		timestamp: string;
		totalBytes: number;
		checkpointDataBytes: number;
		blobCount: number;
		checkpointCount: number;
	};
	storageHistory: Array<{ timestamp: string; totalBytes: number; checkpointCount: number }>;
	creationFrequency: Array<{ bucket: string; count: number }>;
	restorationEvents: Array<{
		timestamp: string;
		checkpointId: string;
		success: boolean;
		durationMs: number;
		filesRestored: number;
		filesFailed: number;
		error?: string;
	}>;
	aiSessionMetrics: Array<{
		sessionId: string;
		startedAt: string;
		endedAt?: string;
		filesChanged: number;
		checkpointsCreated: number;
		durationSeconds: number;
	}>;
	summary?: {
		totalCheckpointsCreated: number;
		totalRestorations: number;
		restorationSuccessRate: number;
		avgCreationTimeMs: number;
		avgRestorationTimeMs: number;
		totalAiSessions: number;
		avgChangesPerSession: number;
		totalRollbacks: number;
	};
}

export interface IKnoxSharedBundle {
	id: string;
	description: string;
	sharedAt: string;
	checkpointCount: number;
	checkpointIds?: string[];
	filePath: string;
	sharedBy: string;
	machineId: string;
	exists?: boolean;
}

export interface IKnoxCheckpointAuditRecord {
	id: string;
	timestamp: string;
	userId: string;
	machineId: string;
	action: string;
	resourceType: string;
	resourceId: string;
	outcome: string;
	details: string;
}

export interface IKnoxCheckpointConfig {
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

export const KNOX_DEFAULT_CHECKPOINT_CONFIG: IKnoxCheckpointConfig = {
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

export type KnoxCheckpointPanelTab = 'checkpoints' | 'timeline' | 'analysis' | 'dashboard' | 'share' | 'configuration';

export const KNOX_CHECKPOINT_TABS: readonly KnoxCheckpointPanelTab[] = [
	'checkpoints',
	'timeline',
	'analysis',
	'dashboard',
	'share',
	'configuration',
];

export function checkpointSessionId(checkpoint: IKnoxCheckpointMetadata): string | undefined {
	return checkpoint.sessionId ?? checkpoint.conversationContext?.sessionId;
}

export function buildCheckpointSearchDocument(checkpoint: IKnoxCheckpointMetadata) {
	return {
		id: checkpoint.id,
		description: checkpoint.description,
		tags: (checkpoint.tags ?? []).join(' '),
		sessionId: checkpointSessionId(checkpoint) ?? '',
		paths: (checkpoint.changedPaths ?? []).join(' '),
	};
}

export function selectCheckpointIdRange(orderedIds: string[], fromId: string, toId: string): string[] {
	const startIndex = orderedIds.indexOf(fromId);
	const endIndex = orderedIds.indexOf(toId);
	if (startIndex < 0 && endIndex < 0) {
		return [];
	}
	if (startIndex < 0) {
		return [toId];
	}
	if (endIndex < 0) {
		return [fromId];
	}
	const start = Math.min(startIndex, endIndex);
	const end = Math.max(startIndex, endIndex);
	return orderedIds.slice(start, end + 1);
}

export function chronologicalCheckpointPair<T extends { dateCreated: string }>(left: T, right: T): [T, T] {
	return parseKnoxSessionDate(left.dateCreated).getTime() <= parseKnoxSessionDate(right.dateCreated).getTime()
		? [left, right]
		: [right, left];
}

export function compareCheckpointTargets<T extends { id: string; dateCreated: string }>(catalog: T[], currentId: string): T[] {
	return catalog
		.filter(checkpoint => checkpoint.id !== currentId)
		.sort((a, b) => parseKnoxSessionDate(b.dateCreated).getTime() - parseKnoxSessionDate(a.dateCreated).getTime());
}

/** MiniSearch refine + GUI substring fallbacks (id / description / tags / session / paths). */
export function knoxFilterCheckpoints(
	checkpoints: readonly IKnoxCheckpointMetadata[],
	query: string,
): IKnoxCheckpointMetadata[] {
	const term = query.trim();
	if (!term) {
		return checkpoints.slice();
	}
	const documents = checkpoints.map(checkpoint => {
		const doc = buildCheckpointSearchDocument(checkpoint);
		return { id: doc.id, fields: [doc.description, doc.id, doc.tags, doc.sessionId, doc.paths] };
	});
	const searchResults = new Set(knoxMiniSearchIds(documents, term));
	const needle = term.toLowerCase();
	return checkpoints.filter(checkpoint => {
		if (searchResults.has(checkpoint.id)) {
			return true;
		}
		if (checkpoint.id.toLowerCase().startsWith(needle)) {
			return true;
		}
		if (checkpoint.description.toLowerCase().includes(needle)) {
			return true;
		}
		if (checkpoint.tags?.some(tag => tag.toLowerCase().includes(needle))) {
			return true;
		}
		const session = checkpointSessionId(checkpoint);
		if (session?.toLowerCase().includes(needle)) {
			return true;
		}
		if (checkpoint.changedPaths?.some(path => path.toLowerCase().includes(needle))) {
			return true;
		}
		return false;
	});
}

export function knoxLanguageFromPath(filePath: string): string {
	const ext = filePath.split('.').pop()?.toLowerCase() || '';
	const languageMap: Record<string, string> = {
		js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
		py: 'python', java: 'java', cpp: 'cpp', c: 'c', cs: 'csharp', go: 'go',
		rs: 'rust', php: 'php', rb: 'ruby', swift: 'swift', kt: 'kotlin',
		html: 'html', css: 'css', scss: 'scss', json: 'json', yaml: 'yaml',
		yml: 'yaml', md: 'markdown', sql: 'sql', sh: 'shell', xml: 'xml',
		vue: 'xml', toml: 'toml', ini: 'ini',
	};
	return languageMap[ext] || 'plaintext';
}

export function knoxFormatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return '0 B';
	}
	const units = ['B', 'KB', 'MB', 'GB'];
	let size = bytes;
	let unitIndex = 0;
	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex++;
	}
	const digits = size >= 10 || unitIndex === 0 ? 0 : 1;
	return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

export function knoxParseStorageBytes(value: string): number | null {
	const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/i);
	if (!match) {
		return null;
	}
	const size = Number(match[1]);
	const unit = (match[2]?.toUpperCase() ?? 'B') as 'B' | 'KB' | 'MB' | 'GB';
	const units = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };
	if (!Number.isFinite(size) || size <= 0) {
		return null;
	}
	return Math.round(size * units[unit]);
}

function toNumber(value: unknown, fallback: number): number {
	const numberValue = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(numberValue) ? numberValue : fallback;
}

export function knoxNormalizeCheckpointConfig(value: Partial<IKnoxCheckpointConfig> | null | undefined): IKnoxCheckpointConfig {
	const defaults = KNOX_DEFAULT_CHECKPOINT_CONFIG;
	return {
		maxCheckpoints: toNumber(value?.maxCheckpoints, defaults.maxCheckpoints),
		retentionDays: toNumber(value?.retentionDays, defaults.retentionDays),
		maxStorageBytes: toNumber(value?.maxStorageBytes, defaults.maxStorageBytes),
		maxFilesPerCheckpoint: toNumber(value?.maxFilesPerCheckpoint, defaults.maxFilesPerCheckpoint),
		maxFileSizeBytes: toNumber(value?.maxFileSizeBytes, defaults.maxFileSizeBytes),
		captureBinaryFiles: typeof value?.captureBinaryFiles === 'boolean' ? value.captureBinaryFiles : defaults.captureBinaryFiles,
		enableCompression: typeof value?.enableCompression === 'boolean' ? value.enableCompression : defaults.enableCompression,
		encryptAtRest: typeof value?.encryptAtRest === 'boolean' ? value.encryptAtRest : defaults.encryptAtRest,
		enableAutoCheckpoints: typeof value?.enableAutoCheckpoints === 'boolean' ? value.enableAutoCheckpoints : defaults.enableAutoCheckpoints,
		trackedExtensions: Array.isArray(value?.trackedExtensions)
			? value.trackedExtensions.map(extension => String(extension))
			: defaults.trackedExtensions,
		autoCleanup: typeof value?.autoCleanup === 'boolean' ? value.autoCleanup : defaults.autoCleanup,
		cleanupIntervalHours: toNumber(value?.cleanupIntervalHours, defaults.cleanupIntervalHours),
		autoEnabled: typeof value?.autoEnabled === 'boolean' ? value.autoEnabled : defaults.autoEnabled,
		autoMinIntervalMs: toNumber(value?.autoMinIntervalMs, defaults.autoMinIntervalMs),
		autoFileChangeThreshold: toNumber(value?.autoFileChangeThreshold, defaults.autoFileChangeThreshold),
		autoShowNotifications: typeof value?.autoShowNotifications === 'boolean' ? value.autoShowNotifications : defaults.autoShowNotifications,
	};
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

export function parseKnoxCheckpointMetadata(value: unknown): IKnoxCheckpointMetadata | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.id !== 'string' || !record.id) {
		return undefined;
	}
	return {
		id: record.id,
		description: typeof record.description === 'string' ? record.description : '',
		dateCreated: typeof record.dateCreated === 'string' ? record.dateCreated : '',
		workspacePath: asString(record.workspacePath),
		messageId: asString(record.messageId),
		fileSnapshots: Array.isArray(record.fileSnapshots) ? record.fileSnapshots as IKnoxCheckpointFileSnapshot[] : undefined,
		conversationContext: record.conversationContext && typeof record.conversationContext === 'object'
			? record.conversationContext as IKnoxCheckpointMetadata['conversationContext']
			: undefined,
		sessionId: asString(record.sessionId),
		pinned: record.pinned === true,
		tags: Array.isArray(record.tags) ? record.tags.map(tag => String(tag)) : undefined,
		changedPaths: Array.isArray(record.changedPaths) ? record.changedPaths.map(path => String(path)) : undefined,
		fileStats: record.fileStats && typeof record.fileStats === 'object' ? record.fileStats as IKnoxCheckpointMetadata['fileStats'] : undefined,
	};
}

export function parseKnoxCheckpointList(result: unknown): IKnoxCheckpointListResult {
	const record = knoxProtocolObject(result) ?? {};
	const raw = Array.isArray(record.checkpoints) ? record.checkpoints : [];
	const checkpoints = raw.map(parseKnoxCheckpointMetadata).filter((item): item is IKnoxCheckpointMetadata => !!item);
	const compareCatalog = Array.isArray(record.compareCatalog)
		? record.compareCatalog
			.map((item): IKnoxCheckpointCatalogItem | undefined => {
				if (!item || typeof item !== 'object') {
					return undefined;
				}
				const row = item as Record<string, unknown>;
				if (typeof row.id !== 'string') {
					return undefined;
				}
				return {
					id: row.id,
					description: typeof row.description === 'string' ? row.description : '',
					dateCreated: typeof row.dateCreated === 'string' ? row.dateCreated : '',
				};
			})
			.filter((item): item is IKnoxCheckpointCatalogItem => !!item)
		: [];
	const workspaceFolders = Array.isArray(record.workspaceFolders)
		? record.workspaceFolders
			.map((item): IKnoxCheckpointWorkspaceFolder | undefined => {
				if (!item || typeof item !== 'object') {
					return undefined;
				}
				const row = item as Record<string, unknown>;
				if (typeof row.path !== 'string') {
					return undefined;
				}
				return { path: row.path, name: typeof row.name === 'string' ? row.name : row.path };
			})
			.filter((item): item is IKnoxCheckpointWorkspaceFolder => !!item)
		: [];
	return {
		checkpoints,
		total: typeof record.total === 'number' ? record.total : checkpoints.length,
		hasMore: record.hasMore === true,
		compareCatalog,
		workspaceFolders,
		activeWorkspacePath: asString(record.activeWorkspacePath),
	};
}

export function parseKnoxRestorePreview(result: unknown): IKnoxRestorePreview | undefined {
	const record = knoxProtocolObject(result);
	const preview = record?.preview && typeof record.preview === 'object' ? record.preview as Record<string, unknown> : record;
	if (!preview || typeof preview.checkpointId !== 'string') {
		return undefined;
	}
	return {
		checkpointId: preview.checkpointId,
		description: typeof preview.description === 'string' ? preview.description : '',
		modified: typeof preview.modified === 'number' ? preview.modified : 0,
		added: typeof preview.added === 'number' ? preview.added : 0,
		deleted: typeof preview.deleted === 'number' ? preview.deleted : 0,
		files: Array.isArray(preview.files) ? preview.files as IKnoxRestorePreviewFile[] : [],
		writePaths: Array.isArray(preview.writePaths) ? preview.writePaths.map(path => String(path)) : [],
		extraPaths: Array.isArray(preview.extraPaths) ? preview.extraPaths.map(path => String(path)) : [],
		skippedFiles: Array.isArray(preview.skippedFiles) ? preview.skippedFiles as IKnoxRestorePreview['skippedFiles'] : [],
	};
}

export function parseKnoxCheckpointDiff(result: unknown): IKnoxCheckpointDiff | undefined {
	const record = knoxProtocolObject(result);
	const diff = record?.diff && typeof record.diff === 'object' ? record.diff as Record<string, unknown> : record;
	if (!diff || !diff.newCheckpoint || typeof diff.newCheckpoint !== 'object') {
		return undefined;
	}
	const newCheckpoint = diff.newCheckpoint as IKnoxCheckpointDiffSide;
	return {
		oldCheckpoint: diff.oldCheckpoint && typeof diff.oldCheckpoint === 'object' ? diff.oldCheckpoint as IKnoxCheckpointDiffSide : undefined,
		newCheckpoint,
		files: Array.isArray(diff.files) ? diff.files as IKnoxCheckpointDiffFile[] : [],
	};
}

export function parseKnoxCheckpointTimeline(result: unknown): IKnoxCheckpointTimeline {
	const record = knoxProtocolObject(result) ?? {};
	const checkpoints = Array.isArray(record.checkpoints) ? record.checkpoints as IKnoxCheckpointTimelineItem[] : [];
	const branches = Array.isArray(record.branches) ? record.branches as IKnoxCheckpointBranch[] : [];
	return {
		checkpoints,
		branches,
		activeBranchId: asString(record.activeBranchId),
	};
}

export function parseKnoxCheckpointAnalysis(result: unknown): IKnoxCheckpointAnalysis | undefined {
	const record = knoxProtocolObject(result);
	const analysis = record?.analysis && typeof record.analysis === 'object' ? record.analysis : record;
	if (!analysis || typeof analysis !== 'object' || !('riskAssessment' in analysis)) {
		return undefined;
	}
	return analysis as IKnoxCheckpointAnalysis;
}

export function parseKnoxGroupingSuggestions(result: unknown): IKnoxCheckpointGroupingSuggestion[] {
	const record = knoxProtocolObject(result) ?? {};
	return Array.isArray(record.groups) ? record.groups as IKnoxCheckpointGroupingSuggestion[] : [];
}

export function parseKnoxDashboard(result: unknown): IKnoxCheckpointDashboardData {
	const record = knoxProtocolObject(result) ?? {};
	const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : record;
	return {
		currentStorage: data.currentStorage && typeof data.currentStorage === 'object' ? data.currentStorage as IKnoxCheckpointDashboardData['currentStorage'] : undefined,
		storageHistory: Array.isArray(data.storageHistory) ? data.storageHistory as IKnoxCheckpointDashboardData['storageHistory'] : [],
		creationFrequency: Array.isArray(data.creationFrequency) ? data.creationFrequency as IKnoxCheckpointDashboardData['creationFrequency'] : [],
		restorationEvents: Array.isArray(data.restorationEvents) ? data.restorationEvents as IKnoxCheckpointDashboardData['restorationEvents'] : [],
		aiSessionMetrics: Array.isArray(data.aiSessionMetrics) ? data.aiSessionMetrics as IKnoxCheckpointDashboardData['aiSessionMetrics'] : [],
		summary: data.summary && typeof data.summary === 'object' ? data.summary as IKnoxCheckpointDashboardData['summary'] : undefined,
	};
}

export function parseKnoxShareBundles(result: unknown): { bundles: IKnoxSharedBundle[]; auditRecords: IKnoxCheckpointAuditRecord[] } {
	const record = knoxProtocolObject(result) ?? {};
	return {
		bundles: Array.isArray(record.bundles) ? record.bundles as IKnoxSharedBundle[] : [],
		auditRecords: Array.isArray(record.auditRecords) ? record.auditRecords as IKnoxCheckpointAuditRecord[] : [],
	};
}

export function parseKnoxCheckpointConfigResult(result: unknown): IKnoxCheckpointConfig {
	const unwrapped = knoxUnwrapProtocol(result);
	const record = knoxProtocolObject(result) ?? {};
	const config = record.config && typeof record.config === 'object'
		? record.config as Partial<IKnoxCheckpointConfig>
		: (unwrapped.content && typeof unwrapped.content === 'object' ? unwrapped.content as Partial<IKnoxCheckpointConfig> : record);
	return knoxNormalizeCheckpointConfig(config);
}
