/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass, KnoxGuiIconName } from '../knoxGuiIcons.js';
import { IKnoxGuiBridge } from '../../common/knoxGuiProtocol.js';
import {
	IKnoxEffectiveContext,
	IKnoxEbbinghausStats,
	IKnoxMemoryDashboard,
	IKnoxMetricsTrend,
	IKnoxPhaseStatus,
	IKnoxReviewDueItem,
	KNOX_MEMORY_CYCLE_PHASES,
	KNOX_MEMORY_PROTOCOL,
	KNOX_MEMORY_STATUS_COLORS,
	KNOX_MEMORY_TIER_COLORS,
	KNOX_MEMORY_TREND_COLORS,
	KNOX_SLEEP_PHASE_LABELS,
	knoxMemoryDbSize,
	knoxMemoryTimeAgo,
	knoxParseDashboard,
	knoxParseEbbinghausStats,
	knoxParseEffectiveContext,
	knoxParseMetricsTrend,
	knoxParsePhaseStatus,
	knoxParseReviewDue,
} from '../../common/knoxMemory.js';

export class KnoxMemoryOverview extends Disposable {

	readonly element: HTMLElement;
	private readonly _viewStore = this._register(new DisposableStore());
	private _loading = false;

	constructor(
		parent: HTMLElement,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
	) {
		super();
		this.element = append(parent, $('.knox-memory-tab'));
		void this.refresh();
	}

	refresh(): void {
		void this._load();
	}

	private async _load(): Promise<void> {
		if (this._loading) {
			return;
		}
		this._loading = true;
		this._viewStore.clear();
		clearNode(this.element);
		muted(this.element, localize('knox.memoryLoadingDashboard', "Loading dashboard…"));
		try {
			const [dashboardRaw, effectiveRaw, trendRaw, phaseRaw, reviewRaw, ebbRaw] = await Promise.all([
				this._bridge.request(KNOX_MEMORY_PROTOCOL.dashboard),
				this._bridge.request(KNOX_MEMORY_PROTOCOL.getEffectiveContext),
				this._bridge.request(KNOX_MEMORY_PROTOCOL.getMetricsTrend, { hours: 24 }),
				this._bridge.request(KNOX_MEMORY_PROTOCOL.getPhaseStatus),
				this._bridge.request(KNOX_MEMORY_PROTOCOL.getReviewDue, { limit: 8 }),
				this._bridge.request(KNOX_MEMORY_PROTOCOL.getEbbinghausStats),
			]);
			const dashboard = knoxParseDashboard(dashboardRaw);
			this._render(
				dashboard,
				knoxParseEffectiveContext(effectiveRaw),
				knoxParseMetricsTrend(trendRaw),
				knoxParsePhaseStatus(phaseRaw),
				knoxParseReviewDue(reviewRaw),
				knoxParseEbbinghausStats(ebbRaw),
			);
		} catch (error) {
			this._renderEmpty(error instanceof Error ? error.message : String(error));
		} finally {
			this._loading = false;
		}
	}

	private _renderEmpty(message?: string): void {
		this._viewStore.clear();
		clearNode(this.element);
		muted(this.element, message || localize('knox.memoryNoData', "No memory data yet."));
		this._tool(this.element, 'refresh-cw', localize('knox.memoryRetry', "Retry"), () => void this._load());
	}

