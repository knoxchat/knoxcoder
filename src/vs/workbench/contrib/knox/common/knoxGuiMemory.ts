/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IKnoxGuiEffectiveContext,
	IKnoxGuiEbbinghausStats,
	IKnoxGuiMemoryDashboard,
	IKnoxGuiMemoryGraphEdge,
	IKnoxGuiMemoryGraphEntity,
	IKnoxGuiMemoryGraphExplore,
	IKnoxGuiMemoryGraphStats,
	IKnoxGuiMemoryItem,
	IKnoxGuiMemoryPhaseStatus,
	IKnoxGuiMemoryReviewDue,
	IKnoxGuiMemorySession,
	IKnoxGuiMemorySessionHistory,
	IKnoxGuiMetricsTrend,
} from './knoxGuiState.js';
import { MEMORY_CYCLE_PHASES, MEMORY_TAB_IDS, isMemoryTabId } from './knoxGuiOverlays.js';

export { MEMORY_CYCLE_PHASES, MEMORY_TAB_IDS, isMemoryTabId };

export type KnoxMemorySortBy = 'recent' | 'importance' | 'accessed';
export type KnoxMemoryPinnedFilter = 'all' | 'pinned' | 'unpinned';

/** KN-376: KN-311 retrieval defaults used by BrainStore and Settings. */
export const MEMORY_RETRIEVAL_THRESHOLD = 0.6;
export const MEMORY_RETRIEVAL_TOP_K = 20;

/** KN-376: each Memory panel tab’s KN-310–317 `brain/*` surface. */
export const MEMORY_PANEL_TAB_BRAIN_MESSAGES = {
	overview: ['brain/dashboard', 'brain/getEffectiveContext', 'brain/getMetricsTrend', 'brain/getPhaseStatus', 'brain/getReviewDue', 'brain/getEbbinghausStats', 'brain/consolidate'],
	memories: ['brain/searchMemories', 'brain/pinMemory', 'brain/unpinMemory', 'brain/pinMemories', 'brain/unpinMemories', 'brain/deleteMemory', 'brain/deleteMemories'],
	sessions: ['brain/listSessions', 'brain/getSessionHistory', 'brain/searchBacklogs'],
	graph: ['brain/graphStats', 'brain/listEntities', 'brain/searchEntities', 'brain/exploreGraph'],
	settings: ['brain/getConfig', 'brain/updateConfig', 'brain/optimize', 'brain/heal', 'brain/export', 'brain/import', 'brain/consolidate'],
} as const;

export const MEMORY_TAB_KEYS: Record<string, string> = {
	overview: 'memoryOverview',
	memories: 'memoryBrowser',
	sessions: 'memorySessionHistoryTab',
	graph: 'memoryGraph',
	settings: 'memorySettings',
};

export const MEMORY_TAB_ICONS: Record<string, string> = {
	overview: 'brain',
	memories: 'database',
	sessions: 'message-square',
	graph: 'graph-nodes',
	settings: 'settings',
};

export const MEMORY_CATEGORY_ICONS: Record<string, string> = {
	insight: 'lightbulb',
	decision: 'target',
	preference: 'star',
	error_fix: 'wrench',
	code_pattern: 'ruler',
	project_context: 'folder-open',
	general: 'file-text',
	convention: 'ruler',
};

/** `MemoryBrowser.tsx` uses `Folder` where `MemoryOverview.tsx` uses `FolderOpen`. */
export const MEMORY_BROWSER_CATEGORY_ICONS: Record<string, string> = {
	...MEMORY_CATEGORY_ICONS,
	project_context: 'folder',
};

export const MEMORY_SETTING_GROUP_ICONS: Record<string, string> = {
	memoryGeneralSettings: 'settings',
	memoryEbbinghausSettings: 'brain',
	memoryCapacitySettings: 'package',
	memoryPrecisionSettings: 'crosshair',
	memoryWorkingMemorySettings: 'brain',
	memoryTaskRoutingSettings: 'sliders-horizontal',
	memoryContextAssemblySettings: 'layers',
	memoryModeTuningSettings: 'sliders-horizontal',
	memoryBudgetSettings: 'sliders-horizontal',
	memoryFusionSettings: 'search',
	memoryCompressionSettings: 'layers',
	memoryIntegrationSettings: 'timer',
	memoryGraphSettings: 'search',
	memoryTieringSettings: 'package',
	memoryFeatureSettings: 'search',
};

export const MEMORY_SLEEP_PHASE_LABELS: Record<string, string> = {
	nrem_replay: 'NREM Replay',
	nrem_decay_demoted: 'NREM Decay (demoted)',
	nrem_decay_pruned: 'NREM Decay (pruned)',
	nrem_compress: 'NREM Compress',
	rem_distill: 'REM Distill',
	graph_strengthen: 'Graph Strengthen',
	promote: 'Promote',
};

export const MEMORY_STATUS_COLORS: Record<string, string> = {
	healthy: '#22c55e',
	ok: '#22c55e',
	degraded: '#f59e0b',
	warning: '#f59e0b',
	critical: '#ef4444',
	error: '#ef4444',
};

export const MEMORY_EFFECTIVE_TIERS = ['active', 'hot', 'warm', 'cold', 'frozen'] as const;

