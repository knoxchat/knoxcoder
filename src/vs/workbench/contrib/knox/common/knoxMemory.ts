/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { knoxFormatBytes } from './knoxCheckpoints.js';
import { knoxProtocolObject, knoxUnwrapProtocol } from './knoxGuiProtocol.js';
import { knoxNls } from './knoxI18n.js';

/** Must match core MEMORY_CONTEXT_TOKEN_CEILING. */
export const KNOX_MEMORY_CONTEXT_TOKEN_CEILING = 10_000_000;

export const KNOX_MEMORY_BROWSER_PAGE_SIZE = 50;

export const KNOX_MEMORY_TABS = ['overview', 'browser', 'sessions', 'graph', 'settings'] as const;
export type KnoxMemoryPanelTab = typeof KNOX_MEMORY_TABS[number];

/**
 * `brain/*` and `memory/*` names used by the GUI memory surfaces and chat
 * memory injection. Do not invent new protocol names (T8.7).
 */
export const KNOX_MEMORY_PROTOCOL = {
	dashboard: 'brain/dashboard',
	getEffectiveContext: 'brain/getEffectiveContext',
	getMetricsTrend: 'brain/getMetricsTrend',
	getPhaseStatus: 'brain/getPhaseStatus',
	getReviewDue: 'brain/getReviewDue',
	getEbbinghausStats: 'brain/getEbbinghausStats',
	consolidate: 'brain/consolidate',
	searchMemories: 'brain/searchMemories',
	deleteMemory: 'brain/deleteMemory',
	deleteMemories: 'brain/deleteMemories',
	pinMemory: 'brain/pinMemory',
	unpinMemory: 'brain/unpinMemory',
	pinMemories: 'brain/pinMemories',
	unpinMemories: 'brain/unpinMemories',
	mismatchMemory: 'brain/mismatchMemory',
	listSessions: 'brain/listSessions',
	getSessionHistory: 'brain/getSessionHistory',
	searchBacklogs: 'brain/searchBacklogs',
	searchEntities: 'brain/searchEntities',
	graphStats: 'brain/graphStats',
	exploreGraph: 'brain/exploreGraph',
	getConfig: 'brain/getConfig',
	updateConfig: 'brain/updateConfig',
	optimize: 'brain/optimize',
	heal: 'brain/heal',
	export: 'brain/export',
	import: 'brain/import',
	dispatch: 'brain/dispatch',
	store: 'brain/store',
	trackSession: 'brain/trackSession',
	recordMessage: 'brain/recordMessage',
	recordSoulEvent: 'brain/recordSoulEvent',
	runAutonomousLoop: 'brain/runAutonomousLoop',
	cancelAutonomousLoop: 'brain/cancelAutonomousLoop',
	resolveAutonomousTool: 'brain/resolveAutonomousTool',
	buildContext: 'memory/buildContext',
	postTurn: 'memory/postTurn',
} as const;

export type KnoxMemoryProtocolName = typeof KNOX_MEMORY_PROTOCOL[keyof typeof KNOX_MEMORY_PROTOCOL];

export interface IKnoxMemoryItem {
	id: number;
	category: string;
	title: string;
	content: string;
	keywords: string;
	importance_score: number;
	retrieval_count: number;
	tier: string;
	created_at: string;
	last_accessed_at: string | null;
	source_session_id: string | null;
	pinned?: boolean;
}

export type KnoxMemorySortBy = 'recent' | 'importance' | 'accessed';
export type KnoxMemoryPinnedFilter = 'all' | 'pinned' | 'unpinned';

export interface IKnoxMemoryDateSection {
	headerKey: 'today' | 'thisWeek' | 'thisMonth' | 'memoryEarlier';
	memories: IKnoxMemoryItem[];
}

export interface IKnoxMemoryStats {
	total_sessions: number;
	total_episodic: number;
	total_semantic: number;
	total_associations: number;
	total_entities: number;
	total_edges: number;
	total_patterns: number;
	total_procedures: number;
	total_tags: number;
	total_collections: number;
	tier_counts: { hot: number; warm: number; cold: number };
	category_counts: Record<string, number>;
	entity_type_counts: Record<string, number>;
	oldest_memory: string | null;
	newest_memory: string | null;
	db_size_bytes: number;
}

export interface IKnoxMemoryHealth {
	status: string;
	db_size_bytes: number;
	total_memories: number;
	fragmentation_ratio: number;
	oldest_unaccessed_days: number;
	issues: string[];
	recommendations: string[];
}

export interface IKnoxMemoryGraphStats {
	total_entities: number;
	total_edges: number;
	entity_types: Record<string, number>;
	max_entities?: number;
	cap_utilization?: number;
	at_cap?: boolean;
	max_depth?: number;
	depth_decay_gamma?: number;
}

export interface IKnoxMemoryDashboardSession {
	id: string;
	title?: string;
	message_count?: number;
	updated_at?: string;
	created_at?: string;
}

export interface IKnoxMemoryDashboard {
	stats: IKnoxMemoryStats;
	health: IKnoxMemoryHealth;
	graphStats: IKnoxMemoryGraphStats | null;
	sessions: IKnoxMemoryDashboardSession[];
	healthScore: { overall: number; grade: string; score?: number } | null;
	consolidation: {
		total_runs: number;
		last_run_at: string | null;
		avg_duration_ms: number;
		last_sub_phases?: Record<string, number> | null;
	} | null;
}

export interface IKnoxMemoryLevel {
	id: string;
	name: string;
	tokens: number;
	ratio: number;
	effective_tokens: number;
}

export interface IKnoxEffectiveContext {
	active_window_tokens: number;
	last_context_tokens_used?: number;
	window_utilization?: number;
	tier_tokens: Record<string, number>;
	hierarchy_effective_tokens: number;
	memory_levels?: IKnoxMemoryLevel[];
	working_memory_budget?: number;
	graph_entity_count: number;
	graph_max_entities?: number;
	total_effective: number;
	compression_ratios: Record<string, number>;
	memory_tokens_saved?: number;
}

export interface IKnoxMetricsTrend {
	snapshots: Array<{
		avg_response_ms: number;
		success_rate: number;
		memory_count: number;
		memory_tokens_saved?: number;
		total_effective?: number;
	}>;
	period_hours: number;
	avg_response_trend: string;
	success_rate_trend: string;
	growth_rate_trend: string;
	compression_trend?: string;
	effective_context_trend?: string;
}

export interface IKnoxPhaseStatus {
	active_phase: string | null;
	last_completed: { phase: string; at: number } | null;
	phase_counts: Record<string, number>;
	cycle_invariant_met: boolean;
	background_sleep_active: boolean;
}

export interface IKnoxReviewDueItem {
	memory_id: number;
	category: string;
	title: string;
	current_retention: number;
	overdue: boolean;
}

export interface IKnoxEbbinghausStats {
	config: { lambda: number };
	review_due_count: number;
	avg_retention: number;
}

export interface IKnoxBrainSession {
	id: string;
	title: string;
	created_at: string;
	updated_at: string;
	message_count: number;
	summary: string | null;
	is_active: boolean;
}

export interface IKnoxSessionHistory {
	episodic: Array<{ id: number; role: string; content: string; created_at: string }>;
	semantic: Array<{ id: number; category: string; title: string; content: string }>;
	topics: Array<{ topic: string }>;
	token_estimate: number;
	message_count: number;
}

export interface IKnoxBacklogMatch {
	id: number;
	session_id?: string;
	source_session_id?: string;
	role?: string;
	category?: string;
	title?: string;
	content: string;
	kind: 'episodic' | 'semantic';
}

export interface IKnoxGraphEntity {
	id: number;
	name: string;
	entity_type: string;
	description: string | null;
	mention_count: number;
}

export interface IKnoxGraphEdge {
	id: number;
	source_entity_id: number;
	target_entity_id: number;
	relationship: string;
	weight: number;
}

export interface IKnoxExploreResult {
	center: IKnoxGraphEntity;
	entities: IKnoxGraphEntity[];
	edges: IKnoxGraphEdge[];
	depth_reached: number;
}