	private _render(
		data: IKnoxMemoryDashboard | undefined,
		effective: IKnoxEffectiveContext | undefined,
		trend: IKnoxMetricsTrend | undefined,
		phase: IKnoxPhaseStatus | undefined,
		reviewDue: IKnoxReviewDueItem[],
		ebbinghaus: IKnoxEbbinghausStats | undefined,
	): void {
		this._viewStore.clear();
		clearNode(this.element);
		if (!data) {
			this._renderEmpty();
			return;
		}
		const { stats, health, graphStats, sessions, healthScore, consolidation } = data;
		const totalMemories = stats.total_episodic + stats.total_semantic;
		const healthScoreValue = healthScore?.overall ?? healthScore?.score ?? 0;
		const statusColor = KNOX_MEMORY_STATUS_COLORS[health.status] ?? '#6b7280';

		const banner = append(this.element, $('.knox-memory-health'));
		banner.style.borderColor = statusColor;
		append(banner, $('span')).className = knoxGuiIconClass('lucide-brain');
		const grade = append(banner, $('span.knox-memory-grade'));
		grade.style.background = statusColor;
		grade.textContent = healthScore?.grade || health.status.slice(0, 1).toUpperCase();
		const bannerBody = append(banner, $('.knox-memory-health-body'));
		append(bannerBody, $('div.knox-memory-health-title')).textContent = localize('knox.memorySystemStatus', "System status: {0}", health.status);
		append(bannerBody, $('div.knox-muted')).textContent = healthScore
			? localize('knox.memoryHealthScore', "Health score: {0}/100", healthScoreValue)
			: localize('knox.memoryTotalMemories', "{0} memories", totalMemories.toLocaleString());
		const bannerActions = append(banner, $('.knox-history-toolbar-actions'));
		this._tool(bannerActions, 'refresh-cw', localize('knox.memoryRefresh', "Refresh"), () => void this._load());
		this._tool(bannerActions, 'zap', localize('knox.memoryConsolidate', "Consolidate"), () => void this._consolidate(), 'primary');

		const statsGrid = append(this.element, $('.knox-memory-stats'));
		stat(statsGrid, localize('knox.memorySemantic', "Semantic"), stats.total_semantic, 'lucide-brain');
		stat(statsGrid, localize('knox.memoryEpisodic', "Episodic"), stats.total_episodic, 'file-text');
		stat(statsGrid, localize('knox.memoryEntities', "Entities"), stats.total_entities, 'link');
		stat(statsGrid, localize('knox.memorySessions', "Sessions"), stats.total_sessions, 'lucide-globe');
		stat(statsGrid, localize('knox.memoryEdges', "Edges"), stats.total_edges, 'refresh-cw');
		stat(statsGrid, localize('knox.memoryPatterns', "Patterns"), stats.total_patterns, 'bar-chart-3');
		stat(statsGrid, localize('knox.memoryProcedures', "Procedures"), stats.total_procedures, 'clipboard-list');
		stat(statsGrid, localize('knox.memoryDbSize', "DB size"), knoxMemoryDbSize(stats.db_size_bytes), 'hard-drive');

		if (ebbinghaus) {
			const card = section(this.element, localize('knox.memorySpacedRepetition', "Spaced repetition"), 'lucide-brain');
			const grid = append(card, $('.knox-memory-stats'));
			stat(grid, localize('knox.memoryReviewDueCount', "Review due"), ebbinghaus.review_due_count);
			stat(grid, localize('knox.memoryAvgRetention', "Avg retention"), `${(ebbinghaus.avg_retention * 100).toFixed(0)}%`);
			stat(grid, localize('knox.memoryDecayRate', "Decay rate"), `λ=${ebbinghaus.config.lambda}`);
			if (reviewDue.length) {
				for (const item of reviewDue) {
					row(card, `${item.overdue ? '⚠ ' : ''}[${item.category}] ${item.title}`, `R=${(item.current_retention * 100).toFixed(0)}%`);
				}
			} else {
				muted(card, localize('knox.memoryNoReviewDue', "Nothing is due for review."));
			}
		}

		if (phase) {
			const card = section(this.element, localize('knox.memoryCyclePhases', "Memory cycle"), 'refresh-cw');
			append(card, $('div.knox-muted')).textContent = phase.cycle_invariant_met
				? localize('knox.memoryCycleInvariantMet', "Cycle invariant met")
				: localize('knox.memoryCycleInvariantIdle', "Cycle idle");
			if (phase.background_sleep_active) {
				const badge = append(card, $('span.knox-memory-chip'));
				badge.textContent = `φ₇ ${localize('knox.memoryPhaseSleep', "Sleep")} active`;
			}
			const grid = append(card, $('.knox-memory-phase-grid'));
			KNOX_MEMORY_CYCLE_PHASES.forEach((item, index) => {
				const cell = append(grid, $('.knox-memory-phase'));
				const active = phase.active_phase === item.id || phase.last_completed?.phase === item.id;
				cell.classList.toggle('active', active);
				append(cell, $('span')).textContent = `φ${index + 1} ${item.label()}`;
				append(cell, $('span.knox-muted')).textContent = String(phase.phase_counts[item.id] || '—');
			});
		}

		if (effective) {
			const card = section(this.element, localize('knox.memoryEffectiveContext', "Effective context"), 'layers');
			muted(card, localize('knox.memoryEffectiveContextFormula', "C_effective = window + hierarchy + graph."));
			const grid = append(card, $('.knox-memory-stats'));
			stat(grid, localize('knox.memoryActiveWindow', "Active window"), effective.active_window_tokens.toLocaleString());
			if (effective.last_context_tokens_used) {
				stat(grid, localize('knox.memoryContextTokensUsed', "Tokens used"), effective.last_context_tokens_used.toLocaleString());
			}
			stat(grid, localize('knox.memoryHierarchyEffective', "Hierarchy"), Math.round(effective.hierarchy_effective_tokens).toLocaleString());
			stat(grid, localize('knox.memoryGraphEntities', "Graph entities"), effective.graph_max_entities
				? `${effective.graph_entity_count}/${effective.graph_max_entities}`
				: String(effective.graph_entity_count));
			stat(grid, localize('knox.memoryTotalEffective', "Total effective"), Math.round(effective.total_effective).toLocaleString());
			if (effective.memory_tokens_saved) {
				stat(grid, localize('knox.memoryTokensSaved', "Tokens saved"), effective.memory_tokens_saved.toLocaleString());
			}
			if (effective.window_utilization) {
				bar(card, localize('knox.memoryContextUtilization', "Context utilization"), effective.window_utilization);
			}
			for (const level of effective.memory_levels ?? []) {
				if (!level.tokens && !level.effective_tokens) {
					continue;
				}
				row(card, `${level.id} ${level.name}`, `${level.tokens.toLocaleString()} / r=${level.ratio} → ${Math.round(level.effective_tokens).toLocaleString()}`);
			}
			for (const tier of ['active', 'hot', 'warm', 'cold', 'frozen'] as const) {
				const tokens = effective.tier_tokens[tier] ?? 0;
				if (!tokens) {
					continue;
				}
				const ratio = effective.compression_ratios[tier] ?? 1;
				row(card, tier, `${tokens.toLocaleString()} / r=${ratio} → ${Math.round(tokens / ratio).toLocaleString()}`);
			}
		}

		if (graphStats?.max_entities != null) {
			const card = section(this.element, localize('knox.memoryKnowledgeGraphCap', "Knowledge graph cap"), 'link');
			const grid = append(card, $('.knox-memory-stats'));
			stat(grid, localize('knox.memoryGraphEntities', "Graph entities"), `${graphStats.total_entities}/${graphStats.max_entities}`);
			stat(grid, localize('knox.memoryEdges', "Edges"), graphStats.total_edges);
			stat(grid, localize('knox.memoryGraphBfsDepth', "BFS depth"), graphStats.max_depth ?? 3);
			stat(grid, localize('knox.memoryGraphDepthDecayGamma', "Depth decay"), `γ=${graphStats.depth_decay_gamma ?? 0.7}`);
			if (graphStats.max_entities) {
				bar(card, localize('knox.memoryGraphCapUtilization', "Cap utilization"), graphStats.cap_utilization ?? 0, graphStats.at_cap ? '#f59e0b' : undefined);
				if (graphStats.at_cap) {
					muted(card, localize('knox.memoryGraphAtCap', "At cap — LRU eviction"));
				}
			}
		}

		if (trend) {
			const card = section(this.element, localize('knox.memoryMetricsTrend', "24h trend"), 'bar-chart-3');
			if (!trend.snapshots.length) {
				muted(card, localize('knox.memoryNoMetricsSnapshots', "No metric snapshots yet."));
			} else {
				const grid = append(card, $('.knox-memory-stats'));
				if (trend.effective_context_trend) {
					trendStat(grid, localize('knox.memoryTrendEffectiveContext', "Effective context"), trend.effective_context_trend, Math.round(trend.snapshots[0].total_effective ?? 0).toLocaleString());
				}
				trendStat(grid, localize('knox.memoryTrendResponse', "Response"), trend.avg_response_trend, `${trend.snapshots[0].avg_response_ms.toFixed(0)}ms`);
				trendStat(grid, localize('knox.memoryTrendSuccess', "Success"), trend.success_rate_trend, `${(trend.snapshots[0].success_rate * 100).toFixed(1)}%`);
				trendStat(grid, localize('knox.memoryTrendGrowth', "Growth"), trend.growth_rate_trend, String(trend.snapshots[0].memory_count));
				if (trend.compression_trend) {
					trendStat(grid, localize('knox.memoryTrendCompression', "Compression"), trend.compression_trend, String(trend.snapshots[0].memory_tokens_saved ?? 0));
				}
				muted(card, localize('knox.memoryTrendPeriod', "{0}h · {1} snapshots", trend.period_hours, trend.snapshots.length));
			}
		}

		const tiers = section(this.element, localize('knox.memoryTierDistribution', "Tier distribution"), 'bar-chart-3');
		const tierTotal = stats.tier_counts.hot + stats.tier_counts.warm + stats.tier_counts.cold;
		for (const tier of ['hot', 'warm', 'cold'] as const) {
			const count = stats.tier_counts[tier];
			const pct = tierTotal > 0 ? count / tierTotal : 0;
			bar(tiers, `${tierLabel(tier)} · ${count.toLocaleString()}`, pct, KNOX_MEMORY_TIER_COLORS[tier]);
		}

		const split = append(this.element, $('.knox-memory-split'));
		const cats = section(split, localize('knox.memoryCategoryBreakdown', "Categories"), 'lucide-folder-open');
		const catEntries = Object.entries(stats.category_counts).sort((a, b) => b[1] - a[1]);
		if (!catEntries.length) {
			muted(cats, localize('knox.memoryNoCategoriesYet', "No categories yet."));
		} else {
			for (const [name, count] of catEntries) {
				row(cats, name.replace(/_/g, ' '), String(count));
			}
		}
		const types = section(split, localize('knox.memoryEntityTypes', "Entity types"), 'tag');
		const typeEntries = Object.entries(stats.entity_type_counts).sort((a, b) => b[1] - a[1]);
		if (!typeEntries.length) {
			muted(types, localize('knox.memoryNoEntitiesYet', "No entities yet."));
		} else {
			for (const [name, count] of typeEntries) {
				row(types, name.replace(/_/g, ' '), String(count));
			}
		}

		if (health.issues.length) {
			const card = section(this.element, localize('knox.memoryHealthIssues', "Health issues"), 'alert-triangle');
			for (const issue of health.issues) {
				muted(card, issue);
			}
		}
		if (health.recommendations.length) {
			const card = section(this.element, localize('knox.memoryRecommendations', "Recommendations"), 'lightbulb');
			for (const rec of health.recommendations) {
				muted(card, rec);
			}
		}

		const recent = section(this.element, localize('knox.memoryRecentSessions', "Recent sessions"), 'message-square');
		if (!sessions.length) {
			muted(recent, localize('knox.memoryNoSessionsYet', "No sessions yet."));
		} else {
			for (const session of sessions.slice(0, 5)) {
				row(recent, session.title || session.id, knoxMemoryTimeAgo(session.updated_at || session.created_at));
			}
		}

		if (consolidation) {
			const card = section(this.element, localize('knox.memoryConsolidationStats', "Consolidation"), 'zap');
			const grid = append(card, $('.knox-memory-stats'));
			stat(grid, localize('knox.memoryTotalRuns', "Runs"), consolidation.total_runs);
			stat(grid, localize('knox.memoryLastRun', "Last run"), knoxMemoryTimeAgo(consolidation.last_run_at));
			stat(grid, localize('knox.memoryAvgDuration', "Avg duration"), consolidation.avg_duration_ms > 0 ? `${consolidation.avg_duration_ms.toFixed(0)}ms` : '—');
			for (const [key, count] of Object.entries(consolidation.last_sub_phases ?? {})) {
				if (count > 0) {
					row(card, KNOX_SLEEP_PHASE_LABELS[key] ?? key, String(count));
				}
			}
		}

		const footer = append(this.element, $('.knox-memory-footer'));
		append(footer, $('span')).textContent = localize('knox.memoryOldest', "Oldest: {0}", knoxMemoryTimeAgo(stats.oldest_memory));
		append(footer, $('span')).textContent = localize('knox.memoryNewest', "Newest: {0}", knoxMemoryTimeAgo(stats.newest_memory));
	}