export const MEMORY_TIER_COLORS: Record<string, { bg: string; text: string }> = {
	hot: { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444' },
	warm: { bg: 'rgba(245, 158, 11, 0.15)', text: '#f59e0b' },
	cold: { bg: 'rgba(59, 130, 246, 0.15)', text: '#3b82f6' },
};

export const MEMORY_GRAPH_TYPE_COLORS: Record<string, string> = {
	technology: '#3b82f6',
	framework: '#8b5cf6',
	library: '#6366f1',
	language: '#ec4899',
	tool: '#f59e0b',
	concept: '#10b981',
	person: '#f97316',
	project: '#06b6d4',
	file: '#84cc16',
	service: '#14b8a6',
	api: '#a855f7',
	database: '#ef4444',
	default: '#6b7280',
};

export function filterAndSortMemories(
	memories: IKnoxGuiMemoryItem[],
	opts: { category?: string; tier?: string; pinned?: KnoxMemoryPinnedFilter; sortBy?: KnoxMemorySortBy; query?: string },
): IKnoxGuiMemoryItem[] {
	let filtered = memories;
	const query = opts.query?.trim().toLowerCase();
	if (query) {
		filtered = filtered.filter(memory =>
			(memory.title || '').toLowerCase().includes(query)
			|| (memory.content || '').toLowerCase().includes(query)
			|| (memory.keywords || '').toLowerCase().includes(query)
			|| (memory.category || '').toLowerCase().includes(query));
	}
	if (opts.category && opts.category !== 'all') {
		filtered = filtered.filter(memory => memory.category === opts.category);
	}
	if (opts.tier && opts.tier !== 'all') {
		filtered = filtered.filter(memory => memory.tier === opts.tier);
	}
	if (opts.pinned === 'pinned') {
		filtered = filtered.filter(memory => !!memory.pinned);
	} else if (opts.pinned === 'unpinned') {
		filtered = filtered.filter(memory => !memory.pinned);
	}
	if (opts.sortBy === 'importance') {
		return [...filtered].sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
	}
	if (opts.sortBy === 'accessed') {
		return [...filtered].sort((a, b) => (b.retrievalCount ?? 0) - (a.retrievalCount ?? 0));
	}
	return [...filtered].sort((a, b) => parseTime(b.createdAt) - parseTime(a.createdAt));
}

export type KnoxMemoryDateSection = {
	headerKey: 'today' | 'thisWeek' | 'thisMonth' | 'memoryEarlier';
	memories: IKnoxGuiMemoryItem[];
};

export function groupMemoriesByDate(memories: IKnoxGuiMemoryItem[], now = Date.now()): KnoxMemoryDateSection[] {
	const yesterday = now - 1000 * 60 * 60 * 24;
	const lastWeek = now - 1000 * 60 * 60 * 24 * 7;
	const lastMonth = now - 1000 * 60 * 60 * 24 * 30;
	const sections: KnoxMemoryDateSection[] = [];
	let currentKey: KnoxMemoryDateSection['headerKey'] | '' = '';
	let current: IKnoxGuiMemoryItem[] = [];
	const flush = () => {
		if (currentKey && current.length) {
			sections.push({ headerKey: currentKey, memories: current });
		}
	};
	for (const memory of memories) {
		const date = parseTime(memory.createdAt);
		let key: KnoxMemoryDateSection['headerKey'];
		if (date > yesterday) {
			key = 'today';
		} else if (date > lastWeek) {
			key = 'thisWeek';
		} else if (date > lastMonth) {
			key = 'thisMonth';
		} else {
			key = 'memoryEarlier';
		}
		if (key !== currentKey) {
			flush();
			currentKey = key;
			current = [memory];
		} else {
			current.push(memory);
		}
	}
	flush();
	return sections;
}

function parseTime(value: string | undefined): number {
	if (!value) {
		return 0;
	}
	const time = new Date(value).getTime();
	return isNaN(time) ? 0 : time;
}

export function memorySnippet(text: string, max = 96): string {
	const compact = (text || '').replace(/\s+/g, ' ').trim();
	if (compact.length <= max) {
		return compact;
	}
	return `${compact.slice(0, max - 1)}…`;
}

export function uniqueMemoryCategories(memories: IKnoxGuiMemoryItem[]): string[] {
	return [...new Set(memories.map(memory => memory.category).filter((value): value is string => Boolean(value)))].sort();
}

export function uniqueMemoryTiers(memories: IKnoxGuiMemoryItem[]): string[] {
	return [...new Set(memories.map(memory => memory.tier).filter((value): value is string => Boolean(value)))];
}

export function dashboardHealthGrade(score: number | undefined): string {
	if (score == null) {
		return '';
	}
	if (score >= 90) {
		return 'A';
	}
	if (score >= 80) {
		return 'B';
	}
	if (score >= 70) {
		return 'C';
	}
	if (score >= 60) {
		return 'D';
	}
	return 'F';
}

export function formatBytes(bytes: number | undefined): string {
	if (!bytes) {
		return '0 B';
	}
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
	return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function formatMemoryTimeAgo(
	dateStr: string | null | undefined,
	translate: (key: string, vars?: Record<string, string | number>) => string,
	now = Date.now(),
): string {
	if (!dateStr) {
		return translate('memoryTimeNever');
	}
	const time = new Date(dateStr).getTime();
	if (isNaN(time)) {
		return translate('memoryTimeNever');
	}
	const minutes = Math.floor((now - time) / 60000);
	if (minutes < 1) {
		return translate('memoryTimeJustNow');
	}
	if (minutes < 60) {
		return translate('memoryTimeMinutesAgo', { count: minutes });
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return translate('memoryTimeHoursAgo', { count: hours });
	}
	return translate('memoryTimeDaysAgo', { count: Math.floor(hours / 24) });
}

export function formatMemoryDate(dateStr: string | undefined): string {
	if (!dateStr) {
		return '';
	}
	const date = new Date(dateStr);
	if (isNaN(date.getTime())) {
		return dateStr;
	}
	return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function graphEntityColor(type: string | undefined): string {
	return (type && MEMORY_GRAPH_TYPE_COLORS[type]) || MEMORY_GRAPH_TYPE_COLORS.default;
}

export function layoutMemoryGraph(
	entities: IKnoxGuiMemoryGraphEntity[],
	width: number,
	height: number,
): Array<IKnoxGuiMemoryGraphEntity & { x: number; y: number }> {
	if (!entities.length) {
		return [];
	}
	const cx = width / 2;
	const cy = height / 2;
	const radius = Math.min(width, height) * 0.36;
	return entities.map((entity, index) => {
		const angle = (Math.PI * 2 * index) / entities.length - Math.PI / 2;
		return {
			...entity,
			x: cx + Math.cos(angle) * radius,
			y: cy + Math.sin(angle) * radius,
		};
	});
}

export function parseMemoryDashboard(raw: Record<string, unknown> | undefined): IKnoxGuiMemoryDashboard | undefined {
	if (!raw) {
		return undefined;
	}
	const stats = asRecord(raw.stats) ?? raw;
	const health = asRecord(raw.health);
	const healthScore = asRecord(raw.healthScore);
	const phase = asRecord(raw.phaseStatus) ?? asRecord(raw.phase_status);
	const graph = asRecord(raw.graphStats) ?? asRecord(raw.graph_stats);
	const consolidation = asRecord(raw.consolidation);
	return {
		totalSessions: Number(stats.total_sessions ?? stats.totalSessions ?? 0),
		totalEpisodic: Number(stats.total_episodic ?? stats.totalEpisodic ?? 0),
		totalSemantic: Number(stats.total_semantic ?? stats.totalSemantic ?? 0),
		totalEntities: Number(stats.total_entities ?? stats.totalEntities ?? 0),
		totalEdges: Number(stats.total_edges ?? stats.totalEdges ?? 0),
		totalAssociations: Number(stats.total_associations ?? 0),
		totalPatterns: Number(stats.total_patterns ?? 0),
		totalProcedures: Number(stats.total_procedures ?? 0),
		totalTags: Number(stats.total_tags ?? stats.totalTags ?? 0) || undefined,
		totalCollections: Number(stats.total_collections ?? stats.totalCollections ?? 0) || undefined,
		dbSizeBytes: Number(stats.db_size_bytes ?? health?.db_size_bytes ?? 0),
		healthScore: healthScore?.overall != null ? Number(healthScore.overall) : (healthScore?.score != null ? Number(healthScore.score) : (raw.healthScore != null && typeof raw.healthScore !== 'object' ? Number(raw.healthScore) : undefined)),
		healthGrade: healthScore?.grade ? String(healthScore.grade) : undefined,
		healthStatus: health?.status ? String(health.status) : undefined,
		healthIssues: asArray(health?.issues).map(String),
		healthRecommendations: asArray(health?.recommendations).map(String),
		activePhase: phase?.active_phase ? String(phase.active_phase) : undefined,
		phaseCounts: asNumberRecord(phase?.phase_counts),
		cycleInvariantMet: phase?.cycle_invariant_met === true,
		tierCounts: asNumberRecord(asRecord(stats.tier_counts) ?? stats.tierCounts),
		categoryCounts: asNumberRecord(asRecord(stats.category_counts) ?? stats.categoryCounts),
		entityTypeCounts: asNumberRecord(asRecord(stats.entity_type_counts) ?? stats.entityTypeCounts),
		oldestMemory: stats.oldest_memory ? String(stats.oldest_memory) : undefined,
		newestMemory: stats.newest_memory ? String(stats.newest_memory) : undefined,
		graphMaxEntities: Number(graph?.max_entities ?? stats.graph_max_entities ?? 0) || undefined,
		graphCapUtilization: Number(graph?.cap_utilization ?? 0) || undefined,
		graphAtCap: graph?.at_cap === true,
		graphTotalEntities: graph?.total_entities != null ? Number(graph.total_entities) : undefined,
		graphTotalEdges: graph?.total_edges != null ? Number(graph.total_edges) : undefined,
		graphMaxDepth: graph?.max_depth != null ? Number(graph.max_depth) : undefined,
		graphDepthDecayGamma: graph?.depth_decay_gamma != null ? Number(graph.depth_decay_gamma) : undefined,
		sessions: asArray(raw.sessions).map(parseMemorySession).filter((session): session is NonNullable<typeof session> => Boolean(session)),
		consolidation: consolidation ? {
			totalRuns: Number(consolidation.total_runs ?? 0),
			lastRunAt: consolidation.last_run_at ? String(consolidation.last_run_at) : (consolidation.last_run ? String(consolidation.last_run) : undefined),
			avgDurationMs: Number(consolidation.avg_duration_ms ?? 0),
			lastSubPhases: asNumberRecord(consolidation.last_sub_phases),
		} : undefined,
	};
}

export function unwrapBrainConfig(raw: Record<string, unknown> | undefined): Record<string, unknown> {
	const rec = asRecord(raw);
	return asRecord(rec?.config) ?? rec ?? {};
}

export function parseMemoryItem(item: unknown): IKnoxGuiMemoryItem | undefined {
	const rec = asRecord(item);
	if (!rec) {
		return undefined;
	}
	const id = String(rec.id ?? '');
	if (!id) {
		return undefined;
	}
	return {
		id,
		title: String(rec.title ?? rec.name ?? rec.id ?? ''),
		content: rec.content ? String(rec.content) : rec.text ? String(rec.text) : undefined,
		pinned: Boolean(rec.pinned),
		category: rec.category ? String(rec.category) : undefined,
		keywords: rec.keywords ? String(rec.keywords) : undefined,
		importance: typeof rec.importance_score === 'number' ? rec.importance_score : (typeof rec.importance === 'number' ? rec.importance : undefined),
		retrievalCount: typeof rec.retrieval_count === 'number' ? rec.retrieval_count : undefined,
		tier: rec.tier ? String(rec.tier) : undefined,
		createdAt: rec.created_at ? String(rec.created_at) : undefined,
		lastAccessedAt: rec.last_accessed_at ? String(rec.last_accessed_at) : undefined,
		sourceSessionId: rec.source_session_id ? String(rec.source_session_id) : undefined,
	};
}

export function parseEffectiveContext(raw: Record<string, unknown> | undefined): IKnoxGuiEffectiveContext | undefined {
	const rec = asRecord(raw);
	if (!rec) {
		return undefined;
	}
	const levels = asArray(rec.memory_levels ?? rec.levels).map(item => {
		const row = asRecord(item) ?? {};
		return {
			id: String(row.id ?? ''),
			name: String(row.name ?? row.id ?? ''),
			tokens: Number(row.tokens ?? 0),
			ratio: typeof row.ratio === 'number' ? row.ratio : undefined,
			effectiveTokens: row.effective_tokens != null ? Number(row.effective_tokens) : undefined,
		};
	}).filter(level => level.name);
	return {
		totalEffective: Number(rec.total_effective ?? rec.hierarchy_effective_tokens ?? 0),
		activeWindowTokens: rec.active_window_tokens != null ? Number(rec.active_window_tokens) : undefined,
		lastContextTokensUsed: rec.last_context_tokens_used != null ? Number(rec.last_context_tokens_used) : undefined,
		hierarchyEffectiveTokens: rec.hierarchy_effective_tokens != null ? Number(rec.hierarchy_effective_tokens) : undefined,
		workingMemoryBudget: rec.working_memory_budget != null ? Number(rec.working_memory_budget) : undefined,
		contextMaxTokens: rec.context_max_tokens != null ? Number(rec.context_max_tokens) : undefined,
		windowUtilization: rec.window_utilization != null ? Number(rec.window_utilization) : undefined,
		memoryTokensSaved: rec.memory_tokens_saved != null ? Number(rec.memory_tokens_saved) : undefined,
		graphEntityCount: rec.graph_entity_count != null ? Number(rec.graph_entity_count) : undefined,
		graphMaxEntities: rec.graph_max_entities != null ? Number(rec.graph_max_entities) : undefined,
		graphCapUtilization: rec.graph_cap_utilization != null ? Number(rec.graph_cap_utilization) : undefined,
		tierTokens: asNumberRecord(rec.tier_tokens),
		compressionRatios: asNumberRecord(rec.compression_ratios),
		levels,
	};
}

export function parseMetricsTrend(raw: Record<string, unknown> | undefined): IKnoxGuiMetricsTrend | undefined {
	const rec = asRecord(raw);
	if (!rec) {
		return undefined;
	}
	const snapshots = asArray(rec.snapshots).map(item => {
		const row = asRecord(item) ?? {};
		return {
			avgResponseMs: Number(row.avg_response_ms ?? 0),
			successRate: Number(row.success_rate ?? 0),
			memoryCount: Number(row.memory_count ?? 0),
			totalEffective: row.total_effective != null ? Number(row.total_effective) : undefined,
			tokensSaved: row.memory_tokens_saved != null ? Number(row.memory_tokens_saved) : undefined,
		};
	});
	return {
		response: rec.avg_response_trend ? String(rec.avg_response_trend) : rec.response ? String(rec.response) : undefined,
		success: rec.success_rate_trend ? String(rec.success_rate_trend) : rec.success ? String(rec.success) : undefined,
		growth: rec.growth_rate_trend ? String(rec.growth_rate_trend) : rec.growth ? String(rec.growth) : undefined,
		compression: rec.compression_trend ? String(rec.compression_trend) : rec.compression ? String(rec.compression) : undefined,
		effectiveContext: rec.effective_context_trend ? String(rec.effective_context_trend) : rec.effective_context ? String(rec.effective_context) : rec.effectiveContext ? String(rec.effectiveContext) : undefined,
		periodHours: rec.period_hours != null ? Number(rec.period_hours) : undefined,
		snapshots,
	};
}

export function parsePhaseStatus(raw: Record<string, unknown> | undefined): IKnoxGuiMemoryPhaseStatus | undefined {
	const rec = asRecord(raw);
	if (!rec) {
		return undefined;
	}
	const last = asRecord(rec.last_completed);
	return {
		activePhase: rec.active_phase ? String(rec.active_phase) : undefined,
		phaseCounts: asNumberRecord(rec.phase_counts),
		cycleInvariantMet: rec.cycle_invariant_met === true,
		backgroundSleepActive: rec.background_sleep_active === true,
		lastCompleted: last?.phase ? String(last.phase) : (typeof rec.last_completed === 'string' ? rec.last_completed : undefined),
	};
}

export function parseReviewDue(raw: unknown): IKnoxGuiMemoryReviewDue[] {
	const rec = asRecord(raw);
	const items = asArray(rec?.items ?? raw);
	return items.map(item => {
		const row = asRecord(item) ?? {};
		return {
			memoryId: String(row.memory_id ?? row.id ?? ''),
			title: String(row.title ?? ''),
			category: row.category ? String(row.category) : undefined,
			overdue: Boolean(row.overdue),
			currentRetention: typeof row.current_retention === 'number' ? row.current_retention : undefined,
		};
	}).filter(item => item.memoryId || item.title);
}

export function parseEbbinghausStats(raw: Record<string, unknown> | undefined): IKnoxGuiEbbinghausStats | undefined {
	const rec = asRecord(raw);
	if (!rec) {
		return undefined;
	}
	const config = asRecord(rec.config);
	return {
		reviewDueCount: Number(rec.review_due_count ?? 0),
		avgRetention: Number(rec.avg_retention ?? 0),
		lambda: config?.lambda != null ? Number(config.lambda) : (rec.lambda != null ? Number(rec.lambda) : undefined),
	};
}

export function parseMemorySession(item: unknown): IKnoxGuiMemorySession | undefined {
	const rec = asRecord(item);
	if (!rec) {
		return undefined;
	}
	const id = String(rec.id ?? rec.session_id ?? '');
	if (!id) {
		return undefined;
	}
	return {
		id,
		title: String(rec.title ?? rec.id ?? ''),
		updatedAt: rec.updated_at ? String(rec.updated_at) : rec.created_at ? String(rec.created_at) : undefined,
		messageCount: typeof rec.message_count === 'number' ? rec.message_count : undefined,
		summary: rec.summary ? String(rec.summary) : undefined,
		isActive: Boolean(rec.is_active ?? rec.active),
	};
}

export function parseSessionHistory(raw: Record<string, unknown> | undefined, sessionId: string): IKnoxGuiMemorySessionHistory | undefined {
	const rec = asRecord(raw);
	if (!rec) {
		return undefined;
	}
	const inner = asRecord(rec.result) ?? rec;
	return {
		sessionId: String(inner.session_id ?? inner.sessionId ?? sessionId),
		episodic: asArray(inner.episodic).map(item => {
			const row = asRecord(item) ?? {};
			return { id: row.id != null ? String(row.id) : undefined, role: row.role ? String(row.role) : undefined, content: String(row.content ?? '') };
		}),
		semantic: asArray(inner.semantic).map(item => {
			const row = asRecord(item) ?? {};
			return { id: row.id != null ? String(row.id) : undefined, title: row.title ? String(row.title) : undefined, category: row.category ? String(row.category) : undefined, content: String(row.content ?? '') };
		}),
		topics: asArray(inner.topics).map(item => {
			if (typeof item === 'string') {
				return item;
			}
			const row = asRecord(item) ?? {};
			return String(row.topic ?? row.name ?? '');
		}).filter(Boolean),
		tokenEstimate: typeof inner.token_estimate === 'number' ? inner.token_estimate : (typeof inner.tokenEstimate === 'number' ? inner.tokenEstimate : undefined),
		messageCount: typeof inner.message_count === 'number' ? inner.message_count : undefined,
	};
}

export function parseGraphEntities(raw: unknown): IKnoxGuiMemoryGraphEntity[] {
	return asArray(asRecord(raw)?.entities ?? raw).map(item => {
		const rec = asRecord(item) ?? {};
		return {
			id: Number(rec.id ?? 0),
			name: String(rec.name ?? rec.id ?? ''),
			entityType: String(rec.entity_type ?? rec.type ?? 'concept'),
			description: rec.description ? String(rec.description) : undefined,
			mentionCount: Number(rec.mention_count ?? rec.edge_count ?? 0),
			edgeCount: rec.edge_count != null ? Number(rec.edge_count) : undefined,
		};
	}).filter(entity => entity.name);
}

export function parseGraphEdges(raw: unknown): IKnoxGuiMemoryGraphEdge[] {
	return asArray(asRecord(raw)?.edges ?? raw).map(item => {
		const rec = asRecord(item) ?? {};
		return {
			id: Number(rec.id ?? 0),
			source: Number(rec.source_entity_id ?? rec.source ?? 0),
			target: Number(rec.target_entity_id ?? rec.target ?? 0),
			relationship: String(rec.relationship ?? ''),
			weight: Number(rec.weight ?? 1),
		};
	});
}

export function parseGraphStats(raw: Record<string, unknown> | undefined): IKnoxGuiMemoryGraphStats | undefined {
	const rec = asRecord(raw);
	if (!rec) {
		return undefined;
	}
	return {
		totalEntities: Number(rec.total_entities ?? 0),
		totalEdges: Number(rec.total_edges ?? 0),
		entityTypes: asNumberRecord(rec.entity_types ?? rec.entity_type_counts),
		maxEntities: rec.max_entities != null ? Number(rec.max_entities) : undefined,
		capUtilization: rec.cap_utilization != null ? Number(rec.cap_utilization) : undefined,
		atCap: rec.at_cap === true,
		maxDepth: rec.max_depth != null ? Number(rec.max_depth) : undefined,
		depthDecayGamma: rec.depth_decay_gamma != null ? Number(rec.depth_decay_gamma) : undefined,
	};
}

export function parseExploreResult(raw: Record<string, unknown> | undefined): IKnoxGuiMemoryGraphExplore | undefined {
	const rec = asRecord(raw);
	if (!rec) {
		return undefined;
	}
	const inner = asRecord(rec.result) ?? rec;
	const center = asRecord(inner.center);
	const centerEntity = center ? parseGraphEntities([center])[0] : undefined;
	const entities = parseGraphEntities(inner.entities ?? inner);
	if (centerEntity && !entities.some(entity => entity.id === centerEntity.id)) {
		entities.unshift(centerEntity);
	}
	return {
		centerId: centerEntity?.id ?? (inner.center_id != null ? Number(inner.center_id) : undefined),
		centerName: centerEntity?.name,
		centerDescription: centerEntity?.description,
		entities,
		edges: parseGraphEdges(inner.edges ?? inner),
		depthReached: inner.depth_reached != null ? Number(inner.depth_reached) : undefined,
		entityDepths: asNumberRecord(inner.entity_depths ?? inner.entityDepths),
	};
}

export function memoryExploreEdgeDepth(edge: IKnoxGuiMemoryGraphEdge, depths: Record<string, number> | undefined): number {
	const left = depths?.[String(edge.source)] ?? depths?.[edge.source] ?? Number.MAX_SAFE_INTEGER;
	const right = depths?.[String(edge.target)] ?? depths?.[edge.target] ?? Number.MAX_SAFE_INTEGER;
	return Math.max(left, right);
}

export function sortMemoryExploreEdges(edges: IKnoxGuiMemoryGraphEdge[], depths?: Record<string, number>): IKnoxGuiMemoryGraphEdge[] {
	return [...edges].sort((a, b) => {
		const depthDelta = memoryExploreEdgeDepth(a, depths) - memoryExploreEdgeDepth(b, depths);
		return depthDelta !== 0 ? depthDelta : b.weight - a.weight;
	});
}

/** `KnowledgeGraphView.tsx` `exploreEdges`: only edges whose ends are both in the explore result, nearest hop first. */
export function visibleMemoryExploreEdges(explore: IKnoxGuiMemoryGraphExplore): IKnoxGuiMemoryGraphEdge[] {
	const ids = new Set(explore.entities.map(entity => entity.id));
	if (explore.centerId != null) {
		ids.add(explore.centerId);
	}
	return sortMemoryExploreEdges(explore.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)), explore.entityDepths);
}

/** `KnowledgeGraphView.tsx` `typeCounts` / `entityTypes`: stats counts plus unseen types at 0, most common first. */
export function memoryGraphTypeCounts(statsTypes: Record<string, number> | undefined, entities: ReadonlyArray<{ entityType?: string }>): Array<[string, number]> {
	const counts: Record<string, number> = { ...(statsTypes ?? {}) };
	for (const entity of entities) {
		if (entity.entityType && counts[entity.entityType] === undefined) {
			counts[entity.entityType] = 0;
		}
	}
	return Object.entries(counts).filter(([type]) => Boolean(type)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** `memoryBrowserUtils.ts` `memoriesToExportJson`. */
export function memoriesToExportJson(memories: IKnoxGuiMemoryItem[], now = new Date()): string {
	return JSON.stringify({
		version: 'knox-memories-selected-v1',
		exported_at: now.toISOString(),
		count: memories.length,
		memories: memories.map(memory => ({
			id: Number.isNaN(Number(memory.id)) ? memory.id : Number(memory.id),
			category: memory.category,
			title: memory.title,
			content: memory.content,
			keywords: memory.keywords,
			importance_score: memory.importance,
			retrieval_count: memory.retrievalCount,
			tier: memory.tier,
			created_at: memory.createdAt,
			last_accessed_at: memory.lastAccessedAt,
			source_session_id: memory.sourceSessionId,
			pinned: Boolean(memory.pinned),
		})),
	}, null, 2);
}

/** `memoryBrowserUtils.ts` `memoriesToExportMarkdown`. */
export function memoriesToExportMarkdown(memories: IKnoxGuiMemoryItem[], now = new Date()): string {
	const lines = [`# Memories export (${memories.length})`, '', `Exported ${now.toISOString()}`, ''];
	for (const memory of memories) {
		lines.push(`## ${memory.title || '(untitled)'}`, '');
		lines.push(`- Category: ${memory.category || 'general'} · Tier: ${memory.tier || '—'} · Pin: ${memory.pinned ? 'yes' : 'no'}`);
		if (memory.keywords) {
			lines.push(`- Keywords: ${memory.keywords}`);
		}
		lines.push(`- Created: ${memory.createdAt}`, '', memory.content || '', '');
	}
	return lines.join('\n');
}

/** `memoryBrowserUtils.ts` `rangeSelectIds`: shift-click selects the span from the last clicked row, else toggles. */
export function rangeSelectMemoryIds(orderedIds: readonly string[], fromId: string | null, toId: string, current: ReadonlySet<string>): Set<string> {
	const next = new Set(current);
	const from = fromId == null ? -1 : orderedIds.indexOf(fromId);
	const to = orderedIds.indexOf(toId);
	if (from < 0 || to < 0) {
		if (next.has(toId)) {
			next.delete(toId);
		} else {
			next.add(toId);
		}
		return next;
	}
	const [start, end] = from < to ? [from, to] : [to, from];
	for (let i = start; i <= end; i++) {
		next.add(orderedIds[i]);
	}
	return next;
}

/** `MemoryBrowser.tsx`: "no results" vs "nothing stored" (the category filter does not count). */
export function memoryBrowserEmptyKey(query: string, pinned: string, tier: string): 'memoryNoResults' | 'memoryNoMemoriesStored' {
	return query || pinned !== 'all' || tier !== 'all' ? 'memoryNoResults' : 'memoryNoMemoriesStored';
}

export type KnoxMemorySettingKind = 'toggle' | 'number' | 'select' | 'text';

export interface IKnoxGuiMemorySettingField {
	key: string;
	labelKey: string;
	descKey?: string;
	kind: KnoxMemorySettingKind;
	min?: number;
	max?: number;
	step?: number;
	percent?: boolean;
	/** `FloatSetting`: wider (`w-24`) input with no suffix. */
	float?: boolean;
	suffixKey?: string;
	sectionKey?: string;
	options?: Array<{ value: string; labelKey: string }>;
}

export interface IKnoxGuiMemorySettingGroup {
	titleKey: string;
	fields: IKnoxGuiMemorySettingField[];
	collapsed?: boolean;
	descKey?: string;
}

/** Core `brain/updateConfig` only accepts `{ key, value: string }`. */
export function memoryConfigUpdatePayload(key: string, value: unknown): { key: string; value: string } {
	return { key, value: String(value) };
}

export function hitTestMemoryGraph(nodes: Array<{ id: number; x: number; y: number }>, x: number, y: number, radius = 14): number | undefined {
	let best: { id: number; dist: number } | undefined;
	for (const node of nodes) {
		const dist = Math.hypot(node.x - x, node.y - y);
		if (dist <= radius && (!best || dist < best.dist)) {
			best = { id: node.id, dist };
		}
	}
	return best?.id;
}

export const MEMORY_TREND_COLORS: Record<string, string> = {
	improving: '#22c55e',
	stable: '#6b7280',
	degrading: '#ef4444',
	growing: '#3b82f6',
	shrinking: '#f59e0b',
	accelerating: '#8b5cf6',
};

export const MEMORY_SETTING_GROUPS: IKnoxGuiMemorySettingGroup[] = [
	{
		titleKey: 'memoryGeneralSettings',
		fields: [
			{ key: 'auto_extract_enabled', labelKey: 'memoryAutoMemory', descKey: 'memoryAutoMemoryDesc', kind: 'toggle' },
			{ key: 'consolidation_interval_hours', labelKey: 'memoryConsolidationInterval', descKey: 'memoryConsolidationIntervalDesc', kind: 'number', min: 1, max: 168, suffixKey: 'memoryHoursSuffix' },
		],
	},
	{
		titleKey: 'memoryEbbinghausSettings',
		fields: [
			{ key: 'ebbinghaus_base_strength', labelKey: 'memoryEbbinghausBaseStrength', descKey: 'memoryEbbinghausBaseStrengthDesc', kind: 'number', min: 0.1, max: 30, step: 0.1 },
			{ key: 'ebbinghaus_lambda', labelKey: 'memoryEbbinghausLambda', descKey: 'memoryEbbinghausLambdaDesc', kind: 'number', min: 0.01, max: 1, step: 0.01, float: true },
			{ key: 'ebbinghaus_prune_threshold', labelKey: 'memoryEbbinghausPruneThreshold', descKey: 'memoryEbbinghausPruneThresholdDesc', kind: 'number', min: 0.05, max: 0.5, percent: true },
			{ key: 'ebbinghaus_review_threshold', labelKey: 'memoryEbbinghausReviewThreshold', descKey: 'memoryEbbinghausReviewThresholdDesc', kind: 'number', min: 0.1, max: 0.9, percent: true },
			{ key: 'ebbinghaus_strengthening_alpha', labelKey: 'memoryEbbinghausStrengtheningAlpha', descKey: 'memoryEbbinghausStrengtheningAlphaDesc', kind: 'number', min: 0, max: 0.5, step: 0.01, float: true },
			{ key: 'ebbinghaus_repetition_beta', labelKey: 'memoryEbbinghausRepetitionBeta', descKey: 'memoryEbbinghausRepetitionBetaDesc', kind: 'number', min: 0, max: 0.5, step: 0.01, float: true },
			{ key: 'ebbinghaus_salience_weight', labelKey: 'memoryEbbinghausSalienceWeight', descKey: 'memoryEbbinghausSalienceWeightDesc', kind: 'number', min: 0, max: 2, step: 0.1 },
			{ key: 'ebbinghaus_importance_weight', labelKey: 'memoryEbbinghausImportanceWeight', descKey: 'memoryEbbinghausImportanceWeightDesc', kind: 'number', min: 0, max: 2, step: 0.1 },
		],
	},
	{
		titleKey: 'memoryCapacitySettings',
		fields: [
			{ key: 'max_hot_memories', labelKey: 'memoryMaxHot', descKey: 'memoryMaxHotDesc', kind: 'number', min: 100, max: 10000 },
			{ key: 'max_episodic_per_session', labelKey: 'memoryMaxEpisodic', descKey: 'memoryMaxEpisodicDesc', kind: 'number', min: 100, max: 10000 },
			{ key: 'context_max_tokens', labelKey: 'memoryContextTokens', descKey: 'memoryContextTokensDesc', kind: 'number', min: 1000, max: 10000000 },
			{
				key: 'memory_mode', labelKey: 'memoryMode', descKey: 'memoryModeDesc', kind: 'select', options: [
					{ value: 'summarized', labelKey: 'memoryModeSummarized' },
					{ value: 'full', labelKey: 'memoryModeFull' },
					{ value: 'selective', labelKey: 'memoryModeSelective' },
				]
			},
			{ key: 'retrieval_threshold', labelKey: 'memoryRetrievalThreshold', descKey: 'memoryRetrievalThresholdDesc', kind: 'number', min: 0.1, max: 0.95, percent: true },
			{ key: 'retrieval_top_k', labelKey: 'memoryRetrievalTopK', descKey: 'memoryRetrievalTopKDesc', kind: 'number', min: 5, max: 100 },
			{ key: 'enable_enhanced_semantic', labelKey: 'memoryEnhancedSemantic', descKey: 'memoryEnhancedSemanticDesc', kind: 'toggle' },
			{ key: 'max_context_tokens', labelKey: 'memoryMaxContextTokens', descKey: 'memoryMaxContextTokensDesc', kind: 'number', min: 1000, max: 10000000 },
			{ key: 'context_goal_budget_ratio', labelKey: 'memoryGoalBudgetRatio', descKey: 'memoryGoalBudgetRatioDesc', kind: 'number', min: 0.05, max: 0.3, percent: true },
		],
	},
	{
		titleKey: 'memoryPrecisionSettings',
		fields: [
			{ key: 'retrieval_require_lexical', labelKey: 'memoryRequireLexical', descKey: 'memoryRequireLexicalDesc', kind: 'toggle' },
			{ key: 'retrieval_continuation_expand', labelKey: 'memoryContinuationExpand', descKey: 'memoryContinuationExpandDesc', kind: 'toggle' },
			{ key: 'fts5_use_and_for_content', labelKey: 'memoryFts5AndContent', descKey: 'memoryFts5AndContentDesc', kind: 'toggle' },
			{ key: 'topic_shift_jaccard', labelKey: 'memoryTopicShiftJaccard', descKey: 'memoryTopicShiftJaccardDesc', kind: 'number', min: 0.1, max: 0.8, percent: true },
			{ key: 'wm_mismatch_decay', labelKey: 'memoryWmMismatchDecay', descKey: 'memoryWmMismatchDecayDesc', kind: 'number', min: 0.05, max: 0.8, percent: true },
			{ key: 'wm_inject_min_relevance', labelKey: 'memoryWmInjectMinRelevance', descKey: 'memoryWmInjectMinRelevanceDesc', kind: 'number', min: 0.1, max: 0.8, percent: true },
			{ key: 'summary_inject_min_overlap', labelKey: 'memorySummaryInjectMinOverlap', descKey: 'memorySummaryInjectMinOverlapDesc', kind: 'number', min: 0.05, max: 0.8, percent: true },
			{ key: 'pinned_unmatched_cap', labelKey: 'memoryPinnedUnmatchedCap', descKey: 'memoryPinnedUnmatchedCapDesc', kind: 'number', min: 0, max: 10 },
		],
	},
	{
		titleKey: 'memoryWorkingMemorySettings',
		fields: [
			{ key: 'working_memory_max_slots', labelKey: 'memoryWorkingMemorySlots', descKey: 'memoryWorkingMemorySlotsDesc', kind: 'number', min: 3, max: 15 },
			{ key: 'working_memory_token_ratio', labelKey: 'memoryWorkingMemoryTokenRatio', descKey: 'memoryWorkingMemoryTokenRatioDesc', kind: 'number', min: 0.05, max: 0.5, percent: true },
			{ key: 'working_memory_token_budget', labelKey: 'memoryWorkingMemoryTokenBudget', descKey: 'memoryWorkingMemoryTokenBudgetDesc', kind: 'number', min: 0, max: 30000 },
			{ key: 'working_memory_decay_rate', labelKey: 'memoryWorkingMemoryDecay', descKey: 'memoryWorkingMemoryDecayDesc', kind: 'number', min: 0.0001, max: 0.01, step: 0.0001, float: true },
			{ key: 'working_memory_ttl_seconds', labelKey: 'memoryWorkingMemoryTtl', descKey: 'memoryWorkingMemoryTtlDesc', kind: 'number', min: 5, max: 120 },
			{ key: 'sensory_buffer_ms', labelKey: 'memorySensoryBufferMs', descKey: 'memorySensoryBufferMsDesc', kind: 'number', min: 100, max: 2000 },
		],
	},
	{
		titleKey: 'memoryTaskRoutingSettings',
		fields: [
			{ key: 'easy_model', labelKey: 'memoryEasyModel', descKey: 'memoryEasyModelDesc', kind: 'text' },
			{ key: 'medium_model', labelKey: 'memoryMediumModel', descKey: 'memoryMediumModelDesc', kind: 'text' },
			{ key: 'hard_model', labelKey: 'memoryHardModel', descKey: 'memoryHardModelDesc', kind: 'text' },
			{ key: 'autonomous_max_iterations', labelKey: 'memoryAutonomousMaxIterations', descKey: 'memoryAutonomousMaxIterationsDesc', kind: 'number', min: 0, max: 50 },
		],
	},
	{
		titleKey: 'memoryContextAssemblySettings',
		collapsed: true,
		fields: [
			{ key: 'context_graph_entity_search', labelKey: 'memoryGraphEntitySearch', descKey: 'memoryGraphEntitySearchDesc', kind: 'number', min: 3, max: 50 },
			{ key: 'context_graph_entity_display', labelKey: 'memoryGraphEntityDisplay', descKey: 'memoryGraphEntityDisplayDesc', kind: 'number', min: 1, max: 20 },
			{ key: 'context_graph_edge_per_entity', labelKey: 'memoryGraphEdgePerEntity', descKey: 'memoryGraphEdgePerEntityDesc', kind: 'number', min: 1, max: 10 },
			{ key: 'context_graph_edge_budget_ratio', labelKey: 'memoryGraphEdgeBudgetRatio', descKey: 'memoryGraphEdgeBudgetRatioDesc', kind: 'number', min: 0.3, max: 1, percent: true },
			{ key: 'context_procedure_limit', labelKey: 'memoryProcedureLimit', descKey: 'memoryProcedureLimitDesc', kind: 'number', min: 1, max: 20 },
			{ key: 'context_pattern_limit', labelKey: 'memoryPatternLimit', descKey: 'memoryPatternLimitDesc', kind: 'number', min: 1, max: 20 },
			{ key: 'context_pinned_limit', labelKey: 'memoryPinnedLimit', descKey: 'memoryPinnedLimitDesc', kind: 'number', min: 1, max: 50 },
			{ key: 'context_line_compress_chars', labelKey: 'memoryLineCompressChars', descKey: 'memoryLineCompressCharsDesc', kind: 'number', min: 100, max: 1000 },
			{ key: 'context_compress_keep_lines', labelKey: 'memoryCompressKeepLines', descKey: 'memoryCompressKeepLinesDesc', kind: 'number', min: 1, max: 10 },
		],
	},
	{
		titleKey: 'memoryModeTuningSettings',
		collapsed: true,
		fields: [
			{ key: 'mode_summarized_semantic_multiplier', labelKey: 'memoryModeSemanticMultiplier', descKey: 'memoryModeSemanticMultiplierDesc', kind: 'number', min: 0.25, max: 2, percent: true, sectionKey: 'memoryModeSummarized' },
			{ key: 'mode_summarized_episodic_multiplier', labelKey: 'memoryModeEpisodicMultiplier', descKey: 'memoryModeEpisodicMultiplierDesc', kind: 'number', min: 0.25, max: 2, percent: true, sectionKey: 'memoryModeSummarized' },
			{ key: 'mode_summarized_min_importance', labelKey: 'memoryModeMinImportance', descKey: 'memoryModeMinImportanceDesc', kind: 'number', min: 0, max: 1, percent: true, sectionKey: 'memoryModeSummarized' },
			{ key: 'mode_summarized_episodic_snippet_len', labelKey: 'memoryModeEpisodicSnippetLen', descKey: 'memoryModeEpisodicSnippetLenDesc', kind: 'number', min: 50, max: 800, sectionKey: 'memoryModeSummarized' },
			{ key: 'mode_full_semantic_multiplier', labelKey: 'memoryModeSemanticMultiplier', descKey: 'memoryModeSemanticMultiplierDesc', kind: 'number', min: 0.25, max: 2, percent: true, sectionKey: 'memoryModeFull' },
			{ key: 'mode_full_episodic_multiplier', labelKey: 'memoryModeEpisodicMultiplier', descKey: 'memoryModeEpisodicMultiplierDesc', kind: 'number', min: 0.25, max: 3, percent: true, sectionKey: 'memoryModeFull' },
			{ key: 'mode_full_episodic_snippet_len', labelKey: 'memoryModeEpisodicSnippetLen', descKey: 'memoryModeEpisodicSnippetLenDesc', kind: 'number', min: 100, max: 1000, sectionKey: 'memoryModeFull' },
			{ key: 'mode_selective_semantic_multiplier', labelKey: 'memoryModeSemanticMultiplier', descKey: 'memoryModeSemanticMultiplierDesc', kind: 'number', min: 0.1, max: 1.5, percent: true, sectionKey: 'memoryModeSelective' },
			{ key: 'mode_selective_min_importance', labelKey: 'memoryModeMinImportance', descKey: 'memoryModeMinImportanceDesc', kind: 'number', min: 0.5, max: 1, percent: true, sectionKey: 'memoryModeSelective' },
			{ key: 'mode_selective_include_episodic', labelKey: 'memorySelectiveIncludeEpisodic', descKey: 'memorySelectiveIncludeEpisodicDesc', kind: 'toggle', sectionKey: 'memoryModeSelective' },
			{ key: 'mode_selective_include_procedures', labelKey: 'memorySelectiveIncludeProcedures', descKey: 'memorySelectiveIncludeProceduresDesc', kind: 'toggle', sectionKey: 'memoryModeSelective' },
			{ key: 'mode_selective_include_patterns', labelKey: 'memorySelectiveIncludePatterns', descKey: 'memorySelectiveIncludePatternsDesc', kind: 'toggle', sectionKey: 'memoryModeSelective' },
		],
	},
	{
		titleKey: 'memoryBudgetSettings',
		collapsed: true,
		fields: [
			{ key: 'budget_semantic_ratio', labelKey: 'memoryBudgetSemantic', descKey: 'memoryBudgetSemanticDesc', kind: 'number', min: 0.1, max: 0.7, percent: true },
			{ key: 'budget_episodic_ratio', labelKey: 'memoryBudgetEpisodic', descKey: 'memoryBudgetEpisodicDesc', kind: 'number', min: 0.05, max: 0.5, percent: true },
			{ key: 'budget_graph_ratio', labelKey: 'memoryBudgetGraph', descKey: 'memoryBudgetGraphDesc', kind: 'number', min: 0.05, max: 0.4, percent: true },
			{ key: 'budget_procedures_ratio', labelKey: 'memoryBudgetProcedures', descKey: 'memoryBudgetProceduresDesc', kind: 'number', min: 0.05, max: 0.4, percent: true },
			{ key: 'budget_patterns_ratio', labelKey: 'memoryBudgetPatterns', descKey: 'memoryBudgetPatternsDesc', kind: 'number', min: 0.05, max: 0.4, percent: true },
		],
	},
	{
		titleKey: 'memoryFusionSettings',
		collapsed: true,
		descKey: 'memoryFusionWeightProfilesDesc',
		fields: [
			{ key: 'fusion_candidate_multiplier', labelKey: 'memoryFusionCandidateMultiplier', descKey: 'memoryFusionCandidateMultiplierDesc', kind: 'number', min: 2, max: 20 },
			{ key: 'fusion_candidate_min', labelKey: 'memoryFusionCandidateMin', descKey: 'memoryFusionCandidateMinDesc', kind: 'number', min: 10, max: 200 },
			{ key: 'recency_decay_lambda', labelKey: 'memoryRecencyDecayLambda', descKey: 'memoryRecencyDecayLambdaDesc', kind: 'number', min: 0.001, max: 0.02, step: 0.0001, float: true },
			{ key: 'graph_depth_decay_gamma', labelKey: 'memoryGraphDepthDecayGamma', descKey: 'memoryGraphDepthDecayGammaDesc', kind: 'number', min: 0.3, max: 0.95, percent: true },
			{ key: 'graph_memory_boost_factor', labelKey: 'memoryGraphMemoryBoost', descKey: 'memoryGraphMemoryBoostDesc', kind: 'number', min: 0.1, max: 0.8, percent: true },
			{ key: 'graph_neighbor_limit', labelKey: 'memoryGraphNeighborLimit', descKey: 'memoryGraphNeighborLimitDesc', kind: 'number', min: 3, max: 50 },
		],
	},
	{
		titleKey: 'memoryCompressionSettings',
		collapsed: true,
		descKey: 'memoryCompressionSettingsDesc',
		fields: [
			{ key: 'compression_ratio_hot', labelKey: 'memoryCompressionHot', descKey: 'memoryCompressionHotDesc', kind: 'number', min: 0.05, max: 1, percent: true },
			{ key: 'compression_ratio_warm', labelKey: 'memoryCompressionWarm', descKey: 'memoryCompressionWarmDesc', kind: 'number', min: 0.05, max: 1, percent: true },
			{ key: 'compression_ratio_cold', labelKey: 'memoryCompressionCold', descKey: 'memoryCompressionColdDesc', kind: 'number', min: 0.05, max: 1, percent: true },
			{ key: 'compression_ratio_frozen', labelKey: 'memoryCompressionFrozen', descKey: 'memoryCompressionFrozenDesc', kind: 'number', min: 0.05, max: 1, percent: true },
		],
	},
	{
		titleKey: 'memoryIntegrationSettings',
		collapsed: true,
		fields: [
			{ key: 'memory_build_timeout_ms', labelKey: 'memoryBuildTimeout', descKey: 'memoryBuildTimeoutDesc', kind: 'number', min: 1000, max: 30000, suffixKey: 'memoryMsSuffix' },
			{ key: 'memory_track_session_timeout_ms', labelKey: 'memoryTrackSessionTimeout', descKey: 'memoryTrackSessionTimeoutDesc', kind: 'number', min: 500, max: 10000, suffixKey: 'memoryMsSuffix' },
		],
	},
	{
		titleKey: 'memoryGraphSettings',
		fields: [
			{ key: 'graph_max_entities', labelKey: 'memoryGraphMaxEntities', descKey: 'memoryGraphMaxEntitiesDesc', kind: 'number', min: 500, max: 10000 },
			{ key: 'graph_max_depth', labelKey: 'memoryGraphMaxDepth', descKey: 'memoryGraphMaxDepthDesc', kind: 'number', min: 1, max: 5 },
			{
				key: 'memory_scope', labelKey: 'memoryScope', descKey: 'memoryScopeDesc', kind: 'select', options: [
					{ value: 'project', labelKey: 'memoryScopeProject' },
					{ value: 'global', labelKey: 'memoryScopeGlobal' },
				]
			},
			{ key: 'enable_knowledge_extraction', labelKey: 'memoryKnowledgeExtraction', descKey: 'memoryKnowledgeExtractionDesc', kind: 'toggle' },
			{ key: 'post_turn_min_chars', labelKey: 'memoryPostTurnMinChars', descKey: 'memoryPostTurnMinCharsDesc', kind: 'number', min: 20, max: 2000 },
			{ key: 'auto_summarize', labelKey: 'memoryAutoSummarize', descKey: 'memoryAutoSummarizeDesc', kind: 'toggle' },
			{ key: 'summarize_threshold', labelKey: 'memorySummarizeThreshold', descKey: 'memorySummarizeThresholdDesc', kind: 'number', min: 10, max: 500 },
		],
	},
	{
		titleKey: 'memoryTieringSettings',
		fields: [
			{ key: 'hot_to_warm_hours', labelKey: 'memoryHotToWarm', descKey: 'memoryHotToWarmDesc', kind: 'number', min: 1, max: 720, suffixKey: 'memoryHoursSuffix' },
			{ key: 'warm_to_cold_days', labelKey: 'memoryWarmToCold', descKey: 'memoryWarmToColdDesc', kind: 'number', min: 1, max: 365, suffixKey: 'memoryDaysSuffix' },
			{ key: 'cold_prune_days', labelKey: 'memoryColdPrune', descKey: 'memoryColdPruneDesc', kind: 'number', min: 7, max: 3650, suffixKey: 'memoryDaysSuffix' },
		],
	},
	{
		titleKey: 'memoryFeatureSettings',
		fields: [
			{ key: 'graph_enabled', labelKey: 'memoryGraphEnabled', descKey: 'memoryGraphEnabledDesc', kind: 'toggle' },
			{ key: 'learning_enabled', labelKey: 'memoryLearningEnabled', descKey: 'memoryLearningEnabledDesc', kind: 'toggle' },
			{ key: 'llm_entity_extraction_enabled', labelKey: 'memoryLlmExtraction', descKey: 'memoryLlmExtractionDesc', kind: 'toggle' },
			{ key: 'llm_summarization_enabled', labelKey: 'memoryLlmSummarization', descKey: 'memoryLlmSummarizationDesc', kind: 'toggle' },
			{ key: 'llm_importance_scoring_enabled', labelKey: 'memoryLlmImportance', descKey: 'memoryLlmImportanceDesc', kind: 'toggle' },
			{ key: 'llm_post_action_memory_enabled', labelKey: 'memoryLlmPostAction', descKey: 'memoryLlmPostActionDesc', kind: 'toggle' },
		],
	},
];

/** `MemorySettings.tsx` `DEFAULT_CONFIG`; `brain/getConfig` values override it. */
export const MEMORY_DEFAULT_CONFIG: Readonly<Record<string, string | number | boolean>> = {
	auto_extract_enabled: true, consolidation_interval_hours: 24, max_hot_memories: 500, max_episodic_per_session: 1000,
	context_max_tokens: 10_000_000, max_context_tokens: 10_000_000, context_goal_budget_ratio: 0.1, memory_mode: 'summarized',
	retrieval_threshold: 0.6, retrieval_top_k: 20, retrieval_require_lexical: true, retrieval_continuation_expand: true,
	fts5_use_and_for_content: true, topic_shift_jaccard: 0.35, wm_mismatch_decay: 0.25, wm_inject_min_relevance: 0.35,
	summary_inject_min_overlap: 0.2, pinned_unmatched_cap: 2, graph_max_entities: 5000, graph_max_depth: 3, memory_scope: 'project',
	auto_summarize: true, summarize_threshold: 50, enable_knowledge_extraction: true, post_turn_min_chars: 80,
	hot_to_warm_hours: 24, warm_to_cold_days: 7, cold_prune_days: 90, graph_enabled: true, learning_enabled: true,
	llm_entity_extraction_enabled: true, llm_summarization_enabled: true, llm_importance_scoring_enabled: true, llm_post_action_memory_enabled: true,
	working_memory_max_slots: 7, working_memory_token_budget: 30000, working_memory_token_ratio: 0.125, working_memory_decay_rate: 0.001,
	working_memory_ttl_seconds: 30, easy_model: '', medium_model: '', hard_model: '', autonomous_max_iterations: 0,
	mode_full_semantic_multiplier: 1.25, mode_full_episodic_multiplier: 2.0, mode_full_min_importance: 0, mode_full_episodic_snippet_len: 400,
	mode_summarized_semantic_multiplier: 0.75, mode_summarized_episodic_multiplier: 0.75, mode_summarized_min_importance: 0.3, mode_summarized_episodic_snippet_len: 150,
	mode_selective_semantic_multiplier: 0.5, mode_selective_episodic_multiplier: 0.25, mode_selective_min_importance: 0.7, mode_selective_episodic_snippet_len: 200,
	mode_selective_include_episodic: false, mode_selective_include_procedures: false, mode_selective_include_patterns: false,
	context_graph_entity_search: 10, context_graph_entity_display: 5, context_graph_edge_per_entity: 3, context_graph_edge_budget_ratio: 0.7,
	context_procedure_limit: 5, context_pattern_limit: 3, context_pinned_limit: 10, context_session_summary_min_tokens: 200,
	context_line_truncate_chars: 300, context_line_compress_chars: 200, context_compress_keep_lines: 3,
	budget_semantic_ratio: 0.40, budget_episodic_ratio: 0.25, budget_graph_ratio: 0.15, budget_procedures_ratio: 0.10, budget_patterns_ratio: 0.10,
	fusion_candidate_multiplier: 5, fusion_candidate_min: 50, graph_depth_decay_gamma: 0.7, graph_memory_boost_factor: 0.3,
	graph_entity_search_limit: 5, graph_neighbor_limit: 10, recency_decay_lambda: 0.004125,
	compression_ratio_active: 1.0, compression_ratio_hot: 0.5, compression_ratio_warm: 0.2, compression_ratio_cold: 0.1, compression_ratio_frozen: 0.05,
	memory_build_timeout_ms: 5000, memory_track_session_timeout_ms: 1500,
	ebbinghaus_base_strength: 1.0, ebbinghaus_lambda: 0.03, ebbinghaus_prune_threshold: 0.1, ebbinghaus_review_threshold: 0.5,
	ebbinghaus_strengthening_alpha: 0.1, ebbinghaus_repetition_beta: 0.1, ebbinghaus_salience_weight: 0.5, ebbinghaus_importance_weight: 0.3,
	sensory_buffer_ms: 250, enable_enhanced_semantic: false,
};

export function withMemoryConfigDefaults(config: Record<string, unknown>): Record<string, unknown> {
	return { ...MEMORY_DEFAULT_CONFIG, ...config };
}

/**
 * `NumberSetting` / `DecimalSetting` / `FloatSetting` commit: percent fields take whole percents, `step` fields
 * take floats, the rest take integers. Out-of-range or non-numeric input returns `undefined` (the field reverts).
 */
export function parseMemorySettingInput(field: Pick<IKnoxGuiMemorySettingField, 'min' | 'max' | 'step' | 'percent'>, raw: string): number | undefined {
	const min = field.min ?? 0;
	const max = field.max ?? Number.MAX_SAFE_INTEGER;
	if (field.percent) {
		const pct = parseInt(raw, 10);
		if (Number.isNaN(pct)) {
			return undefined;
		}
		const ratio = pct / 100;
		return ratio >= min && ratio <= max ? Math.round(ratio * 1000) / 1000 : undefined;
	}
	const value = field.step != null ? parseFloat(raw) : parseInt(raw, 10);
	return !Number.isNaN(value) && value >= min && value <= max ? value : undefined;
}

/** `MemorySettings.tsx` consolidate result: non-zero promoted / demoted / pruned / merged counts. */
export function memoryConsolidateParts(result: unknown): string[] | undefined {
	const rec = asRecord(result);
	if (!rec) {
		return undefined;
	}
	const parts: string[] = [];
	for (const key of ['promoted', 'demoted', 'pruned', 'merged'] as const) {
		const count = Number(rec[key] ?? 0);
		if (count > 0) {
			parts.push(`${count} ${key}`);
		}
	}
	return parts;
}

export function healthStatusColor(status: string | undefined): string {
	return MEMORY_STATUS_COLORS[status ?? ''] ?? '#6b7280';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function asNumberRecord(value: unknown): Record<string, number> {
	const rec = asRecord(value);
	if (!rec) {
		return {};
	}
	const out: Record<string, number> = {};
	for (const [key, item] of Object.entries(rec)) {
		if (typeof item === 'number') {
			out[key] = item;
		}
	}
	return out;
}