export interface IKnoxMemoryConfig {
	auto_extract_enabled: boolean;
	consolidation_interval_hours: number;
	max_hot_memories: number;
	max_episodic_per_session: number;
	context_max_tokens: number;
	max_context_tokens: number;
	context_goal_budget_ratio: number;
	memory_mode: 'full' | 'summarized' | 'selective';
	retrieval_threshold: number;
	retrieval_top_k: number;
	retrieval_require_lexical: boolean;
	retrieval_continuation_expand: boolean;
	fts5_use_and_for_content: boolean;
	topic_shift_jaccard: number;
	wm_mismatch_decay: number;
	wm_inject_min_relevance: number;
	summary_inject_min_overlap: number;
	pinned_unmatched_cap: number;
	graph_max_entities: number;
	graph_max_depth: number;
	memory_scope: 'project' | 'global';
	auto_summarize: boolean;
	summarize_threshold: number;
	enable_knowledge_extraction: boolean;
	post_turn_min_chars: number;
	hot_to_warm_hours: number;
	warm_to_cold_days: number;
	cold_prune_days: number;
	graph_enabled: boolean;
	learning_enabled: boolean;
	llm_entity_extraction_enabled: boolean;
	llm_summarization_enabled: boolean;
	llm_importance_scoring_enabled: boolean;
	llm_post_action_memory_enabled: boolean;
	working_memory_max_slots: number;
	working_memory_token_budget: number;
	working_memory_token_ratio: number;
	working_memory_decay_rate: number;
	working_memory_ttl_seconds: number;
	easy_model: string;
	medium_model: string;
	hard_model: string;
	autonomous_max_iterations: number;
	mode_full_semantic_multiplier: number;
	mode_full_episodic_multiplier: number;
	mode_full_min_importance: number;
	mode_full_episodic_snippet_len: number;
	mode_summarized_semantic_multiplier: number;
	mode_summarized_episodic_multiplier: number;
	mode_summarized_min_importance: number;
	mode_summarized_episodic_snippet_len: number;
	mode_selective_semantic_multiplier: number;
	mode_selective_episodic_multiplier: number;
	mode_selective_min_importance: number;
	mode_selective_episodic_snippet_len: number;
	mode_selective_include_episodic: boolean;
	mode_selective_include_procedures: boolean;
	mode_selective_include_patterns: boolean;
	context_graph_entity_search: number;
	context_graph_entity_display: number;
	context_graph_edge_per_entity: number;
	context_graph_edge_budget_ratio: number;
	context_procedure_limit: number;
	context_pattern_limit: number;
	context_pinned_limit: number;
	context_line_compress_chars: number;
	context_compress_keep_lines: number;
	budget_semantic_ratio: number;
	budget_episodic_ratio: number;
	budget_graph_ratio: number;
	budget_procedures_ratio: number;
	budget_patterns_ratio: number;
	fusion_candidate_multiplier: number;
	fusion_candidate_min: number;
	graph_depth_decay_gamma: number;
	graph_memory_boost_factor: number;
	graph_neighbor_limit: number;
	recency_decay_lambda: number;
	compression_ratio_hot: number;
	compression_ratio_warm: number;
	compression_ratio_cold: number;
	compression_ratio_frozen: number;
	memory_build_timeout_ms: number;
	memory_track_session_timeout_ms: number;
	ebbinghaus_base_strength: number;
	ebbinghaus_lambda: number;
	ebbinghaus_prune_threshold: number;
	ebbinghaus_review_threshold: number;
	ebbinghaus_strengthening_alpha: number;
	ebbinghaus_repetition_beta: number;
	ebbinghaus_salience_weight: number;
	ebbinghaus_importance_weight: number;
	sensory_buffer_ms: number;
	enable_enhanced_semantic: boolean;
}

export const KNOX_DEFAULT_MEMORY_CONFIG: IKnoxMemoryConfig = {
	auto_extract_enabled: true,
	consolidation_interval_hours: 24,
	max_hot_memories: 500,
	max_episodic_per_session: 1000,
	context_max_tokens: KNOX_MEMORY_CONTEXT_TOKEN_CEILING,
	max_context_tokens: KNOX_MEMORY_CONTEXT_TOKEN_CEILING,
	context_goal_budget_ratio: 0.1,
	memory_mode: 'summarized',
	retrieval_threshold: 0.6,
	retrieval_top_k: 20,
	retrieval_require_lexical: true,
	retrieval_continuation_expand: true,
	fts5_use_and_for_content: true,
	topic_shift_jaccard: 0.35,
	wm_mismatch_decay: 0.25,
	wm_inject_min_relevance: 0.35,
	summary_inject_min_overlap: 0.2,
	pinned_unmatched_cap: 2,
	graph_max_entities: 5000,
	graph_max_depth: 3,
	memory_scope: 'project',
	auto_summarize: true,
	summarize_threshold: 50,
	enable_knowledge_extraction: true,
	post_turn_min_chars: 80,
	hot_to_warm_hours: 24,
	warm_to_cold_days: 7,
	cold_prune_days: 90,
	graph_enabled: true,
	learning_enabled: true,
	llm_entity_extraction_enabled: true,
	llm_summarization_enabled: true,
	llm_importance_scoring_enabled: true,
	llm_post_action_memory_enabled: true,
	working_memory_max_slots: 7,
	working_memory_token_budget: 30000,
	working_memory_token_ratio: 0.125,
	working_memory_decay_rate: 0.001,
	working_memory_ttl_seconds: 30,
	easy_model: '',
	medium_model: '',
	hard_model: '',
	autonomous_max_iterations: 0,
	mode_full_semantic_multiplier: 1.25,
	mode_full_episodic_multiplier: 2.0,
	mode_full_min_importance: 0,
	mode_full_episodic_snippet_len: 400,
	mode_summarized_semantic_multiplier: 0.75,
	mode_summarized_episodic_multiplier: 0.75,
	mode_summarized_min_importance: 0.3,
	mode_summarized_episodic_snippet_len: 150,
	mode_selective_semantic_multiplier: 0.5,
	mode_selective_episodic_multiplier: 0.25,
	mode_selective_min_importance: 0.7,
	mode_selective_episodic_snippet_len: 200,
	mode_selective_include_episodic: false,
	mode_selective_include_procedures: false,
	mode_selective_include_patterns: false,
	context_graph_entity_search: 10,
	context_graph_entity_display: 5,
	context_graph_edge_per_entity: 3,
	context_graph_edge_budget_ratio: 0.7,
	context_procedure_limit: 5,
	context_pattern_limit: 3,
	context_pinned_limit: 10,
	context_line_compress_chars: 200,
	context_compress_keep_lines: 3,
	budget_semantic_ratio: 0.40,
	budget_episodic_ratio: 0.25,
	budget_graph_ratio: 0.15,
	budget_procedures_ratio: 0.10,
	budget_patterns_ratio: 0.10,
	fusion_candidate_multiplier: 5,
	fusion_candidate_min: 50,
	graph_depth_decay_gamma: 0.7,
	graph_memory_boost_factor: 0.3,
	graph_neighbor_limit: 10,
	recency_decay_lambda: 0.004125,
	compression_ratio_hot: 0.5,
	compression_ratio_warm: 0.2,
	compression_ratio_cold: 0.1,
	compression_ratio_frozen: 0.05,
	memory_build_timeout_ms: 5000,
	memory_track_session_timeout_ms: 1500,
	ebbinghaus_base_strength: 1.0,
	ebbinghaus_lambda: 0.03,
	ebbinghaus_prune_threshold: 0.1,
	ebbinghaus_review_threshold: 0.5,
	ebbinghaus_strengthening_alpha: 0.1,
	ebbinghaus_repetition_beta: 0.1,
	ebbinghaus_salience_weight: 0.5,
	ebbinghaus_importance_weight: 0.3,
	sensory_buffer_ms: 250,
	enable_enhanced_semantic: false,
};

export const KNOX_MEMORY_CYCLE_PHASES: ReadonlyArray<{ id: string; label: () => string }> = [
	{ id: 'sensory_input', label: () => localize('knox.memoryPhaseSensory', "Sensory") },
	{ id: 'encoding', label: () => localize('knox.memoryPhaseEncoding', "Encoding") },
	{ id: 'working_memory', label: () => localize('knox.memoryPhaseWorking', "Working") },
	{ id: 'consolidation', label: () => localize('knox.memoryPhaseConsolidation', "Consolidation") },
	{ id: 'long_term_storage', label: () => localize('knox.memoryPhaseLongTerm', "Long-term") },
	{ id: 'retrieval', label: () => localize('knox.memoryPhaseRetrieval', "Retrieval") },
	{ id: 'sleep_consolidation', label: () => localize('knox.memoryPhaseSleep', "Sleep") },
	{ id: 'output_generation', label: () => localize('knox.memoryPhaseOutput', "Output") },
];

