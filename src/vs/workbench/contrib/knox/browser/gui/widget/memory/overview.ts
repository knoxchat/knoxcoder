/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Overview tab: health banner, stats, spaced repetition, cycle phases, context, graph cap, trends, tiers, categories and sessions. */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import { KnoxGuiSvgIcon } from '../../knoxGuiIcons.js';
import {
	dashboardHealthGrade,
	formatBytes,
	formatMemoryTimeAgo,
	healthStatusColor,
	MEMORY_CATEGORY_ICONS,
	MEMORY_CYCLE_PHASES,
	MEMORY_EFFECTIVE_TIERS,
	MEMORY_SLEEP_PHASE_LABELS,
	MEMORY_TIER_COLORS,
} from '../../../../common/knoxGuiMemory.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import {
	memoryClasses,
	mk,
	svg,
	spinner,
	memoryButton,
} from './kit.js';
import {
	sectionCard,
	statCard,
	metricCell,
	trendCell,
	meterHead,
	meterBar,
} from './cards.js';

/** Spinner block: `flex items-center justify-center py-12` (+ `text-sm opacity-60` caption). */
function renderCenteredLoading(body: HTMLElement, size: number, caption?: string): HTMLElement {
	const wrap = mk(body, 'div', 'center py-12');
	if (caption) {
		const col = mk(wrap, 'div', 'loading-col');
		spinner(col, size);
		mk(col, 'span', 'sm o-60', caption);
	} else {
		spinner(wrap, size);
	}
	return wrap;
}

