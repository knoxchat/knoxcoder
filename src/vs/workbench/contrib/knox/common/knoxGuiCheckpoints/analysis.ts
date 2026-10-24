/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { arr, rec } from './parse.js';

/** Analysis chips, grouping, share bundles, and restore notices. */

export const CHECKPOINT_ANALYSIS_GROUP_LIMIT = 50;

export function checkpointRiskChipClass(level: string): string {
	switch (level) {
		case 'Low': return 'odp-chip-green';
		case 'Medium': return 'odp-chip-yellow';
		case 'High': return 'odp-chip-orange';
		case 'Critical': return 'odp-chip-red';
		default: return 'odp-chip-muted';
	}
}

export function checkpointScopeChipClass(scope: string): string {
	switch (scope) {
		case 'Isolated': return 'odp-chip-muted';
		case 'Module': return 'odp-chip-blue';
		case 'CrossModule': return 'odp-chip-purple';
		case 'SystemWide': return 'odp-chip-red';
		default: return 'odp-chip-muted';
	}
}

export function checkpointImpactChipClass(level: string): string {
	switch (level) {
		case 'High': return 'odp-chip-red';
		case 'Medium': return 'odp-chip-yellow';
		default: return 'odp-chip-green';
	}
}

export function parseCheckpointAnalysis(value: unknown): {
	checkpointId: string;
	generatedDescription: string;
	riskAssessment: { level: 'Low' | 'Medium' | 'High' | 'Critical'; score: number; factors: Array<{ category: string; description: string; weight: number; affectedFiles: string[] }>; recommendations: string[] };
	impactAnalysis: { affectedFeatures: Array<{ name: string; impactLevel: string; changedFiles: string[] }>; affectedLayers: string[]; scope: string; uniqueDirectories?: number; testFilesChanged?: boolean; linesAdded?: number; linesDeleted?: number };
	counts?: { changed: number; created?: number; deleted?: number; modified?: number; tests?: number; config?: number; lockfile?: number };
	groupingSuggestion?: { groupName: string; rationale: string; confidence: number; checkpointIds: string[]; kind?: string };
} | undefined {
	const root = rec(value);
	const analysis = rec(root?.analysis) ?? root;
	if (!analysis) {
		return undefined;
	}
	const risk = rec(analysis.riskAssessment) ?? {};
	const impact = rec(analysis.impactAnalysis) ?? {};
	const counts = rec(analysis.counts);
	const level = risk.level === 'Medium' || risk.level === 'High' || risk.level === 'Critical' ? risk.level : 'Low';
	return {
		checkpointId: String(analysis.checkpointId ?? ''),
		generatedDescription: String(analysis.generatedDescription ?? ''),
		riskAssessment: {
			level,
			score: Number(risk.score ?? 0),
			factors: arr(risk.factors).map(item => {
				const factor = rec(item) ?? {};
				return {
					category: String(factor.category ?? ''),
					description: String(factor.description ?? ''),
					weight: Number(factor.weight ?? 0),
					affectedFiles: arr(factor.affectedFiles).map(String),
				};
			}),
			recommendations: arr(risk.recommendations).map(String),
		},
		impactAnalysis: {
			affectedFeatures: arr(impact.affectedFeatures).map(item => {
				const feature = rec(item) ?? {};
				return { name: String(feature.name ?? ''), impactLevel: String(feature.impactLevel ?? 'Low'), changedFiles: arr(feature.changedFiles).map(String) };
			}),
			affectedLayers: arr(impact.affectedLayers).map(String),
			scope: String(impact.scope ?? 'Isolated'),
			uniqueDirectories: impact.uniqueDirectories !== undefined ? Number(impact.uniqueDirectories) : undefined,
			testFilesChanged: impact.testFilesChanged !== undefined ? Boolean(impact.testFilesChanged) : undefined,
			linesAdded: impact.linesAdded !== undefined ? Number(impact.linesAdded) : undefined,
			linesDeleted: impact.linesDeleted !== undefined ? Number(impact.linesDeleted) : undefined,
		},
		counts: counts ? {
			changed: Number(counts.changed ?? 0),
			created: counts.created !== undefined ? Number(counts.created) : undefined,
			deleted: counts.deleted !== undefined ? Number(counts.deleted) : undefined,
			modified: counts.modified !== undefined ? Number(counts.modified) : undefined,
			tests: counts.tests !== undefined ? Number(counts.tests) : undefined,
			config: counts.config !== undefined ? Number(counts.config) : undefined,
			lockfile: counts.lockfile !== undefined ? Number(counts.lockfile) : undefined,
		} : undefined,
		groupingSuggestion: parseGroupingSuggestion(analysis.groupingSuggestion),
	};
}