export const KNOX_SLEEP_PHASE_LABELS: Record<string, string> = {
	nrem_replay: 'NREM Replay',
	nrem_decay_demoted: 'NREM Decay (demoted)',
	nrem_decay_pruned: 'NREM Decay (pruned)',
	nrem_compress: 'NREM Compress',
	rem_distill: 'REM Distill',
	graph_strengthen: 'Graph Strengthen',
	promote: 'Promote',
};

export const KNOX_MEMORY_TIER_COLORS: Record<string, string> = {
	hot: '#ef4444',
	warm: '#f59e0b',
	cold: '#3b82f6',
};

export const KNOX_MEMORY_STATUS_COLORS: Record<string, string> = {
	healthy: '#22c55e',
	degraded: '#f59e0b',
	critical: '#ef4444',
};

export const KNOX_MEMORY_TREND_COLORS: Record<string, string> = {
	improving: '#22c55e',
	stable: '#6b7280',
	degrading: '#ef4444',
	growing: '#3b82f6',
	shrinking: '#f59e0b',
	accelerating: '#8b5cf6',
};

export const KNOX_GRAPH_TYPE_COLORS: Record<string, string> = {
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

export function knoxMemoryTabLabel(tab: KnoxMemoryPanelTab): string {
	switch (tab) {
		case 'overview': return knoxNls('memoryOverview');
		case 'browser': return knoxNls('memoryBrowser');
		case 'sessions': return knoxNls('memorySessionHistoryTab');
		case 'graph': return knoxNls('memoryGraph');
		case 'settings': return knoxNls('memorySettings');
	}
}

export function knoxFilterAndSortMemories(
	memories: IKnoxMemoryItem[],
	opts: {
		category?: string;
		tier?: string;
		pinned?: KnoxMemoryPinnedFilter;
		sortBy?: KnoxMemorySortBy;
	},
): IKnoxMemoryItem[] {
	let filtered = memories;
	if (opts.category && opts.category !== 'all') {
		filtered = filtered.filter(item => item.category === opts.category);
	}
	if (opts.tier && opts.tier !== 'all') {
		filtered = filtered.filter(item => item.tier === opts.tier);
	}
	if (opts.pinned === 'pinned') {
		filtered = filtered.filter(item => !!item.pinned);
	} else if (opts.pinned === 'unpinned') {
		filtered = filtered.filter(item => !item.pinned);
	}
	if (opts.sortBy === 'importance') {
		return [...filtered].sort((a, b) => (b.importance_score ?? 0) - (a.importance_score ?? 0));
	}
	if (opts.sortBy === 'accessed') {
		return [...filtered].sort((a, b) => (b.retrieval_count ?? 0) - (a.retrieval_count ?? 0));
	}
	return [...filtered].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function knoxGroupMemoriesByDate(memories: IKnoxMemoryItem[], now = Date.now()): IKnoxMemoryDateSection[] {
	const yesterday = now - 1000 * 60 * 60 * 24;
	const lastWeek = now - 1000 * 60 * 60 * 24 * 7;
	const lastMonth = now - 1000 * 60 * 60 * 24 * 30;
	const sections: IKnoxMemoryDateSection[] = [];
	let currentKey: IKnoxMemoryDateSection['headerKey'] | '' = '';
	let current: IKnoxMemoryItem[] = [];
	const flush = () => {
		if (currentKey && current.length) {
			sections.push({ headerKey: currentKey, memories: current });
		}
	};
	for (const memory of memories) {
		const date = new Date(memory.created_at).getTime();
		let key: IKnoxMemoryDateSection['headerKey'];
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

export function knoxMemoriesToExportJson(memories: IKnoxMemoryItem[]): string {
	return JSON.stringify({
		version: 'knox-memories-selected-v1',
		exported_at: new Date().toISOString(),
		count: memories.length,
		memories: memories.map(item => ({
			id: item.id,
			category: item.category,
			title: item.title,
			content: item.content,
			keywords: item.keywords,
			importance_score: item.importance_score,
			retrieval_count: item.retrieval_count,
			tier: item.tier,
			created_at: item.created_at,
			last_accessed_at: item.last_accessed_at,
			source_session_id: item.source_session_id,
			pinned: !!item.pinned,
		})),
	}, null, 2);
}

export function knoxMemoriesToExportMarkdown(memories: IKnoxMemoryItem[]): string {
	const lines = [
		`# Memories export (${memories.length})`,
		'',
		`Exported ${new Date().toISOString()}`,
		'',
	];
	for (const memory of memories) {
		lines.push(`## ${memory.title || '(untitled)'}`);
		lines.push('');
		lines.push(`- Category: ${memory.category || 'general'} · Tier: ${memory.tier || '—'} · Pin: ${memory.pinned ? 'yes' : 'no'}`);
		if (memory.keywords) {
			lines.push(`- Keywords: ${memory.keywords}`);
		}
		lines.push(`- Created: ${memory.created_at}`);
		lines.push('');
		lines.push(memory.content || '');
		lines.push('');
	}
	return lines.join('\n');
}

export function knoxRangeSelectIds(orderedIds: number[], fromId: number | null, toId: number, current: Set<number>): Set<number> {
	if (fromId == null) {
		const next = new Set(current);
		if (next.has(toId)) {
			next.delete(toId);
		} else {
			next.add(toId);
		}
		return next;
	}
	const from = orderedIds.indexOf(fromId);
	const to = orderedIds.indexOf(toId);
	if (from < 0 || to < 0) {
		const next = new Set(current);
		if (next.has(toId)) {
			next.delete(toId);
		} else {
			next.add(toId);
		}
		return next;
	}
	const [start, end] = from < to ? [from, to] : [to, from];
	const next = new Set(current);
	for (let i = start; i <= end; i++) {
		next.add(orderedIds[i]);
	}
	return next;
}

export function knoxMemorySnippet(text: string, max = 96): string {
	const compact = (text || '').replace(/\s+/g, ' ').trim();
	if (compact.length <= max) {
		return compact;
	}
	return `${compact.slice(0, max - 1)}…`;
}

export function knoxMemoryTimeAgo(dateStr: string | null | undefined): string {
	if (!dateStr) {
		return localize('knox.memoryTimeNever', "Never");
	}
	const diff = Date.now() - new Date(dateStr).getTime();
	if (!Number.isFinite(diff)) {
		return localize('knox.memoryTimeNever', "Never");
	}
	const minutes = Math.floor(diff / 60000);
	if (minutes < 1) {
		return localize('knox.memoryTimeJustNow', "Just now");
	}
	if (minutes < 60) {
		return localize('knox.memoryTimeMinutesAgo', "{0}m ago", minutes);
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return localize('knox.memoryTimeHoursAgo', "{0}h ago", hours);
	}
	const days = Math.floor(hours / 24);
	return localize('knox.memoryTimeDaysAgo', "{0}d ago", days);
}

export function knoxMemoryDateLabel(dateStr: string): string {
	const date = new Date(dateStr);
	if (!Number.isFinite(date.getTime())) {
		return dateStr;
	}
	return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function knoxMemoryDbSize(bytes: number): string {
	return knoxFormatBytes(bytes);
}

export function knoxDateSectionLabel(key: IKnoxMemoryDateSection['headerKey']): string {
	switch (key) {
		case 'today': return knoxNls('today');
		case 'thisWeek': return knoxNls('thisWeek');
		case 'thisMonth': return knoxNls('thisMonth');
		case 'memoryEarlier': return knoxNls('memoryEarlier');
	}
}

export function knoxMergeMemoryConfig(raw: unknown): IKnoxMemoryConfig {
	const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	return { ...KNOX_DEFAULT_MEMORY_CONFIG, ...record } as IKnoxMemoryConfig;
}

export function knoxParseMemoryItem(value: unknown): IKnoxMemoryItem | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const id = Number(record.id);
	if (!Number.isFinite(id)) {
		return undefined;
	}
	return {
		id,
		category: String(record.category ?? 'general'),
		title: String(record.title ?? ''),
		content: String(record.content ?? ''),
		keywords: String(record.keywords ?? ''),
		importance_score: Number(record.importance_score ?? 0),
		retrieval_count: Number(record.retrieval_count ?? 0),
		tier: String(record.tier ?? ''),
		created_at: String(record.created_at ?? ''),
		last_accessed_at: record.last_accessed_at == null ? null : String(record.last_accessed_at),
		source_session_id: record.source_session_id == null ? null : String(record.source_session_id),
		pinned: !!record.pinned,
	};
}

export function knoxParseMemoryList(result: unknown): IKnoxMemoryItem[] {
	const content = knoxUnwrapProtocol(result).content;
	const raw = Array.isArray(content)
		? content
		: Array.isArray((content as { memories?: unknown })?.memories)
			? (content as { memories: unknown[] }).memories
			: [];
	return raw.map(knoxParseMemoryItem).filter((item): item is IKnoxMemoryItem => !!item);
}

export function knoxParseDashboard(result: unknown): IKnoxMemoryDashboard | undefined {
	const content = knoxProtocolObject(result);
	if (!content) {
		return undefined;
	}
	const rawStats = (content.stats && typeof content.stats === 'object') ? content.stats as Record<string, unknown> : undefined;
	const rawHealth = (content.health && typeof content.health === 'object') ? content.health as Record<string, unknown> : undefined;
	const stats: IKnoxMemoryStats = {
		total_sessions: Number(rawStats?.total_sessions ?? 0),
		total_episodic: Number(rawStats?.total_episodic ?? 0),
		total_semantic: Number(rawStats?.total_semantic ?? 0),
		total_associations: Number(rawStats?.total_associations ?? 0),
		total_entities: Number(rawStats?.total_entities ?? 0),
		total_edges: Number(rawStats?.total_edges ?? 0),
		total_patterns: Number(rawStats?.total_patterns ?? 0),
		total_procedures: Number(rawStats?.total_procedures ?? 0),
		total_tags: Number(rawStats?.total_tags ?? 0),
		total_collections: Number(rawStats?.total_collections ?? 0),
		tier_counts: {
			hot: Number((rawStats?.tier_counts as { hot?: number } | undefined)?.hot ?? 0),
			warm: Number((rawStats?.tier_counts as { warm?: number } | undefined)?.warm ?? 0),
			cold: Number((rawStats?.tier_counts as { cold?: number } | undefined)?.cold ?? 0),
		},
		category_counts: (rawStats?.category_counts && typeof rawStats.category_counts === 'object') ? rawStats.category_counts as Record<string, number> : {},
		entity_type_counts: (rawStats?.entity_type_counts && typeof rawStats.entity_type_counts === 'object') ? rawStats.entity_type_counts as Record<string, number> : {},
		oldest_memory: rawStats?.oldest_memory == null ? null : String(rawStats.oldest_memory),
		newest_memory: rawStats?.newest_memory == null ? null : String(rawStats.newest_memory),
		db_size_bytes: Number(rawStats?.db_size_bytes ?? 0),
	};
	const health: IKnoxMemoryHealth = {
		status: String(rawHealth?.status ?? 'healthy'),
		db_size_bytes: Number(rawHealth?.db_size_bytes ?? 0),
		total_memories: Number(rawHealth?.total_memories ?? 0),
		fragmentation_ratio: Number(rawHealth?.fragmentation_ratio ?? 0),
		oldest_unaccessed_days: Number(rawHealth?.oldest_unaccessed_days ?? 0),
		issues: Array.isArray(rawHealth?.issues) ? rawHealth.issues.map(item => String(item)) : [],
		recommendations: Array.isArray(rawHealth?.recommendations) ? rawHealth.recommendations.map(item => String(item)) : [],
	};
	const graph = knoxParseGraphStats({ status: 'success', content: content.graphStats });
	const sessions = Array.isArray(content.sessions) ? content.sessions as IKnoxMemoryDashboardSession[] : [];
	const score = content.healthScore && typeof content.healthScore === 'object' ? content.healthScore as { overall?: number; grade?: string; score?: number } : null;
	const consolidation = content.consolidation && typeof content.consolidation === 'object' ? content.consolidation as IKnoxMemoryDashboard['consolidation'] : null;
	return {
		stats,
		health,
		graphStats: graph ?? null,
		sessions,
		healthScore: score ? { overall: Number(score.overall ?? score.score ?? 0), grade: String(score.grade ?? ''), score: score.score } : null,
		consolidation: consolidation ? {
			total_runs: Number(consolidation.total_runs ?? 0),
			last_run_at: consolidation.last_run_at ?? (consolidation as { last_run?: string | null }).last_run ?? null,
			avg_duration_ms: Number(consolidation.avg_duration_ms ?? 0),
			last_sub_phases: consolidation.last_sub_phases ?? null,
		} : null,
	};
}

export function knoxParseEffectiveContext(result: unknown): IKnoxEffectiveContext | undefined {
	const content = knoxProtocolObject(result);
	if (!content) {
		return undefined;
	}
	return {
		active_window_tokens: Number(content.active_window_tokens ?? 0),
		last_context_tokens_used: Number(content.last_context_tokens_used ?? 0) || undefined,
		window_utilization: Number(content.window_utilization ?? 0) || undefined,
		tier_tokens: (content.tier_tokens && typeof content.tier_tokens === 'object') ? content.tier_tokens as Record<string, number> : {},
		hierarchy_effective_tokens: Number(content.hierarchy_effective_tokens ?? 0),
		memory_levels: Array.isArray(content.memory_levels) ? content.memory_levels as IKnoxMemoryLevel[] : undefined,
		working_memory_budget: Number(content.working_memory_budget ?? 0) || undefined,
		graph_entity_count: Number(content.graph_entity_count ?? 0),
		graph_max_entities: Number(content.graph_max_entities ?? 0) || undefined,
		total_effective: Number(content.total_effective ?? 0),
		compression_ratios: (content.compression_ratios && typeof content.compression_ratios === 'object') ? content.compression_ratios as Record<string, number> : {},
		memory_tokens_saved: Number(content.memory_tokens_saved ?? 0) || undefined,
	};
}

export function knoxParseMetricsTrend(result: unknown): IKnoxMetricsTrend | undefined {
	const content = knoxProtocolObject(result);
	if (!content) {
		return undefined;
	}
	return {
		snapshots: Array.isArray(content.snapshots) ? content.snapshots as IKnoxMetricsTrend['snapshots'] : [],
		period_hours: Number(content.period_hours ?? 24),
		avg_response_trend: String(content.avg_response_trend ?? 'stable'),
		success_rate_trend: String(content.success_rate_trend ?? 'stable'),
		growth_rate_trend: String(content.growth_rate_trend ?? 'stable'),
		compression_trend: content.compression_trend ? String(content.compression_trend) : undefined,
		effective_context_trend: content.effective_context_trend ? String(content.effective_context_trend) : undefined,
	};
}

export function knoxParsePhaseStatus(result: unknown): IKnoxPhaseStatus | undefined {
	const content = knoxProtocolObject(result);
	if (!content) {
		return undefined;
	}
	return {
		active_phase: content.active_phase == null ? null : String(content.active_phase),
		last_completed: content.last_completed && typeof content.last_completed === 'object'
			? content.last_completed as IKnoxPhaseStatus['last_completed']
			: null,
		phase_counts: (content.phase_counts && typeof content.phase_counts === 'object') ? content.phase_counts as Record<string, number> : {},
		cycle_invariant_met: !!content.cycle_invariant_met,
		background_sleep_active: !!content.background_sleep_active,
	};
}

export function knoxParseReviewDue(result: unknown): IKnoxReviewDueItem[] {
	const content = knoxProtocolObject(result);
	const items = Array.isArray(content?.items) ? content.items : [];
	return items.map(item => {
		const record = item as Record<string, unknown>;
		return {
			memory_id: Number(record.memory_id),
			category: String(record.category ?? ''),
			title: String(record.title ?? ''),
			current_retention: Number(record.current_retention ?? 0),
			overdue: !!record.overdue,
		};
	}).filter(item => Number.isFinite(item.memory_id));
}

export function knoxParseEbbinghausStats(result: unknown): IKnoxEbbinghausStats | undefined {
	const content = knoxProtocolObject(result);
	if (!content) {
		return undefined;
	}
	const config = (content.config && typeof content.config === 'object') ? content.config as { lambda?: number } : {};
	return {
		config: { lambda: Number(config.lambda ?? 0) },
		review_due_count: Number(content.review_due_count ?? 0),
		avg_retention: Number(content.avg_retention ?? 0),
	};
}

export function knoxParseGraphStats(result: unknown): IKnoxMemoryGraphStats | undefined {
	const content = knoxProtocolObject(result);
	if (!content) {
		return undefined;
	}
	const types = (content.entity_types && typeof content.entity_types === 'object')
		? content.entity_types as Record<string, number>
		: (content.entity_type_counts && typeof content.entity_type_counts === 'object')
			? content.entity_type_counts as Record<string, number>
			: {};
	return {
		total_entities: Number(content.total_entities ?? 0),
		total_edges: Number(content.total_edges ?? 0),
		entity_types: types,
		max_entities: content.max_entities == null ? undefined : Number(content.max_entities),
		cap_utilization: content.cap_utilization == null ? undefined : Number(content.cap_utilization),
		at_cap: content.at_cap == null ? undefined : !!content.at_cap,
		max_depth: content.max_depth == null ? undefined : Number(content.max_depth),
		depth_decay_gamma: content.depth_decay_gamma == null ? undefined : Number(content.depth_decay_gamma),
	};
}

export function knoxParseGraphEntities(result: unknown): IKnoxGraphEntity[] {
	const content = knoxUnwrapProtocol(result).content;
	const raw = Array.isArray(content)
		? content
		: Array.isArray((content as { entities?: unknown })?.entities)
			? (content as { entities: unknown[] }).entities
			: [];
	return raw.map(item => {
		const record = item as Record<string, unknown>;
		return {
			id: Number(record.id),
			name: String(record.name ?? ''),
			entity_type: String(record.entity_type ?? ''),
			description: record.description == null ? null : String(record.description),
			mention_count: Number(record.mention_count ?? 0),
		};
	}).filter(item => Number.isFinite(item.id));
}

export function knoxParseExploreResult(result: unknown): IKnoxExploreResult | undefined {
	const content = knoxProtocolObject(result);
	if (!content) {
		return undefined;
	}
	const payload = (content.result && typeof content.result === 'object') ? content.result as Record<string, unknown> : content;
	const center = knoxParseGraphEntities({ status: 'success', content: { entities: [payload.center] } })[0];
	if (!center) {
		return undefined;
	}
	return {
		center,
		entities: knoxParseGraphEntities({ status: 'success', content: { entities: payload.entities } }),
		edges: Array.isArray(payload.edges) ? payload.edges as IKnoxGraphEdge[] : [],
		depth_reached: Number(payload.depth_reached ?? 0),
	};
}

export function knoxParseBrainSessions(result: unknown): IKnoxBrainSession[] {
	const content = knoxUnwrapProtocol(result).content;
	const raw = Array.isArray(content)
		? content
		: Array.isArray((content as { sessions?: unknown })?.sessions)
			? (content as { sessions: unknown[] }).sessions
			: [];
	return raw.map(item => {
		const record = item as Record<string, unknown>;
		return {
			id: String(record.id ?? ''),
			title: String(record.title ?? ''),
			created_at: String(record.created_at ?? ''),
			updated_at: String(record.updated_at ?? record.created_at ?? ''),
			message_count: Number(record.message_count ?? 0),
			summary: record.summary == null ? null : String(record.summary),
			is_active: !!record.is_active,
		};
	}).filter(item => item.id);
}

export function knoxParseSessionHistory(result: unknown): IKnoxSessionHistory | undefined {
	const content = knoxProtocolObject(result);
	if (!content) {
		return undefined;
	}
	return {
		episodic: Array.isArray(content.episodic) ? content.episodic as IKnoxSessionHistory['episodic'] : [],
		semantic: Array.isArray(content.semantic) ? content.semantic as IKnoxSessionHistory['semantic'] : [],
		topics: Array.isArray(content.topics) ? content.topics as IKnoxSessionHistory['topics'] : [],
		token_estimate: Number(content.token_estimate ?? 0),
		message_count: Number(content.message_count ?? 0),
	};
}

export function knoxParseBacklogMatches(result: unknown): IKnoxBacklogMatch[] {
	const content = knoxProtocolObject(result);
	const nested = (content?.result && typeof content.result === 'object') ? content.result as Record<string, unknown> : content ?? {};
	const episodic = Array.isArray(nested.episodic) ? nested.episodic as Array<Record<string, unknown>> : [];
	const semantic = Array.isArray(nested.semantic) ? nested.semantic as Array<Record<string, unknown>> : [];
	return [
		...semantic.map(item => ({
			id: Number(item.id),
			source_session_id: item.source_session_id == null ? undefined : String(item.source_session_id),
			category: String(item.category ?? ''),
			title: String(item.title ?? ''),
			content: String(item.content ?? ''),
			kind: 'semantic' as const,
		})),
		...episodic.map(item => ({
			id: Number(item.id),
			session_id: item.session_id == null ? undefined : String(item.session_id),
			role: String(item.role ?? ''),
			content: String(item.content ?? ''),
			kind: 'episodic' as const,
		})),
	].filter(item => Number.isFinite(item.id));
}

export function knoxParseMemoryConfig(result: unknown): IKnoxMemoryConfig {
	const content = knoxProtocolObject(result);
	const config = content?.config ?? content;
	return knoxMergeMemoryConfig(config);
}

export function knoxFormatConsolidateResult(result: unknown): string {
	const content = knoxProtocolObject(result);
	const payload = (content?.result && typeof content.result === 'object') ? content.result as Record<string, number> : content;
	if (!payload) {
		return localize('knox.memoryActionSuccess', "Done");
	}
	const parts: string[] = [];
	if (Number(payload.promoted) > 0) {
		parts.push(`${payload.promoted} promoted`);
	}
	if (Number(payload.demoted) > 0) {
		parts.push(`${payload.demoted} demoted`);
	}
	if (Number(payload.pruned) > 0) {
		parts.push(`${payload.pruned} pruned`);
	}
	if (Number(payload.merged) > 0) {
		parts.push(`${payload.merged} merged`);
	}
	return parts.length
		? `${localize('knox.memoryConsolidateResult', "Consolidation")}: ${parts.join(', ')}`
		: localize('knox.memoryConsolidateNoChanges', "No changes");
}

export function knoxParseExportPayload(result: unknown): { data: string; filePath: string; encrypted: boolean } | undefined {
	const content = knoxProtocolObject(result);
	if (!content) {
		return undefined;
	}
	return {
		data: String(content.data ?? ''),
		filePath: String(content.filePath ?? ''),
		encrypted: !!content.encrypted,
	};
}

export function knoxImportNeedsPassword(text: string): boolean {
	try {
		const parsed = JSON.parse(text) as { version?: string };
		return parsed.version === 'knox-brain-encrypted-v1';
	} catch {
		return false;
	}
}

export function knoxImportLooksValid(text: string): boolean {
	try {
		const parsed = JSON.parse(text) as { version?: string };
		return typeof parsed.version === 'string' && parsed.version.length > 0;
	} catch {
		return false;
	}
}

export function knoxMemorySearchPayload(opts: {
	query: string;
	category: string;
	tier: string;
	pinned: KnoxMemoryPinnedFilter;
	limit: number;
	offset: number;
}): { query?: string; category?: string; tier?: string; pinned?: boolean; limit: number; offset: number } {
	return {
		query: opts.query.trim() || undefined,
		category: opts.category === 'all' ? undefined : opts.category,
		tier: opts.tier === 'all' ? undefined : opts.tier,
		pinned: opts.pinned === 'all' ? undefined : opts.pinned === 'pinned',
		limit: opts.limit,
		offset: opts.offset,
	};
}

export type KnoxMemorySettingKind = 'toggle' | 'number' | 'float' | 'select' | 'text';

export interface IKnoxMemorySettingField {
	kind: KnoxMemorySettingKind;
	key: keyof IKnoxMemoryConfig;
	label: string;
	description: string;
	min?: number;
	max?: number;
	step?: number;
	suffix?: string;
	/** Display value = stored * scale (percent fields). */
	scale?: number;
	options?: Array<{ value: string; label: string }>;
}

export type KnoxMemorySettingEntry =
	| { kind: 'heading'; label: string }
	| { kind: 'note'; text: string }
	| IKnoxMemorySettingField;

export interface IKnoxMemorySettingSection {
	id: string;
	title: string;
	collapsible?: boolean;
	entries: KnoxMemorySettingEntry[];
}

export function knoxMemorySettingSections(): IKnoxMemorySettingSection[] {
	const hours = localize('knox.memoryHoursSuffix', "hours");
	const days = localize('knox.memoryDaysSuffix', "days");
	const ms = localize('knox.memoryMsSuffix', "ms");
	return [
		{
			id: 'general',
			title: localize('knox.memoryGeneralSettings', "General"),
			entries: [
				field('toggle', 'auto_extract_enabled', localize('knox.memoryAutoMemory', "Auto memory"), localize('knox.memoryAutoMemoryDesc', "Extract memories after turns.")),
				field('number', 'consolidation_interval_hours', localize('knox.memoryConsolidationInterval', "Consolidation interval"), localize('knox.memoryConsolidationIntervalDesc', "Hours between sleep consolidation."), 1, 168, 1, hours),
			],
		},
		{
			id: 'ebbinghaus',
			title: localize('knox.memoryEbbinghausSettings', "Spaced repetition"),
			entries: [
				field('float', 'ebbinghaus_base_strength', localize('knox.memoryEbbinghausBaseStrength', "Base strength"), localize('knox.memoryEbbinghausBaseStrengthDesc', "Starting memory strength."), 0.1, 30, 0.1),
				field('float', 'ebbinghaus_lambda', localize('knox.memoryEbbinghausLambda', "Decay λ"), localize('knox.memoryEbbinghausLambdaDesc', "Forgetting-curve decay rate."), 0.01, 1, 0.01),
				field('number', 'ebbinghaus_prune_threshold', localize('knox.memoryEbbinghausPruneThreshold', "Prune threshold"), localize('knox.memoryEbbinghausPruneThresholdDesc', "Forget below this retention."), 5, 50, 1, '%', 100),
				field('number', 'ebbinghaus_review_threshold', localize('knox.memoryEbbinghausReviewThreshold', "Review threshold"), localize('knox.memoryEbbinghausReviewThresholdDesc', "Due for review below this retention."), 10, 90, 1, '%', 100),
				field('float', 'ebbinghaus_strengthening_alpha', localize('knox.memoryEbbinghausStrengtheningAlpha', "Strengthening α"), localize('knox.memoryEbbinghausStrengtheningAlphaDesc', "Boost on successful recall."), 0, 0.5, 0.01),
				field('float', 'ebbinghaus_repetition_beta', localize('knox.memoryEbbinghausRepetitionBeta', "Repetition β"), localize('knox.memoryEbbinghausRepetitionBetaDesc', "Boost from repetition count."), 0, 0.5, 0.01),
				field('number', 'ebbinghaus_salience_weight', localize('knox.memoryEbbinghausSalienceWeight', "Salience weight"), localize('knox.memoryEbbinghausSalienceWeightDesc', "Weight of salience in retention."), 0, 2),
				field('number', 'ebbinghaus_importance_weight', localize('knox.memoryEbbinghausImportanceWeight', "Importance weight"), localize('knox.memoryEbbinghausImportanceWeightDesc', "Weight of importance in retention."), 0, 2),
			],
		},
		{
			id: 'capacity',
			title: localize('knox.memoryCapacitySettings', "Capacity"),
			entries: [
				field('number', 'max_hot_memories', localize('knox.memoryMaxHot', "Max hot memories"), localize('knox.memoryMaxHotDesc', "Hot-tier cap."), 100, 10000),
				field('number', 'max_episodic_per_session', localize('knox.memoryMaxEpisodic', "Max episodic / session"), localize('knox.memoryMaxEpisodicDesc', "Episodic rows kept per session."), 100, 10000),
				field('number', 'context_max_tokens', localize('knox.memoryContextTokens', "Context tokens"), localize('knox.memoryContextTokensDesc', "Memory context budget."), 1000, KNOX_MEMORY_CONTEXT_TOKEN_CEILING),
				{
					kind: 'select',
					key: 'memory_mode',
					label: localize('knox.memoryMode', "Memory mode"),
					description: localize('knox.memoryModeDesc', "How much memory is injected into chat."),
					options: [
						{ value: 'summarized', label: localize('knox.memoryModeSummarized', "Summarized") },
						{ value: 'full', label: localize('knox.memoryModeFull', "Full") },
						{ value: 'selective', label: localize('knox.memoryModeSelective', "Selective") },
					],
				},
				field('number', 'retrieval_threshold', localize('knox.memoryRetrievalThreshold', "Retrieval threshold"), localize('knox.memoryRetrievalThresholdDesc', "Minimum fusion score to inject."), 10, 95, 1, '%', 100),
				field('number', 'retrieval_top_k', localize('knox.memoryRetrievalTopK', "Retrieval top-k"), localize('knox.memoryRetrievalTopKDesc', "Max memories retrieved."), 5, 100),
				field('toggle', 'enable_enhanced_semantic', localize('knox.memoryEnhancedSemantic', "Enhanced semantic"), localize('knox.memoryEnhancedSemanticDesc', "Use enhanced semantic retrieval.")),
				field('number', 'max_context_tokens', localize('knox.memoryMaxContextTokens', "Max context tokens"), localize('knox.memoryMaxContextTokensDesc', "Hard cap for assembled context."), 1000, KNOX_MEMORY_CONTEXT_TOKEN_CEILING),
				field('float', 'context_goal_budget_ratio', localize('knox.memoryGoalBudgetRatio', "Goal budget ratio"), localize('knox.memoryGoalBudgetRatioDesc', "Share of budget reserved for goals."), 0.05, 0.3, 0.01),
			],
		},
		{
			id: 'precision',
			title: localize('knox.memoryPrecisionSettings', "Retrieval precision"),
			entries: [
				field('toggle', 'retrieval_require_lexical', localize('knox.memoryRequireLexical', "Require lexical match"), localize('knox.memoryRequireLexicalDesc', "Drop purely semantic hits.")),
				field('toggle', 'retrieval_continuation_expand', localize('knox.memoryContinuationExpand', "Expand on continuation"), localize('knox.memoryContinuationExpandDesc', "Widen retrieval when the turn continues.")),
				field('toggle', 'fts5_use_and_for_content', localize('knox.memoryFts5AndContent', "FTS5 AND for content"), localize('knox.memoryFts5AndContentDesc', "Require all query terms in content.")),
				field('float', 'topic_shift_jaccard', localize('knox.memoryTopicShiftJaccard', "Topic-shift Jaccard"), localize('knox.memoryTopicShiftJaccardDesc', "Detect topic changes."), 0.1, 0.8, 0.01),
				field('float', 'wm_mismatch_decay', localize('knox.memoryWmMismatchDecay', "Mismatch decay"), localize('knox.memoryWmMismatchDecayDesc', "Decay working-memory on mismatch."), 0.05, 0.8, 0.01),
				field('float', 'wm_inject_min_relevance', localize('knox.memoryWmInjectMinRelevance', "WM min relevance"), localize('knox.memoryWmInjectMinRelevanceDesc', "Minimum relevance to inject working memory."), 0.1, 0.8, 0.01),
				field('float', 'summary_inject_min_overlap', localize('knox.memorySummaryInjectMinOverlap', "Summary min overlap"), localize('knox.memorySummaryInjectMinOverlapDesc', "Minimum overlap to inject summaries."), 0.05, 0.8, 0.01),
				field('number', 'pinned_unmatched_cap', localize('knox.memoryPinnedUnmatchedCap', "Pinned unmatched cap"), localize('knox.memoryPinnedUnmatchedCapDesc', "Pinned items allowed without a match."), 0, 10),
			],
		},
		{
			id: 'working',
			title: localize('knox.memoryWorkingMemorySettings', "Working memory"),
			entries: [
				field('number', 'working_memory_max_slots', localize('knox.memoryWorkingMemorySlots', "Slots"), localize('knox.memoryWorkingMemorySlotsDesc', "Working-memory slot count."), 3, 15),
				field('float', 'working_memory_token_ratio', localize('knox.memoryWorkingMemoryTokenRatio', "Token ratio"), localize('knox.memoryWorkingMemoryTokenRatioDesc', "Share of context for working memory."), 0.05, 0.5, 0.01),
				field('number', 'working_memory_token_budget', localize('knox.memoryWorkingMemoryTokenBudget', "Token budget"), localize('knox.memoryWorkingMemoryTokenBudgetDesc', "Hard token budget (0 = ratio only)."), 0, 30000),
				field('float', 'working_memory_decay_rate', localize('knox.memoryWorkingMemoryDecay', "Decay rate"), localize('knox.memoryWorkingMemoryDecayDesc', "Per-second decay."), 0.0001, 0.01, 0.0001),
				field('number', 'working_memory_ttl_seconds', localize('knox.memoryWorkingMemoryTtl', "TTL (seconds)"), localize('knox.memoryWorkingMemoryTtlDesc', "Slot time-to-live."), 5, 120),
				field('number', 'sensory_buffer_ms', localize('knox.memorySensoryBufferMs', "Sensory buffer"), localize('knox.memorySensoryBufferMsDesc', "Sensory buffer window."), 100, 2000, 1, ms),
			],
		},
		{
			id: 'routing',
			title: localize('knox.memoryTaskRoutingSettings', "Task routing"),
			entries: [
				field('text', 'easy_model', localize('knox.memoryEasyModel', "Easy model"), localize('knox.memoryEasyModelDesc', "Model title for easy tasks.")),
				field('text', 'medium_model', localize('knox.memoryMediumModel', "Medium model"), localize('knox.memoryMediumModelDesc', "Model title for medium tasks.")),
				field('text', 'hard_model', localize('knox.memoryHardModel', "Hard model"), localize('knox.memoryHardModelDesc', "Model title for hard tasks.")),
				field('number', 'autonomous_max_iterations', localize('knox.memoryAutonomousMaxIterations', "Autonomous max iterations"), localize('knox.memoryAutonomousMaxIterationsDesc', "0 uses the default loop cap."), 0, 50),
			],
		},
		{
			id: 'assembly',
			title: localize('knox.memoryContextAssemblySettings', "Context assembly"),
			collapsible: true,
			entries: [
				field('number', 'context_graph_entity_search', localize('knox.memoryGraphEntitySearch', "Graph entity search"), localize('knox.memoryGraphEntitySearchDesc', "Entities searched for graph context."), 3, 50),
				field('number', 'context_graph_entity_display', localize('knox.memoryGraphEntityDisplay', "Graph entity display"), localize('knox.memoryGraphEntityDisplayDesc', "Entities shown in context."), 1, 20),
				field('number', 'context_graph_edge_per_entity', localize('knox.memoryGraphEdgePerEntity', "Edges per entity"), localize('knox.memoryGraphEdgePerEntityDesc', "Edges kept per entity."), 1, 10),
				field('float', 'context_graph_edge_budget_ratio', localize('knox.memoryGraphEdgeBudgetRatio', "Edge budget ratio"), localize('knox.memoryGraphEdgeBudgetRatioDesc', "Share of graph budget for edges."), 0.3, 1, 0.01),
				field('number', 'context_procedure_limit', localize('knox.memoryProcedureLimit', "Procedure limit"), localize('knox.memoryProcedureLimitDesc', "Procedures injected."), 1, 20),
				field('number', 'context_pattern_limit', localize('knox.memoryPatternLimit', "Pattern limit"), localize('knox.memoryPatternLimitDesc', "Patterns injected."), 1, 20),
				field('number', 'context_pinned_limit', localize('knox.memoryPinnedLimit', "Pinned limit"), localize('knox.memoryPinnedLimitDesc', "Pinned memories injected."), 1, 50),
				field('number', 'context_line_compress_chars', localize('knox.memoryLineCompressChars', "Line compress chars"), localize('knox.memoryLineCompressCharsDesc', "Compress lines longer than this."), 100, 1000),
				field('number', 'context_compress_keep_lines', localize('knox.memoryCompressKeepLines', "Keep compressed lines"), localize('knox.memoryCompressKeepLinesDesc', "Lines kept after compression."), 1, 10),
			],
		},
		{
			id: 'modeTuning',
			title: localize('knox.memoryModeTuningSettings', "Mode tuning"),
			collapsible: true,
			entries: [
				{ kind: 'heading', label: localize('knox.memoryModeSummarized', "Summarized") },
				field('float', 'mode_summarized_semantic_multiplier', localize('knox.memoryModeSemanticMultiplier', "Semantic multiplier"), localize('knox.memoryModeSemanticMultiplierDesc', "Semantic budget multiplier."), 0.25, 2, 0.05),
				field('float', 'mode_summarized_episodic_multiplier', localize('knox.memoryModeEpisodicMultiplier', "Episodic multiplier"), localize('knox.memoryModeEpisodicMultiplierDesc', "Episodic budget multiplier."), 0.25, 2, 0.05),
				field('float', 'mode_summarized_min_importance', localize('knox.memoryModeMinImportance', "Min importance"), localize('knox.memoryModeMinImportanceDesc', "Drop below this importance."), 0, 1, 0.05),
				field('number', 'mode_summarized_episodic_snippet_len', localize('knox.memoryModeEpisodicSnippetLen', "Episodic snippet length"), localize('knox.memoryModeEpisodicSnippetLenDesc', "Characters kept per episodic snippet."), 50, 800),
				{ kind: 'heading', label: localize('knox.memoryModeFull', "Full") },
				field('float', 'mode_full_semantic_multiplier', localize('knox.memoryModeSemanticMultiplier', "Semantic multiplier"), localize('knox.memoryModeSemanticMultiplierDesc', "Semantic budget multiplier."), 0.25, 2, 0.05),
				field('float', 'mode_full_episodic_multiplier', localize('knox.memoryModeEpisodicMultiplier', "Episodic multiplier"), localize('knox.memoryModeEpisodicMultiplierDesc', "Episodic budget multiplier."), 0.25, 3, 0.05),
				field('number', 'mode_full_episodic_snippet_len', localize('knox.memoryModeEpisodicSnippetLen', "Episodic snippet length"), localize('knox.memoryModeEpisodicSnippetLenDesc', "Characters kept per episodic snippet."), 100, 1000),
				{ kind: 'heading', label: localize('knox.memoryModeSelective', "Selective") },
				field('float', 'mode_selective_semantic_multiplier', localize('knox.memoryModeSemanticMultiplier', "Semantic multiplier"), localize('knox.memoryModeSemanticMultiplierDesc', "Semantic budget multiplier."), 0.1, 1.5, 0.05),
				field('float', 'mode_selective_min_importance', localize('knox.memoryModeMinImportance', "Min importance"), localize('knox.memoryModeMinImportanceDesc', "Drop below this importance."), 0.5, 1, 0.05),
				field('toggle', 'mode_selective_include_episodic', localize('knox.memorySelectiveIncludeEpisodic', "Include episodic"), localize('knox.memorySelectiveIncludeEpisodicDesc', "Inject episodic in selective mode.")),
				field('toggle', 'mode_selective_include_procedures', localize('knox.memorySelectiveIncludeProcedures', "Include procedures"), localize('knox.memorySelectiveIncludeProceduresDesc', "Inject procedures in selective mode.")),
				field('toggle', 'mode_selective_include_patterns', localize('knox.memorySelectiveIncludePatterns', "Include patterns"), localize('knox.memorySelectiveIncludePatternsDesc', "Inject patterns in selective mode.")),
			],
		},
		{
			id: 'budget',
			title: localize('knox.memoryBudgetSettings', "Budget allocation"),
			collapsible: true,
			entries: [
				field('float', 'budget_semantic_ratio', localize('knox.memoryBudgetSemantic', "Semantic"), localize('knox.memoryBudgetSemanticDesc', "Share of context for semantic memories."), 0.1, 0.7, 0.01),
				field('float', 'budget_episodic_ratio', localize('knox.memoryBudgetEpisodic', "Episodic"), localize('knox.memoryBudgetEpisodicDesc', "Share of context for episodic memories."), 0.05, 0.5, 0.01),
				field('float', 'budget_graph_ratio', localize('knox.memoryBudgetGraph', "Graph"), localize('knox.memoryBudgetGraphDesc', "Share of context for the knowledge graph."), 0.05, 0.4, 0.01),
				field('float', 'budget_procedures_ratio', localize('knox.memoryBudgetProcedures', "Procedures"), localize('knox.memoryBudgetProceduresDesc', "Share of context for procedures."), 0.05, 0.4, 0.01),
				field('float', 'budget_patterns_ratio', localize('knox.memoryBudgetPatterns', "Patterns"), localize('knox.memoryBudgetPatternsDesc', "Share of context for patterns."), 0.05, 0.4, 0.01),
			],
		},
		{
			id: 'fusion',
			title: localize('knox.memoryFusionSettings', "Fusion and recency"),
			collapsible: true,
			entries: [
				{ kind: 'note', text: localize('knox.memoryFusionWeightProfilesDesc', "Fusion ranking uses lexical, semantic, recency, and graph signals.") },
				field('number', 'fusion_candidate_multiplier', localize('knox.memoryFusionCandidateMultiplier', "Candidate multiplier"), localize('knox.memoryFusionCandidateMultiplierDesc', "Candidates = top-k × this."), 2, 20),
				field('number', 'fusion_candidate_min', localize('knox.memoryFusionCandidateMin', "Candidate minimum"), localize('knox.memoryFusionCandidateMinDesc', "Minimum fusion candidates."), 10, 200),
				field('float', 'recency_decay_lambda', localize('knox.memoryRecencyDecayLambda', "Recency decay λ"), localize('knox.memoryRecencyDecayLambdaDesc', "Recency decay in fusion."), 0.001, 0.02, 0.0001),
				field('float', 'graph_depth_decay_gamma', localize('knox.memoryGraphDepthDecayGamma', "Graph depth decay γ"), localize('knox.memoryGraphDepthDecayGammaDesc', "Spreading-activation decay per hop."), 0.3, 0.95, 0.01),
				field('float', 'graph_memory_boost_factor', localize('knox.memoryGraphMemoryBoost', "Graph memory boost"), localize('knox.memoryGraphMemoryBoostDesc', "Boost memories linked to graph hits."), 0.1, 0.8, 0.01),
				field('number', 'graph_neighbor_limit', localize('knox.memoryGraphNeighborLimit', "Neighbor limit"), localize('knox.memoryGraphNeighborLimitDesc', "Neighbors expanded per entity."), 3, 50),
			],
		},
		{
			id: 'compression',
			title: localize('knox.memoryCompressionSettings', "Compression hierarchy"),
			collapsible: true,
			entries: [
				{ kind: 'note', text: localize('knox.memoryCompressionSettingsDesc', "Lower ratios keep less of colder tiers in context.") },
				field('float', 'compression_ratio_hot', localize('knox.memoryCompressionHot', "Hot"), localize('knox.memoryCompressionHotDesc', "Hot-tier keep ratio."), 0.05, 1, 0.01),
				field('float', 'compression_ratio_warm', localize('knox.memoryCompressionWarm', "Warm"), localize('knox.memoryCompressionWarmDesc', "Warm-tier keep ratio."), 0.05, 1, 0.01),
				field('float', 'compression_ratio_cold', localize('knox.memoryCompressionCold', "Cold"), localize('knox.memoryCompressionColdDesc', "Cold-tier keep ratio."), 0.05, 1, 0.01),
				field('float', 'compression_ratio_frozen', localize('knox.memoryCompressionFrozen', "Frozen"), localize('knox.memoryCompressionFrozenDesc', "Frozen-tier keep ratio."), 0.05, 1, 0.01),
			],
		},
		{
			id: 'timeouts',
			title: localize('knox.memoryIntegrationSettings', "Timeouts"),
			collapsible: true,
			entries: [
				field('number', 'memory_build_timeout_ms', localize('knox.memoryBuildTimeout', "Build timeout"), localize('knox.memoryBuildTimeoutDesc', "memory/buildContext timeout."), 1000, 30000, 100, ms),
				field('number', 'memory_track_session_timeout_ms', localize('knox.memoryTrackSessionTimeout', "Track-session timeout"), localize('knox.memoryTrackSessionTimeoutDesc', "brain/trackSession timeout."), 500, 10000, 100, ms),
			],
		},
		{
			id: 'graph',
			title: localize('knox.memoryGraphSettings', "Knowledge graph"),
			entries: [
				field('number', 'graph_max_entities', localize('knox.memoryGraphMaxEntities', "Max entities"), localize('knox.memoryGraphMaxEntitiesDesc', "Hard cap; LRU eviction when full."), 500, 10000),
				field('number', 'graph_max_depth', localize('knox.memoryGraphMaxDepth', "Max depth"), localize('knox.memoryGraphMaxDepthDesc', "BFS explore depth."), 1, 5),
				{
					kind: 'select',
					key: 'memory_scope',
					label: localize('knox.memoryScope', "Scope"),
					description: localize('knox.memoryScopeDesc', "Project vs global memory."),
					options: [
						{ value: 'project', label: localize('knox.memoryScopeProject', "Project") },
						{ value: 'global', label: localize('knox.memoryScopeGlobal', "Global") },
					],
				},
				field('toggle', 'enable_knowledge_extraction', localize('knox.memoryKnowledgeExtraction', "Knowledge extraction"), localize('knox.memoryKnowledgeExtractionDesc', "Extract entities from turns.")),
				field('number', 'post_turn_min_chars', localize('knox.memoryPostTurnMinChars', "Post-turn min chars"), localize('knox.memoryPostTurnMinCharsDesc', "Skip extraction below this length."), 20, 2000),
				field('toggle', 'auto_summarize', localize('knox.memoryAutoSummarize', "Auto summarize"), localize('knox.memoryAutoSummarizeDesc', "Summarize long sessions.")),
				field('number', 'summarize_threshold', localize('knox.memorySummarizeThreshold', "Summarize threshold"), localize('knox.memorySummarizeThresholdDesc', "Messages before auto-summarize."), 10, 500),
			],
		},
		{
			id: 'tiering',
			title: localize('knox.memoryTieringSettings', "Tiering"),
			entries: [
				field('number', 'hot_to_warm_hours', localize('knox.memoryHotToWarm', "Hot → warm"), localize('knox.memoryHotToWarmDesc', "Hours before hot demotes."), 1, 720, 1, hours),
				field('number', 'warm_to_cold_days', localize('knox.memoryWarmToCold', "Warm → cold"), localize('knox.memoryWarmToColdDesc', "Days before warm demotes."), 1, 365, 1, days),
				field('number', 'cold_prune_days', localize('knox.memoryColdPrune', "Cold prune"), localize('knox.memoryColdPruneDesc', "Days before cold memories prune."), 7, 3650, 1, days),
			],
		},
		{
			id: 'features',
			title: localize('knox.memoryFeatureSettings', "Features"),
			entries: [
				field('toggle', 'graph_enabled', localize('knox.memoryGraphEnabled', "Knowledge graph"), localize('knox.memoryGraphEnabledDesc', "Enable graph storage and retrieval.")),
				field('toggle', 'learning_enabled', localize('knox.memoryLearningEnabled', "Learning"), localize('knox.memoryLearningEnabledDesc', "Enable post-turn learning.")),
				field('toggle', 'llm_entity_extraction_enabled', localize('knox.memoryLlmExtraction', "LLM entity extraction"), localize('knox.memoryLlmExtractionDesc', "Use the LLM to extract entities.")),
				field('toggle', 'llm_summarization_enabled', localize('knox.memoryLlmSummarization', "LLM summarization"), localize('knox.memoryLlmSummarizationDesc', "Use the LLM to summarize sessions.")),
				field('toggle', 'llm_importance_scoring_enabled', localize('knox.memoryLlmImportance', "LLM importance"), localize('knox.memoryLlmImportanceDesc', "Score importance with the LLM.")),
				field('toggle', 'llm_post_action_memory_enabled', localize('knox.memoryLlmPostAction', "LLM post-action memory"), localize('knox.memoryLlmPostActionDesc', "Store memories after tool actions.")),
			],
		},
	];
}

function field(
	kind: KnoxMemorySettingKind,
	key: keyof IKnoxMemoryConfig,
	label: string,
	description: string,
	min?: number,
	max?: number,
	step?: number,
	suffix?: string,
	scale?: number,
): IKnoxMemorySettingField {
	return { kind, key, label, description, min, max, step, suffix, scale };
}