export function renderMemoryOverview(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void { // KN-376 KN-310–313
	const d = state.memoryDashboard;
	if (state.memoryOverviewLoading || (!d && state.memoryBusy)) {
		const loading = renderCenteredLoading(body, 32, t(state, 'memoryLoadingDashboard'));
		if (state.memoryOverviewLoading) {
			loading.setAttribute('data-testid', 'memory-overview-loading');
		}
		return;
	}
	if (!d) {
		const wrap = mk(body, 'div', 'center py-12');
		const box = mk(wrap, 'div', 'text-center');
		svg(box, 'brain', 28, 'teal');
		mk(box, 'p', 'mt-2 sm o-60', t(state, 'memoryNoData'));
		memoryButton(widget, box, { tokens: 'retry mt-3 btn-primary', label: t(state, 'memoryRetry'), onClick: () => void widget.controller.loadMemoryOverview({ showLoading: true }) });
		return;
	}
	body.classList.add(...memoryClasses('py-4 sy-4').split(' '));
	const healthStatus = d.healthStatus ?? 'healthy';
	const healthColor = healthStatusColor(healthStatus);
	const totalMemories = d.totalEpisodic + d.totalSemantic;
	const banner = mk(body, 'div', 'health-banner');
	banner.style.borderColor = healthColor;
	banner.style.backgroundColor = `${healthColor}10`;
	const left = mk(banner, 'div', 'flex items-center gap-3');
	const grade = mk(left, 'div', 'health-grade', d.healthGrade || dashboardHealthGrade(d.healthScore) || healthStatus.slice(0, 1).toUpperCase());
	grade.style.backgroundColor = healthColor;
	const status = mk(left, 'div', '');
	mk(status, 'div', 'sm fw-6 capitalize', `${t(state, 'memorySystemStatus')}: ${healthStatus}`);
	mk(status, 'div', 'xs o-70', d.healthScore != null ? `${t(state, 'memoryHealthScore')}: ${d.healthScore}/100` : `${totalMemories.toLocaleString()} ${t(state, 'memoryTotalMemories')}`);
	const actions = mk(banner, 'div', 'flex items-center gap-2');
	memoryButton(widget, actions, { tokens: 'pill-btn btn-secondary', icon: 'refresh-cw', label: t(state, 'memoryRefresh'), onClick: () => void widget.controller.loadMemoryOverview() });
	memoryButton(widget, actions, {
		tokens: 'pill-btn btn-primary',
		icon: 'zap',
		spinning: state.memoryConsolidating,
		label: t(state, 'memoryConsolidate'),
		disabled: state.memoryConsolidating,
		testId: 'memory-consolidate',
		onClick: () => void widget.controller.consolidateMemory(),
	});

	const stats = mk(body, 'div', 'stat-grid');
	statCard(stats, 'brain', t(state, 'memorySemantic'), d.totalSemantic);
	statCard(stats, 'file-text', t(state, 'memoryEpisodic'), d.totalEpisodic);
	statCard(stats, 'link', t(state, 'memoryEntities'), d.totalEntities);
	statCard(stats, 'globe', t(state, 'memorySessions'), d.totalSessions);
	statCard(stats, 'refresh-cw', t(state, 'memoryEdges'), d.totalEdges);
	statCard(stats, 'bar-chart-3', t(state, 'memoryPatterns'), d.totalPatterns ?? 0);
	statCard(stats, 'clipboard-list', t(state, 'memoryProcedures'), d.totalProcedures ?? 0);
	statCard(stats, 'hard-drive', t(state, 'memoryDbSize'), formatBytes(d.dbSizeBytes));

	if (state.memoryEbbinghausStats) {
		const card = sectionCard(body, t(state, 'memorySpacedRepetition'), 'brain');
		const ebb = mk(card, 'div', 'metric-grid');
		metricCell(ebb, String(state.memoryEbbinghausStats.reviewDueCount), t(state, 'memoryReviewDueCount'));
		metricCell(ebb, `${Math.round(state.memoryEbbinghausStats.avgRetention * 100)}%`, t(state, 'memoryAvgRetention'));
		if (state.memoryEbbinghausStats.lambda != null) {
			metricCell(ebb, `λ=${state.memoryEbbinghausStats.lambda}`, t(state, 'memoryDecayRate'));
		}
		if (state.memoryReviewDue.length) {
			const list = mk(card, 'div', 'divided mt-3 pt-2 sy-1');
			mk(list, 'div', 'xs fw-5 o-70 mb-1', t(state, 'memoryReviewDueList'));
			for (const item of state.memoryReviewDue) {
				const row = mk(list, 'div', 'kv xs o-80');
				mk(row, 'span', 'truncate pr-2', `${item.overdue ? '⚠ ' : ''}${item.category ? `[${item.category}] ` : ''}${item.title}`);
				if (item.currentRetention != null) {
					mk(row, 'span', 'shrink-0 mono', `R=${Math.round(item.currentRetention * 100)}%`);
				}
			}
		} else {
			mk(card, 'div', 'mt-2 xs o-60', t(state, 'memoryNoReviewDue'));
		}
	}

	const phase = state.memoryPhaseStatus;
	if (phase) {
		const phaseCard = sectionCard(body, t(state, 'memoryCyclePhases'), 'refresh-cw');
		const phaseHead = mk(phaseCard, 'div', 'kv mb-2 xs');
		mk(phaseHead, 'span', 'o-70', phase.cycleInvariantMet ? t(state, 'memoryCycleInvariantMet') : t(state, 'memoryCycleInvariantIdle'));
		if (phase.backgroundSleepActive) {
			mk(phaseHead, 'span', 'teal-badge px-1_5 py-0_5 o-80', `φ₇ ${t(state, 'memoryPhaseSleep')} active`);
		}
		const phases = mk(phaseCard, 'div', 'phase-grid');
		const counts = phase.phaseCounts ?? {};
		MEMORY_CYCLE_PHASES.forEach((item, idx) => {
			const isActive = phase.activePhase === item.id;
			const isLast = phase.lastCompleted === item.id;
			const cell = mk(phases, 'div', 'phase-cell');
			if (isActive || isLast) {
				cell.style.borderColor = '#159994';
			}
			if (isActive) {
				cell.style.backgroundColor = '#15999415';
			}
			mk(cell, 'span', 'o-80', `φ${idx + 1} ${t(state, item.labelKey)}`);
			const count = counts[item.id] ?? 0;
			mk(cell, 'span', 'mono o-60', count > 0 ? String(count) : '—');
		});
	}

	if (state.memoryEffectiveContext) {
		const ctx = state.memoryEffectiveContext;
		const card = sectionCard(body, t(state, 'memoryEffectiveContext'), 'layers');
		mk(card, 'p', 'mb-3 xs o-60', t(state, 'memoryEffectiveContextFormula'));
		const grid = mk(card, 'div', 'stat-grid');
		if (ctx.activeWindowTokens != null) {
			statCard(grid, 'target', t(state, 'memoryActiveWindow'), ctx.activeWindowTokens.toLocaleString());
		}
		if ((ctx.lastContextTokensUsed ?? 0) > 0) {
			statCard(grid, 'file-text', t(state, 'memoryContextTokensUsed'), ctx.lastContextTokensUsed!.toLocaleString());
		}
		statCard(grid, 'bar-chart-3', t(state, 'memoryHierarchyEffective'), Math.round(ctx.hierarchyEffectiveTokens ?? 0).toLocaleString());
		statCard(grid, 'link', t(state, 'memoryGraphEntities'), ctx.graphMaxEntities ? `${ctx.graphEntityCount ?? 0}/${ctx.graphMaxEntities}` : String(ctx.graphEntityCount ?? 0));
		statCard(grid, 'zap', t(state, 'memoryTotalEffective'), Math.round(ctx.totalEffective).toLocaleString());
		if ((ctx.memoryTokensSaved ?? 0) > 0) {
			statCard(grid, 'minimize-2', t(state, 'memoryTokensSaved'), ctx.memoryTokensSaved!.toLocaleString());
		}
		if ((ctx.windowUtilization ?? 0) > 0) {
			const meter = mk(card, 'div', 'mt-3 sy-1');
			meterHead(meter, t(state, 'memoryContextUtilization'), `${((ctx.windowUtilization ?? 0) * 100).toFixed(1)}%`);
			meterBar(meter, Math.min(100, (ctx.windowUtilization ?? 0) * 100), '#159994');
		}
		const visibleLevels = ctx.levels.filter(level => level.tokens !== 0 || (level.effectiveTokens ?? 0) !== 0);
		if (visibleLevels.length) {
			const levels = mk(card, 'div', 'divided mt-3 pt-3 sy-1');
			mk(levels, 'div', 'xs fw-5 o-70 mb-1', 'M₁–M₅ Hierarchy');
			for (const level of visibleLevels) {
				const row = mk(levels, 'div', 'kv xs o-80');
				mk(row, 'span', '', `${level.id} ${level.name}`);
				mk(row, 'span', '', `${level.tokens.toLocaleString()} / r=${level.ratio ?? 1} → ${Math.round(level.effectiveTokens ?? 0).toLocaleString()}`);
			}
			if ((ctx.workingMemoryBudget ?? 0) > 0) {
				const row = mk(levels, 'div', 'kv xs o-60');
				mk(row, 'span', '', 'M₂ budget cap');
				mk(row, 'span', '', `${ctx.workingMemoryBudget?.toLocaleString()} tokens`);
			}
		}
		const tiers = mk(card, 'div', 'mt-3 sy-1');
		for (const tier of MEMORY_EFFECTIVE_TIERS) {
			const tokens = ctx.tierTokens?.[tier] ?? 0;
			if (!tokens) {
				continue;
			}
			const ratio = ctx.compressionRatios?.[tier] ?? 1;
			const row = mk(tiers, 'div', 'kv xs o-80');
			mk(row, 'span', 'capitalize', tier);
			mk(row, 'span', '', `${tokens.toLocaleString()} tokens / r=${ratio} → ${Math.round(tokens / ratio).toLocaleString()}`);
		}
	}

	if (d.graphMaxEntities) {
		const card = sectionCard(body, t(state, 'memoryKnowledgeGraphCap'), 'link');
		const grid = mk(card, 'div', 'stat-grid');
		statCard(grid, 'link', t(state, 'memoryGraphEntities'), `${d.graphTotalEntities ?? d.totalEntities}/${d.graphMaxEntities}`);
		statCard(grid, 'refresh-cw', t(state, 'memoryEdges'), d.graphTotalEdges ?? d.totalEdges);
		statCard(grid, 'compass', t(state, 'memoryGraphBfsDepth'), d.graphMaxDepth ?? 3);
		statCard(grid, 'bar-chart-3', t(state, 'memoryGraphDepthDecayGamma'), `γ=${d.graphDepthDecayGamma ?? 0.7}`);
		const meter = mk(card, 'div', 'mt-3 sy-1');
		const value = meterHead(meter, t(state, 'memoryGraphCapUtilization'), `${((d.graphCapUtilization ?? 0) * 100).toFixed(1)}%`);
		if (d.graphAtCap) {
			mk(value, 'span', 'ml-1 text-yellow-500', t(state, 'memoryGraphAtCap'));
		}
		meterBar(meter, Math.min(100, (d.graphCapUtilization ?? 0) * 100), d.graphAtCap ? '#f59e0b' : '#159994');
		mk(meter, 'p', 't-10 o-50', t(state, 'memoryGraphCapLruHint'));
	}

	const trend = state.memoryMetricsTrend;
	if (trend) {
		const card = sectionCard(body, t(state, 'memoryMetricsTrend'), 'bar-chart-3');
		if (!trend.snapshots?.length) {
			mk(card, 'p', 'xs o-60', t(state, 'memoryNoMetricsSnapshots'));
		} else {
			const grid = mk(card, 'div', 'trend-grid');
			const snap = trend.snapshots[0];
			trendCell(grid, trend.effectiveContext, t(state, 'memoryTrendEffectiveContext'), snap.totalEffective != null ? Math.round(snap.totalEffective).toLocaleString() : undefined);
			trendCell(grid, trend.response, t(state, 'memoryTrendResponse'), `${snap.avgResponseMs.toFixed(0)}ms`);
			trendCell(grid, trend.success, t(state, 'memoryTrendSuccess'), `${(snap.successRate * 100).toFixed(1)}%`);
			trendCell(grid, trend.growth, t(state, 'memoryTrendGrowth'), `${snap.memoryCount.toLocaleString()} ${t(state, 'memoryTotalMemories').toLowerCase()}`);
			trendCell(grid, trend.compression, t(state, 'memoryTrendCompression'), snap.tokensSaved != null ? `${snap.tokensSaved.toLocaleString()} ${t(state, 'memoryTokensSaved').toLowerCase()}` : undefined);
			if (trend.periodHours != null) {
				mk(card, 'div', 'mt-2 text-center t-10 o-50', t(state, 'memoryTrendPeriod', { hours: trend.periodHours, count: trend.snapshots.length }));
			}
		}
	}

	const tierCard = sectionCard(body, t(state, 'memoryTierDistribution'), 'bar-chart-3');
	const tierList = mk(tierCard, 'div', 'sy-2');
	const tierCounts = d.tierCounts ?? {};
	const tierTotal = (tierCounts.hot ?? 0) + (tierCounts.warm ?? 0) + (tierCounts.cold ?? 0);
	for (const tier of ['hot', 'warm', 'cold'] as const) {
		const count = tierCounts[tier] ?? 0;
		const pct = tierTotal > 0 ? (count / tierTotal) * 100 : 0;
		const color = MEMORY_TIER_COLORS[tier]?.text ?? '#6b7280';
		const item = mk(tierList, 'div', 'sy-1');
		const row = mk(item, 'div', 'kv xs');
		const name = mk(row, 'span', 'flex items-center gap-1_5');
		mk(name, 'span', 'dot-2_5').style.backgroundColor = color;
		mk(name, 'span', 'capitalize fw-5', t(state, `memoryTier${tier[0].toUpperCase()}${tier.slice(1)}`));
		mk(row, 'span', 'o-70', `${count.toLocaleString()} (${pct.toFixed(1)}%)`);
		meterBar(item, pct, color);
	}

	const split = mk(body, 'div', 'split-grid');
	const cats = mk(sectionCard(split, t(state, 'memoryCategoryBreakdown'), 'folder-open'), 'div', 'sy-1_5');
	const categories = Object.entries(d.categoryCounts ?? {}).sort((a, b) => b[1] - a[1]);
	for (const [cat, count] of categories) {
		const row = mk(cats, 'div', 'kv xs');
		const label = mk(row, 'span', 'flex items-center gap-1_5');
		svg(mk(label, 'span', ''), (MEMORY_CATEGORY_ICONS[cat] as KnoxGuiSvgIcon) || 'file', 14);
		mk(label, 'span', 'capitalize', cat.replace(/_/g, ' '));
		mk(row, 'span', 'count-badge', String(count));
	}
	if (!categories.length) {
		mk(cats, 'span', 'xs o-50', t(state, 'memoryNoCategoriesYet'));
	}
	const types = mk(sectionCard(split, t(state, 'memoryEntityTypes'), 'tag'), 'div', 'sy-1_5');
	const entityTypes = Object.entries(d.entityTypeCounts ?? {}).sort((a, b) => b[1] - a[1]);
	for (const [type, count] of entityTypes) {
		const row = mk(types, 'div', 'kv xs');
		mk(row, 'span', 'capitalize', type.replace(/_/g, ' '));
		mk(row, 'span', 'count-badge', String(count));
	}
	if (!entityTypes.length) {
		mk(types, 'span', 'xs o-50', t(state, 'memoryNoEntitiesYet'));
	}

	if (d.healthIssues?.length) {
		const list = mk(sectionCard(body, t(state, 'memoryHealthIssues'), 'alert-triangle'), 'div', 'sy-1');
		for (const issue of d.healthIssues) {
			const row = mk(list, 'div', 'issue-row');
			mk(row, 'span', 'issue-dot');
			mk(row, 'span', 'o-80', issue);
		}
	}
	if (d.healthRecommendations?.length) {
		const list = mk(sectionCard(body, t(state, 'memoryRecommendations'), 'lightbulb'), 'div', 'sy-1');
		for (const rec of d.healthRecommendations) {
			const row = mk(list, 'div', 'issue-row');
			svg(row, 'arrow-right', 12, 'mt-0_5 teal');
			mk(row, 'span', 'o-80', rec);
		}
	}

	const sessionsCard = sectionCard(body, t(state, 'memoryRecentSessions'), 'message-square');
	const sessions = (d.sessions ?? state.memorySessions).slice(0, 5);
	if (!sessions.length) {
		mk(sessionsCard, 'span', 'xs o-50', t(state, 'memoryNoSessionsYet'));
	} else {
		const list = mk(sessionsCard, 'div', 'sy-1_5');
		for (const session of sessions) {
			const row = mk(list, 'div', 'session-chip');
			const main = mk(row, 'div', 'flex-1 truncate');
			mk(main, 'span', 'fw-5', session.title || session.id);
			mk(main, 'span', 'ml-2 o-50', session.messageCount != null ? t(state, 'memoryMsgs', { count: session.messageCount }) : t(state, 'memoryMsgsUnknown'));
			mk(row, 'span', 'shrink-0 o-50', formatMemoryTimeAgo(session.updatedAt, (key, vars) => t(state, key, vars)));
		}
	}

	if (d.consolidation) {
		const card = sectionCard(body, t(state, 'memoryConsolidationStats'), 'zap');
		const grid = mk(card, 'div', 'metric-grid');
		metricCell(grid, String(d.consolidation.totalRuns), t(state, 'memoryTotalRuns'));
		metricCell(grid, d.consolidation.lastRunAt ? formatMemoryTimeAgo(d.consolidation.lastRunAt, (key, vars) => t(state, key, vars)) : '—', t(state, 'memoryLastRun'));
		metricCell(grid, d.consolidation.avgDurationMs > 0 ? `${d.consolidation.avgDurationMs.toFixed(0)}ms` : '—', t(state, 'memoryAvgDuration'));
		if (d.consolidation.lastSubPhases) {
			const list = mk(card, 'div', 'divided mt-3 pt-2 sy-1');
			for (const [key, count] of Object.entries(d.consolidation.lastSubPhases).filter(([, value]) => value > 0)) {
				const row = mk(list, 'div', 'kv xs o-80');
				mk(row, 'span', '', MEMORY_SLEEP_PHASE_LABELS[key] ?? key);
				mk(row, 'span', '', String(count));
			}
		}
	}

	const timeline = mk(body, 'div', 'timeline');
	mk(timeline, 'span', 'o-60', `${t(state, 'memoryOldest')}: ${formatMemoryTimeAgo(d.oldestMemory, (key, vars) => t(state, key, vars))}`);
	mk(timeline, 'span', 'o-60', `${t(state, 'memoryNewest')}: ${formatMemoryTimeAgo(d.newestMemory, (key, vars) => t(state, key, vars))}`);
}