function parseGroupingSuggestion(value: unknown): { groupName: string; rationale: string; confidence: number; checkpointIds: string[]; kind?: string } | undefined {
	const row = rec(value);
	if (!row) {
		return undefined;
	}
	return {
		groupName: String(row.groupName ?? ''),
		rationale: String(row.rationale ?? ''),
		confidence: Number(row.confidence ?? 0),
		checkpointIds: arr(row.checkpointIds).map(String),
		kind: row.kind ? String(row.kind) : undefined,
	};
}

export function parseSuggestedCheckpointGroups(value: unknown): Array<{ groupName: string; rationale: string; confidence: number; checkpointIds: string[]; kind?: string }> {
	const root = rec(value);
	return arr(root?.groups).map(parseGroupingSuggestion).filter((group): group is NonNullable<typeof group> => Boolean(group?.groupName || group?.checkpointIds.length));
}

export function parseShareBundles(value: unknown): {
	bundles: Array<{ id: string; description: string; sharedAt: string; checkpointCount: number; checkpointIds: string[]; filePath: string; sharedBy: string; machineId: string; exists: boolean }>;
	auditRecords: Array<{ id: string; timestamp: string; userId: string; machineId: string; action: string; resourceType: string; resourceId: string; outcome: string; details: string }>;
} {
	const root = rec(value);
	return {
		bundles: arr(root?.bundles).map(item => {
			const row = rec(item) ?? {};
			return {
				id: String(row.id ?? ''),
				description: String(row.description ?? ''),
				sharedAt: String(row.sharedAt ?? ''),
				checkpointCount: Number(row.checkpointCount ?? 0),
				checkpointIds: arr(row.checkpointIds).map(String),
				filePath: String(row.filePath ?? ''),
				sharedBy: String(row.sharedBy ?? ''),
				machineId: String(row.machineId ?? ''),
				exists: row.exists !== false,
			};
		}),
		auditRecords: arr(root?.auditRecords).map(item => {
			const row = rec(item) ?? {};
			return {
				id: String(row.id ?? ''),
				timestamp: String(row.timestamp ?? ''),
				userId: String(row.userId ?? ''),
				machineId: String(row.machineId ?? ''),
				action: String(row.action ?? ''),
				resourceType: String(row.resourceType ?? ''),
				resourceId: String(row.resourceId ?? ''),
				outcome: String(row.outcome ?? ''),
				details: String(row.details ?? ''),
			};
		}),
	};
}

/** `core/context/soul.formatRestoreNotice` — injected into the next stream after `checkpointRestored`. */
export function formatRestoreNotice(input: {
	checkpointId: string;
	description?: string;
	restoredFiles: string[];
	memoryRewound?: boolean;
	memoryMessage?: string;
}): string {
	const files = input.restoredFiles.length > 0
		? input.restoredFiles.slice(0, 20).join(', ')
		: '(see checkpoint details)';
	const extra = input.restoredFiles.length > 20
		? ` (+${input.restoredFiles.length - 20} more)`
		: '';
	const memoryLine = input.memoryRewound
		? ['Working memory was rewound to this checkpoint.', input.memoryMessage || ''].filter(Boolean).join(' ')
		: [
			'Memory was not rewound.',
			`Use builtin_workspace_checkpoint action=restore checkpoint_id=${input.checkpointId} rewind_memory=true if you also want working memory to match this disk state.`,
		].join(' ');
	return [
		'## Workspace restore',
		`The workspace was restored to checkpoint ${input.checkpointId}${input.description ? ` (${input.description})` : ''}.`,
		`Restored files: ${files}${extra}`,
		memoryLine,
		'Do not assume later edits still exist. Re-read files before editing.',
	].join('\n');
}

export function parseCheckpointRestored(data: unknown): { sessionId?: string; checkpointId: string; notice: string } | undefined {
	const row = rec(data);
	if (!row) {
		return undefined;
	}
	const checkpointId = String(row.checkpointId ?? row.id ?? '');
	const sessionId = row.sessionId ? String(row.sessionId) : undefined;
	if (!checkpointId && !sessionId) {
		return undefined;
	}
	const restoredFiles = arr(row.restoredFiles).map(String);
	const id = checkpointId || 'unknown';
	return {
		sessionId,
		checkpointId: id,
		notice: formatRestoreNotice({
			checkpointId: id,
			description: row.description ? String(row.description) : undefined,
			restoredFiles,
			memoryRewound: row.memoryRewound === true,
			memoryMessage: row.memoryMessage ? String(row.memoryMessage) : undefined,
		}),
	};
}