	private async _consolidate(): Promise<void> {
		try {
			await this._bridge.request(KNOX_MEMORY_PROTOCOL.consolidate);
		} finally {
			await this._load();
		}
	}

	private _tool(parent: HTMLElement, icon: KnoxGuiIconName, label: string, run: () => void, kind?: string): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button.knox-history-tool'));
		button.type = 'button';
		if (kind) {
			button.classList.add(kind);
		}
		append(button, $('span')).className = knoxGuiIconClass(icon);
		append(button, $('span')).textContent = label;
		this._viewStore.add(addDisposableListener(button, 'click', run));
		return button;
	}
}

function muted(parent: HTMLElement, text: string): HTMLElement {
	const p = append(parent, $('p.knox-muted'));
	p.textContent = text;
	return p;
}

function section(parent: HTMLElement, title: string, icon?: KnoxGuiIconName): HTMLElement {
	const card = append(parent, $('.knox-checkpoint-card'));
	const heading = append(card, $('h3'));
	if (icon) {
		append(heading, $('span')).className = knoxGuiIconClass(icon);
	}
	append(heading, $('span')).textContent = title;
	return card;
}

function stat(parent: HTMLElement, label: string, value: string | number, icon?: KnoxGuiIconName): void {
	const card = append(parent, $('.knox-memory-stat'));
	if (icon) {
		append(card, $('span')).className = knoxGuiIconClass(icon);
	}
	append(card, $('div.knox-memory-stat-value')).textContent = typeof value === 'number' ? value.toLocaleString() : value;
	append(card, $('div.knox-muted')).textContent = label;
}

function trendStat(parent: HTMLElement, label: string, trend: string, detail: string): void {
	const card = append(parent, $('.knox-memory-stat'));
	const value = append(card, $('div.knox-memory-stat-value'));
	value.textContent = trend;
	value.style.color = KNOX_MEMORY_TREND_COLORS[trend] ?? 'var(--knox-cyan)';
	append(card, $('div.knox-muted')).textContent = label;
	append(card, $('div.knox-muted')).textContent = detail;
}

function row(parent: HTMLElement, left: string, right: string): void {
	const line = append(parent, $('.knox-memory-kv'));
	append(line, $('span')).textContent = left;
	append(line, $('span.knox-muted')).textContent = right;
}

function bar(parent: HTMLElement, label: string, ratio: number, color?: string): void {
	const wrap = append(parent, $('.knox-memory-bar-wrap'));
	const header = append(wrap, $('.knox-memory-kv'));
	append(header, $('span')).textContent = label;
	append(header, $('span.knox-muted')).textContent = `${(Math.min(1, Math.max(0, ratio)) * 100).toFixed(1)}%`;
	const track = append(wrap, $('.knox-memory-bar'));
	const fill = append(track, $('.knox-memory-bar-fill'));
	fill.style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
	if (color) {
		fill.style.background = color;
	}
}

function tierLabel(tier: 'hot' | 'warm' | 'cold'): string {
	switch (tier) {
		case 'hot': return localize('knox.memoryTierHot', "Hot");
		case 'warm': return localize('knox.memoryTierWarm', "Warm");
		case 'cold': return localize('knox.memoryTierCold', "Cold");
	}
}
