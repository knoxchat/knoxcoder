/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../knoxGuiWidget.js';
import { t } from './t.js';
import * as DOM from '../../../../../../base/browser/dom.js';
import { appendKnoxGuiSvg, KnoxGuiSvgIcon } from '../knoxGuiIcons.js';
import {
	dashboardHealthGrade,
	filterAndSortMemories,
	formatBytes,
	formatMemoryDate,
	formatMemoryTimeAgo,
	graphEntityColor,
	groupMemoriesByDate,
	healthStatusColor,
	memoriesToExportJson,
	memoriesToExportMarkdown,
	MEMORY_CATEGORY_ICONS,
	MEMORY_CYCLE_PHASES,
	MEMORY_EFFECTIVE_TIERS,
	MEMORY_SETTING_GROUP_ICONS,
	MEMORY_SETTING_GROUPS,
	MEMORY_SLEEP_PHASE_LABELS,
	MEMORY_TAB_ICONS,
	MEMORY_TAB_IDS,
	MEMORY_TAB_KEYS,
	MEMORY_TIER_COLORS,
	MEMORY_TREND_COLORS,
	memoryExploreEdgeDepth,
	memorySnippet,
	sortMemoryExploreEdges,
	uniqueMemoryCategories,
} from '../../../common/knoxGuiMemory.js';
import { IKnoxGuiState } from '../../../common/knoxGuiState.js';

export function renderMemory(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void { // KN-376
	body.classList.add('knox-gui-memory-page');
	body.setAttribute('data-testid', 'knox-gui-memory');
	const tabs = DOM.append(body, DOM.$('.knox-gui-memory-tabs'));
	for (const id of MEMORY_TAB_IDS) {
		const selected = state.memoryTab === id;
		const tab = DOM.append(tabs, DOM.$(selected ? 'button.knox-gui-memory-tab.selected' : 'button.knox-gui-memory-tab')) as HTMLButtonElement;
		tab.type = 'button';
		tab.setAttribute('data-testid', `knox-gui-memory-tab-${id}`);
		const icon = MEMORY_TAB_ICONS[id] as KnoxGuiSvgIcon | undefined;
		if (icon) {
			appendKnoxGuiSvg(tab, icon, 14).style.color = '#159994';
		}
		DOM.append(tab, DOM.$('span', undefined, t(state, MEMORY_TAB_KEYS[id])));
		widget.renderStore.add(DOM.addDisposableListener(tab, 'click', () => {
			widget.controller.store.patch({ memoryTab: id });
			widget.controller.messenger.post('saveMemoryViewUiState', { activeTabId: id });
			if (id === 'overview') {
				void widget.controller.loadMemoryOverview();
			} else if (id === 'memories') {
				void widget.controller.loadMemories(false);
			} else if (id === 'sessions') {
				void widget.controller.loadMemorySessions();
			} else if (id === 'graph') {
				void widget.controller.loadMemoryGraph(false);
			} else {
				void widget.controller.loadMemoryConfig();
			}
		}));
	}
	const pane = DOM.append(body, DOM.$('.knox-gui-memory-body'));
	const paneTestIds: Record<string, string> = {
		overview: 'knox-gui-memory-overview',
		memories: 'knox-gui-memory-browser',
		sessions: 'knox-gui-memory-sessions',
		graph: 'knox-gui-memory-graph',
		settings: 'knox-gui-memory-settings',
	};
	pane.setAttribute('data-testid', paneTestIds[state.memoryTab] ?? `knox-gui-memory-${state.memoryTab}`);
	if (state.memoryActionMessage) {
		const notice = DOM.append(pane, DOM.$('.knox-gui-memory-notice', undefined, t(state, state.memoryActionMessage)));
		appendKnoxGuiSvg(notice, 'check', 14);
		notice.prepend(notice.lastChild!);
	}
	if (state.memoryTab === 'overview') {
		widget.renderMemoryOverview(pane, state);
	} else if (state.memoryTab === 'memories') {
		widget.renderMemoryBrowser(pane, state);
	} else if (state.memoryTab === 'sessions') {
		widget.renderMemorySessions(pane, state);
	} else if (state.memoryTab === 'graph') {
		widget.renderMemoryGraph(pane, state);
	} else {
		widget.renderMemorySettings(pane, state);
	}
}

export function renderMemoryOverview(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void { // KN-376 KN-310–313
	const d = state.memoryDashboard;
	if (!d) {
		if (state.memoryBusy) {
			const loading = DOM.append(body, DOM.$('.knox-gui-memory-empty'));
			widget.appendSpinner(loading, 32);
			DOM.append(loading, DOM.$('span.knox-gui-muted', undefined, t(state, 'memoryLoadingDashboard')));
			return;
		}
		const empty = DOM.append(body, DOM.$('.knox-gui-memory-empty'));
		appendKnoxGuiSvg(empty, 'brain', 28).style.color = '#159994';
		DOM.append(empty, DOM.$('p.knox-gui-muted', undefined, t(state, 'memoryNoData')));
		widget.chromeButton(empty, { label: t(state, 'memoryRetry'), onClick: () => void widget.controller.loadMemoryOverview() });
		return;
	}
	const healthStatus = d.healthStatus ?? 'healthy';
	const healthColor = healthStatusColor(healthStatus);
	const totalMemories = d.totalEpisodic + d.totalSemantic;
	const banner = DOM.append(body, DOM.$('.knox-gui-health-banner'));
	banner.style.borderColor = healthColor;
	banner.style.background = `${healthColor}10`;
	const left = DOM.append(banner, DOM.$('.knox-gui-health-left'));
	const grade = DOM.append(left, DOM.$('span.knox-gui-health-grade', undefined, d.healthGrade || dashboardHealthGrade(d.healthScore) || healthStatus.slice(0, 1).toUpperCase()));
	grade.style.background = healthColor;
	const status = DOM.append(left, DOM.$('div'));
	DOM.append(status, DOM.$('strong.knox-gui-health-status', undefined, `${t(state, 'memorySystemStatus')}: ${healthStatus}`));
	DOM.append(status, DOM.$('div.knox-gui-muted', undefined, d.healthScore != null ? `${t(state, 'memoryHealthScore')}: ${d.healthScore}/100` : `${totalMemories.toLocaleString()} ${t(state, 'memoryTotalMemories')}`));
	const actions = DOM.append(banner, DOM.$('.knox-gui-health-actions'));
	widget.chromeButton(actions, {
		svg: 'rotate-cw',
		svgSize: 12,
		label: t(state, 'memoryRefresh'),
		onClick: () => void widget.controller.loadMemoryOverview(),
	});
	widget.chromeButton(actions, {
		svg: state.memoryBusy ? undefined : 'zap',
		svgSize: 12,
		label: t(state, 'memoryConsolidate'),
		disabled: state.memoryBusy,
		onClick: () => void widget.controller.consolidateMemory(),
	});
	if (state.memoryBusy) {
		widget.appendSpinner(actions.lastElementChild as HTMLElement, 12);
	}

	const stats = DOM.append(body, DOM.$('.knox-gui-stat-grid.knox-gui-stat-grid-4'));
	statCard(stats, 'brain', t(state, 'memorySemantic'), d.totalSemantic);
	statCard(stats, 'file-text', t(state, 'memoryEpisodic'), d.totalEpisodic);
	statCard(stats, 'link', t(state, 'memoryEntities'), d.totalEntities);
	statCard(stats, 'globe', t(state, 'memorySessions'), d.totalSessions);
	statCard(stats, 'rotate-cw', t(state, 'memoryEdges'), d.totalEdges);
	statCard(stats, 'bar-chart-3', t(state, 'memoryPatterns'), d.totalPatterns ?? 0);
	statCard(stats, 'clipboard-list', t(state, 'memoryProcedures'), d.totalProcedures ?? 0);
	statCard(stats, 'hard-drive', t(state, 'memoryDbSize'), formatBytes(d.dbSizeBytes));

	if (state.memoryEbbinghausStats) {
		const card = sectionCard(body, t(state, 'memorySpacedRepetition'), 'brain');
		const ebb = DOM.append(card, DOM.$('.knox-gui-stat-grid.knox-gui-stat-grid-3'));
		metricCell(ebb, String(state.memoryEbbinghausStats.reviewDueCount), t(state, 'memoryReviewDueCount'));
		metricCell(ebb, `${Math.round(state.memoryEbbinghausStats.avgRetention * 100)}%`, t(state, 'memoryAvgRetention'));
		if (state.memoryEbbinghausStats.lambda != null) {
			metricCell(ebb, `λ=${state.memoryEbbinghausStats.lambda}`, t(state, 'memoryDecayRate'));
		}
		if (state.memoryReviewDue.length) {
			DOM.append(card, DOM.$('div.knox-gui-section-label', undefined, t(state, 'memoryReviewDueList')));
			for (const item of state.memoryReviewDue) {
				const row = DOM.append(card, DOM.$('.knox-gui-row.knox-gui-review-row'));
				DOM.append(row, DOM.$('span', undefined, `${item.overdue ? '⚠ ' : ''}${item.category ? `[${item.category}] ` : ''}${item.title}`));
				if (item.currentRetention != null) {
					DOM.append(row, DOM.$('span.knox-gui-mono', undefined, `R=${Math.round(item.currentRetention * 100)}%`));
				}
			}
		} else {
			DOM.append(card, DOM.$('p.knox-gui-muted', undefined, t(state, 'memoryNoReviewDue')));
		}
	}

	const phase = state.memoryPhaseStatus;
	if (phase) {
		const phaseCard = sectionCard(body, t(state, 'memoryCyclePhases'), 'rotate-cw');
		const phaseHead = DOM.append(phaseCard, DOM.$('.knox-gui-row'));
		DOM.append(phaseHead, DOM.$('span.knox-gui-muted', undefined, phase.cycleInvariantMet ? t(state, 'memoryCycleInvariantMet') : t(state, 'memoryCycleInvariantIdle')));
		if (phase.backgroundSleepActive) {
			const badge = DOM.append(phaseHead, DOM.$('span.knox-gui-sleep-badge', undefined, `φ₇ ${t(state, 'memoryPhaseSleep')} active`));
			badge.style.background = '#15999420';
			badge.style.color = '#159994';
		}
		const phases = DOM.append(phaseCard, DOM.$('.knox-gui-phase-grid'));
		const counts = phase.phaseCounts ?? {};
		const active = phase.activePhase;
		const last = phase.lastCompleted;
		MEMORY_CYCLE_PHASES.forEach((item, idx) => {
			const isActive = active === item.id;
			const isLast = last === item.id;
			const cell = DOM.append(phases, DOM.$(isActive || isLast ? '.knox-gui-phase.selected' : '.knox-gui-phase'));
			if (isActive) {
				cell.style.background = '#15999415';
			}
			DOM.append(cell, DOM.$('span', undefined, `φ${idx + 1} ${t(state, item.labelKey)}`));
			const count = counts[item.id] ?? 0;
			DOM.append(cell, DOM.$('span.knox-gui-muted.knox-gui-mono', undefined, count > 0 ? String(count) : '—'));
		});
	}

	if (state.memoryEffectiveContext) {
		const ctx = state.memoryEffectiveContext;
		const card = sectionCard(body, t(state, 'memoryEffectiveContext'), 'layers');
		DOM.append(card, DOM.$('p.knox-gui-muted', undefined, t(state, 'memoryEffectiveContextFormula')));
		const grid = DOM.append(card, DOM.$('.knox-gui-stat-grid.knox-gui-stat-grid-4'));
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
			meterRow(card, t(state, 'memoryContextUtilization'), `${((ctx.windowUtilization ?? 0) * 100).toFixed(1)}%`, Math.min(100, (ctx.windowUtilization ?? 0) * 100), '#159994');
		}
		const visibleLevels = ctx.levels.filter(level => level.tokens !== 0 || (level.effectiveTokens ?? 0) !== 0);
		if (visibleLevels.length) {
			DOM.append(card, DOM.$('div.knox-gui-section-label', undefined, 'M₁–M₅ Hierarchy'));
			for (const level of visibleLevels) {
				const row = DOM.append(card, DOM.$('.knox-gui-row'));
				DOM.append(row, DOM.$('span', undefined, `${level.id} ${level.name}`));
				DOM.append(row, DOM.$('span.knox-gui-muted', undefined, `${level.tokens.toLocaleString()} / r=${level.ratio ?? 1} → ${Math.round(level.effectiveTokens ?? 0).toLocaleString()}`));
			}
			if ((ctx.workingMemoryBudget ?? 0) > 0) {
				const row = DOM.append(card, DOM.$('.knox-gui-row'));
				DOM.append(row, DOM.$('span.knox-gui-muted', undefined, 'M₂ budget cap'));
				DOM.append(row, DOM.$('span.knox-gui-muted', undefined, `${ctx.workingMemoryBudget?.toLocaleString()} tokens`));
			}
		}
		for (const tier of MEMORY_EFFECTIVE_TIERS) {
			const tokens = ctx.tierTokens?.[tier] ?? 0;
			if (!tokens) {
				continue;
			}
			const ratio = ctx.compressionRatios?.[tier] ?? 1;
			const row = DOM.append(card, DOM.$('.knox-gui-row'));
			DOM.append(row, DOM.$('span.knox-gui-capitalize', undefined, tier));
			DOM.append(row, DOM.$('span.knox-gui-muted', undefined, `${tokens.toLocaleString()} tokens / r=${ratio} → ${Math.round(tokens / ratio).toLocaleString()}`));
		}
	}

	if (d.graphMaxEntities) {
		const card = sectionCard(body, t(state, 'memoryKnowledgeGraphCap'), 'link');
		const grid = DOM.append(card, DOM.$('.knox-gui-stat-grid.knox-gui-stat-grid-4'));
		statCard(grid, 'link', t(state, 'memoryGraphEntities'), `${d.graphTotalEntities ?? d.totalEntities}/${d.graphMaxEntities}`);
		statCard(grid, 'rotate-cw', t(state, 'memoryEdges'), d.graphTotalEdges ?? d.totalEdges);
		statCard(grid, 'compass', t(state, 'memoryGraphBfsDepth'), d.graphMaxDepth ?? 3);
		statCard(grid, 'bar-chart-3', t(state, 'memoryGraphDepthDecayGamma'), `γ=${d.graphDepthDecayGamma ?? 0.7}`);
		meterRow(
			card,
			t(state, 'memoryGraphCapUtilization'),
			`${((d.graphCapUtilization ?? 0) * 100).toFixed(1)}%${d.graphAtCap ? ` ${t(state, 'memoryGraphAtCap')}` : ''}`,
			Math.min(100, (d.graphCapUtilization ?? 0) * 100),
			d.graphAtCap ? '#f59e0b' : '#159994',
		);
		DOM.append(card, DOM.$('p.knox-gui-hint', undefined, t(state, 'memoryGraphCapLruHint')));
	}

	const trend = state.memoryMetricsTrend;
	if (trend) {
		const card = sectionCard(body, t(state, 'memoryMetricsTrend'), 'bar-chart-3');
		if (!trend.snapshots?.length) {
			DOM.append(card, DOM.$('p.knox-gui-muted', undefined, t(state, 'memoryNoMetricsSnapshots')));
		} else {
			const grid = DOM.append(card, DOM.$('.knox-gui-stat-grid.knox-gui-stat-grid-5'));
			const snap = trend.snapshots[0];
			trendCell(grid, trend.effectiveContext, t(state, 'memoryTrendEffectiveContext'), snap.totalEffective != null ? Math.round(snap.totalEffective).toLocaleString() : undefined);
			trendCell(grid, trend.response, t(state, 'memoryTrendResponse'), `${snap.avgResponseMs.toFixed(0)}ms`);
			trendCell(grid, trend.success, t(state, 'memoryTrendSuccess'), `${(snap.successRate * 100).toFixed(1)}%`);
			trendCell(grid, trend.growth, t(state, 'memoryTrendGrowth'), `${snap.memoryCount.toLocaleString()} ${t(state, 'memoryTotalMemories').toLowerCase()}`);
			trendCell(grid, trend.compression, t(state, 'memoryTrendCompression'), snap.tokensSaved != null ? `${snap.tokensSaved.toLocaleString()} ${t(state, 'memoryTokensSaved').toLowerCase()}` : undefined);
			if (trend.periodHours != null) {
				DOM.append(card, DOM.$('p.knox-gui-hint.knox-gui-center', undefined, t(state, 'memoryTrendPeriod', { hours: trend.periodHours, count: trend.snapshots.length })));
			}
		}
	}

	const tierCard = sectionCard(body, t(state, 'memoryTierDistribution'), 'bar-chart-3');
	const tierCounts = d.tierCounts ?? {};
	const tierTotal = (tierCounts.hot ?? 0) + (tierCounts.warm ?? 0) + (tierCounts.cold ?? 0);
	for (const tier of ['hot', 'warm', 'cold'] as const) {
		const count = tierCounts[tier] ?? 0;
		const pct = tierTotal > 0 ? (count / tierTotal) * 100 : 0;
		const color = MEMORY_TIER_COLORS[tier]?.text ?? '#6b7280';
		const row = DOM.append(tierCard, DOM.$('.knox-gui-tier-row'));
		const label = DOM.append(row, DOM.$('.knox-gui-row'));
		const name = DOM.append(label, DOM.$('span.knox-gui-tier-label'));
		const dot = DOM.append(name, DOM.$('span.knox-gui-tier-dot'));
		dot.style.background = color;
		DOM.append(name, DOM.$('span', undefined, t(state, `memoryTier${tier[0].toUpperCase()}${tier.slice(1)}`)));
		DOM.append(label, DOM.$('span.knox-gui-muted', undefined, `${count.toLocaleString()} (${pct.toFixed(1)}%)`));
		meterBar(row, pct, color);
	}

	const split = DOM.append(body, DOM.$('.knox-gui-memory-split'));
	const cats = sectionCard(split, t(state, 'memoryCategoryBreakdown'), 'folder-open');
	const categories = Object.entries(d.categoryCounts ?? {}).sort((a, b) => b[1] - a[1]);
	if (!categories.length) {
		DOM.append(cats, DOM.$('span.knox-gui-muted', undefined, t(state, 'memoryNoCategoriesYet')));
	}
	for (const [cat, count] of categories) {
		const row = DOM.append(cats, DOM.$('.knox-gui-row'));
		const left = DOM.append(row, DOM.$('span.knox-gui-cat-label'));
		appendKnoxGuiSvg(left, (MEMORY_CATEGORY_ICONS[cat] as KnoxGuiSvgIcon) || 'file', 14);
		DOM.append(left, DOM.$('span.knox-gui-capitalize', undefined, cat.replace(/_/g, ' ')));
		DOM.append(row, DOM.$('span.knox-gui-count-badge', undefined, String(count)));
	}
	const types = sectionCard(split, t(state, 'memoryEntityTypes'), 'tag');
	const entityTypes = Object.entries(d.entityTypeCounts ?? {}).sort((a, b) => b[1] - a[1]);
	if (!entityTypes.length) {
		DOM.append(types, DOM.$('span.knox-gui-muted', undefined, t(state, 'memoryNoEntitiesYet')));
	}
	for (const [type, count] of entityTypes) {
		const row = DOM.append(types, DOM.$('.knox-gui-row'));
		DOM.append(row, DOM.$('span.knox-gui-capitalize', undefined, type.replace(/_/g, ' ')));
		DOM.append(row, DOM.$('span.knox-gui-count-badge', undefined, String(count)));
	}

	if (d.healthIssues?.length) {
		const card = sectionCard(body, t(state, 'memoryHealthIssues'), 'alert-triangle');
		for (const issue of d.healthIssues) {
			const row = DOM.append(card, DOM.$('.knox-gui-issue-row'));
			DOM.append(row, DOM.$('span.knox-gui-issue-dot'));
			DOM.append(row, DOM.$('span', undefined, issue));
		}
	}
	if (d.healthRecommendations?.length) {
		const card = sectionCard(body, t(state, 'memoryRecommendations'), 'lightbulb');
		for (const rec of d.healthRecommendations) {
			const row = DOM.append(card, DOM.$('.knox-gui-issue-row'));
			appendKnoxGuiSvg(row, 'arrow-right', 12).style.color = '#159994';
			DOM.append(row, DOM.$('span', undefined, rec));
		}
	}

	const sessionsCard = sectionCard(body, t(state, 'memoryRecentSessions'), 'message-square');
	const sessions = (d.sessions ?? state.memorySessions).slice(0, 5);
	if (!sessions.length) {
		DOM.append(sessionsCard, DOM.$('span.knox-gui-muted', undefined, t(state, 'memoryNoSessionsYet')));
	}
	for (const session of sessions) {
		const row = DOM.append(sessionsCard, DOM.$('.knox-gui-session-chip'));
		const main = DOM.append(row, DOM.$('div.knox-gui-ellipsis'));
		DOM.append(main, DOM.$('strong', undefined, session.title || session.id));
		DOM.append(main, DOM.$('span.knox-gui-muted', undefined, session.messageCount != null ? t(state, 'memoryMsgs', { count: session.messageCount }) : t(state, 'memoryMsgsUnknown')));
		DOM.append(row, DOM.$('span.knox-gui-muted', undefined, formatMemoryTimeAgo(session.updatedAt, (key, vars) => t(state, key, vars))));
	}

	if (d.consolidation) {
		const card = sectionCard(body, t(state, 'memoryConsolidationStats'), 'zap');
		const grid = DOM.append(card, DOM.$('.knox-gui-stat-grid.knox-gui-stat-grid-3'));
		metricCell(grid, String(d.consolidation.totalRuns), t(state, 'memoryTotalRuns'));
		metricCell(grid, d.consolidation.lastRunAt ? formatMemoryTimeAgo(d.consolidation.lastRunAt, (key, vars) => t(state, key, vars)) : '—', t(state, 'memoryLastRun'));
		metricCell(grid, d.consolidation.avgDurationMs > 0 ? `${d.consolidation.avgDurationMs.toFixed(0)}ms` : '—', t(state, 'memoryAvgDuration'));
		const phases = Object.entries(d.consolidation.lastSubPhases ?? {}).filter(([, count]) => count > 0);
		for (const [key, count] of phases) {
			const row = DOM.append(card, DOM.$('.knox-gui-row'));
			DOM.append(row, DOM.$('span', undefined, MEMORY_SLEEP_PHASE_LABELS[key] ?? key));
			DOM.append(row, DOM.$('span', undefined, String(count)));
		}
	}

	const timeline = DOM.append(body, DOM.$('.knox-gui-memory-timeline'));
	DOM.append(timeline, DOM.$('span.knox-gui-muted', undefined, `${t(state, 'memoryOldest')}: ${formatMemoryTimeAgo(d.oldestMemory, (key, vars) => t(state, key, vars))}`));
	DOM.append(timeline, DOM.$('span.knox-gui-muted', undefined, `${t(state, 'memoryNewest')}: ${formatMemoryTimeAgo(d.newestMemory, (key, vars) => t(state, key, vars))}`));
}

export function renderMemoryBrowser(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void { // KN-376 KN-311
	renderMemoryDeleteDialog(widget, body, state);
	const searchWrap = DOM.append(body, DOM.$('.knox-gui-memory-search'));
	appendKnoxGuiSvg(searchWrap, 'search', 14).classList.add('knox-gui-search-icon');
	const input = DOM.append(searchWrap, DOM.$('input.knox-gui-input')) as HTMLInputElement;
	input.placeholder = t(state, 'memorySearchPlaceholder');
	input.value = widget.memorySearchDraft || state.memoryQuery;
	widget.renderStore.add(DOM.addDisposableListener(input, 'input', () => {
		widget.memorySearchDraft = input.value;
		if (widget.memorySearchTimer) {
			clearTimeout(widget.memorySearchTimer);
		}
		widget.memorySearchTimer = setTimeout(() => {
			widget.controller.store.patch({ memoryQuery: widget.memorySearchDraft });
			void widget.controller.loadMemories(false);
		}, 300);
	}));
	if (widget.memorySearchDraft || state.memoryQuery) {
		const clear = DOM.append(searchWrap, DOM.$('button.knox-gui-search-clear')) as HTMLButtonElement;
		clear.type = 'button';
		clear.setAttribute('aria-label', t(state, 'clearSearch'));
		appendKnoxGuiSvg(clear, 'x', 12);
		widget.renderStore.add(DOM.addDisposableListener(clear, 'click', () => {
			widget.memorySearchDraft = '';
			if (widget.memorySearchTimer) {
				clearTimeout(widget.memorySearchTimer);
				widget.memorySearchTimer = undefined;
			}
			widget.controller.store.patch({ memoryQuery: '' });
			void widget.controller.loadMemories(false);
		}));
	}

	const filters = DOM.append(body, DOM.$('.knox-gui-row.knox-gui-wrap'));
	widget.selectField(filters, uniqueMemoryCategories(state.memories), state.memoryFilterCategory, t(state, 'memoryAllCategories'), value => {
		widget.controller.store.patch({ memoryFilterCategory: value });
		void widget.controller.loadMemories(false);
	});
	widget.selectField(filters, ['hot', 'warm', 'cold'], state.memoryFilterTier, t(state, 'memoryAllTiers'), value => {
		widget.controller.store.patch({ memoryFilterTier: value });
		void widget.controller.loadMemories(false);
	});
	const pin = DOM.append(filters, DOM.$('select.knox-gui-select')) as HTMLSelectElement;
	pin.setAttribute('aria-label', t(state, 'memoryAllPins'));
	for (const [value, key] of [['all', 'memoryAllPins'], ['pinned', 'memoryPinnedOnly'], ['unpinned', 'memoryUnpinnedOnly']] as const) {
		const option = DOM.append(pin, DOM.$('option')) as HTMLOptionElement;
		option.value = value;
		option.textContent = t(state, key);
		if (state.memoryFilterPinned === value) {
			option.selected = true;
		}
	}
	widget.renderStore.add(DOM.addDisposableListener(pin, 'change', () => {
		widget.controller.store.patch({ memoryFilterPinned: pin.value as IKnoxGuiState['memoryFilterPinned'] });
		void widget.controller.loadMemories(false);
	}));
	const sort = DOM.append(filters, DOM.$('select.knox-gui-select')) as HTMLSelectElement;
	for (const [value, key] of [['recent', 'memorySortRecent'], ['importance', 'memorySortImportance'], ['accessed', 'memorySortAccessed']] as const) {
		const option = DOM.append(sort, DOM.$('option')) as HTMLOptionElement;
		option.value = value;
		option.textContent = t(state, key);
		if (state.memorySortBy === value) {
			option.selected = true;
		}
	}
	widget.renderStore.add(DOM.addDisposableListener(sort, 'change', () => widget.controller.store.patch({ memorySortBy: sort.value as IKnoxGuiState['memorySortBy'] })));

	const memories = filterAndSortMemories(state.memories, {
		category: state.memoryFilterCategory,
		tier: state.memoryFilterTier,
		pinned: state.memoryFilterPinned,
		sortBy: state.memorySortBy,
	});
	const toolbar = DOM.append(body, DOM.$('.knox-gui-memory-toolbar'));
	const counts = DOM.append(toolbar, DOM.$('.knox-gui-row'));
	if (widget.memorySelectedIds.size) {
		const badge = DOM.append(counts, DOM.$('span.knox-gui-count-badge'));
		badge.setAttribute('data-testid', 'memory-selected-count');
		appendKnoxGuiSvg(badge, 'check', 10);
		DOM.append(badge, DOM.$('span', undefined, t(state, 'selectedCount', { count: widget.memorySelectedIds.size })));
	}
	DOM.append(counts, DOM.$('span.knox-gui-muted', undefined, `${memories.length} ${t(state, 'memoryMemoriesFound')}`));
	const tools = DOM.append(toolbar, DOM.$('.knox-gui-row.knox-gui-wrap'));
	if (!widget.memorySelectionMode) {
		widget.chromeButton(tools, {
			svg: 'check-square',
			svgSize: 12,
			label: t(state, 'select'),
			title: t(state, 'memorySelectMultiple'),
			onClick: () => { widget.memorySelectionMode = true; widget.controller.store.patch({}); },
		});
	} else {
		widget.chromeButton(tools, {
			svg: 'check-square',
			svgSize: 12,
			label: t(state, 'selectAll'),
			onClick: () => {
				widget.memorySelectedIds = new Set(memories.map(memory => memory.id));
				widget.controller.store.patch({});
			},
		});
		const selected = [...widget.memorySelectedIds];
		widget.chromeButton(tools, { svg: 'pin', svgSize: 12, label: t(state, 'memoryPinSelected'), disabled: !selected.length, onClick: () => void widget.controller.pinMemories(selected, true) });
		widget.chromeButton(tools, { svg: 'pin-off', svgSize: 12, label: t(state, 'memoryUnpinSelected'), disabled: !selected.length, onClick: () => void widget.controller.pinMemories(selected, false) });
		widget.chromeButton(tools, {
			svg: 'download',
			svgSize: 12,
			label: t(state, 'memoryExportSelectedJson'),
			disabled: !selected.length,
			onClick: () => widget.controller.messenger.post('copyText', { text: memoriesToExportJson(state.memories.filter(memory => widget.memorySelectedIds.has(memory.id))) }),
		});
		widget.chromeButton(tools, {
			svg: 'file-text',
			svgSize: 12,
			label: t(state, 'memoryExportSelectedMarkdown'),
			disabled: !selected.length,
			onClick: () => widget.controller.messenger.post('copyText', { text: memoriesToExportMarkdown(state.memories.filter(memory => widget.memorySelectedIds.has(memory.id))) }),
		});
		widget.chromeButton(tools, {
			svg: 'trash',
			svgSize: 12,
			label: t(state, 'memoryDeleteSelected'),
			extraClass: 'knox-gui-danger',
			disabled: !selected.length,
			onClick: () => { widget.memoryConfirmDeleteIds = selected; widget.memoryConfirmDeleteBulk = true; widget.controller.store.patch({}); },
		});
		widget.chromeButton(tools, {
			svg: 'x',
			svgSize: 12,
			label: t(state, 'cancel'),
			onClick: () => {
				widget.memorySelectionMode = false;
				widget.memorySelectedIds.clear();
				widget.controller.store.patch({});
			},
		});
	}

	if (!memories.length) {
		DOM.append(body, DOM.$('.knox-gui-empty', undefined, state.memoryQuery ? t(state, 'memoryNoResults') : t(state, 'memoryNoMemoriesStored')));
		return;
	}
	const groups = state.memorySortBy === 'recent' ? groupMemoriesByDate(memories) : [{ headerKey: undefined, memories }];
	for (const group of groups) {
		if (group.headerKey) {
			DOM.append(body, DOM.$('h4.knox-gui-date-header', undefined, t(state, group.headerKey)));
		}
		for (const memory of group.memories) {
			const selected = widget.memorySelectedIds.has(memory.id);
			const row = DOM.append(body, DOM.$(selected ? '.knox-gui-card.knox-gui-browser-row.selected' : '.knox-gui-card.knox-gui-browser-row'));
			row.setAttribute('data-testid', `memory-row-${memory.id}`);
			if (selected) {
				row.style.borderColor = '#159994';
			}
			widget.renderStore.add(DOM.addDisposableListener(row, 'click', e => {
				if (widget.memorySelectionMode) {
					if (selected) {
						widget.memorySelectedIds.delete(memory.id);
					} else {
						widget.memorySelectedIds.add(memory.id);
					}
				} else if (!(e.target as HTMLElement).closest('button')) {
					widget.memoryExpandedId = widget.memoryExpandedId === memory.id ? null : memory.id;
				}
				widget.controller.store.patch({});
			}));
			const head = DOM.append(row, DOM.$('.knox-gui-row'));
			if (widget.memorySelectionMode) {
				const box = DOM.append(head, DOM.$('span.knox-gui-check')) as HTMLElement;
				box.setAttribute('role', 'checkbox');
				box.setAttribute('aria-checked', String(selected));
				box.setAttribute('aria-label', t(state, 'memorySelectRow', { title: memory.title }));
				if (selected) {
					box.classList.add('checked');
					appendKnoxGuiSvg(box, 'check', 10);
				}
			}
			appendKnoxGuiSvg(head, (MEMORY_CATEGORY_ICONS[memory.category ?? ''] as KnoxGuiSvgIcon) || 'file', 14);
			if (memory.category) {
				DOM.append(head, DOM.$('span.knox-gui-count-badge', undefined, memory.category));
			}
			if (memory.tier) {
				const badge = DOM.append(head, DOM.$('span.knox-gui-tier', undefined, memory.tier));
				const color = MEMORY_TIER_COLORS[memory.tier];
				if (color) {
					badge.style.background = color.bg;
					badge.style.color = color.text;
				}
			}
			const title = DOM.append(head, DOM.$('strong.knox-gui-browser-title'));
			if (memory.pinned) {
				appendKnoxGuiSvg(title, 'pin', 11).style.color = '#159994';
			}
			DOM.append(title, DOM.$('span', undefined, memory.title));
			if (!widget.memorySelectionMode) {
				const hover = DOM.append(head, DOM.$('.knox-gui-browser-actions'));
				widget.chromeButton(hover, {
					svg: memory.pinned ? 'pin-off' : 'pin',
					svgSize: 12,
					title: memory.pinned ? t(state, 'memoryUnpin') : t(state, 'memoryPin'),
					onClick: () => void widget.controller.pinMemories([memory.id], !memory.pinned),
				});
				widget.chromeButton(hover, {
					svg: 'x',
					svgSize: 12,
					title: t(state, 'memoryForget'),
					extraClass: 'knox-gui-danger',
					onClick: () => { widget.memoryConfirmDeleteIds = [memory.id]; widget.memoryConfirmDeleteBulk = false; widget.controller.store.patch({}); },
				});
			}
			if (widget.memoryExpandedId !== memory.id) {
				DOM.append(row, DOM.$('div.knox-gui-muted.knox-gui-snippet', undefined, memorySnippet(memory.content ?? memory.title)));
			} else if (!widget.memorySelectionMode) {
				const detail = DOM.append(row, DOM.$('.knox-gui-browser-detail'));
				DOM.append(detail, DOM.$('pre.knox-gui-raw-md', undefined, memory.content ?? ''));
				const meta = DOM.append(detail, DOM.$('.knox-gui-muted.knox-gui-row.knox-gui-wrap'));
				DOM.append(meta, DOM.$('span', undefined, `${t(state, 'memoryDetailImportance')}: ${(memory.importance ?? 0).toFixed(2)}`));
				DOM.append(meta, DOM.$('span', undefined, `${t(state, 'memoryDetailUsed')}: ${t(state, 'memoryDetailUsedTimes', { count: memory.retrievalCount ?? 0 })}`));
				if (memory.createdAt) {
					DOM.append(meta, DOM.$('span', undefined, `${t(state, 'memoryDetailCreated')}: ${formatMemoryDate(memory.createdAt)}`));
				}
				if (memory.lastAccessedAt) {
					DOM.append(meta, DOM.$('span', undefined, `${t(state, 'memoryDetailLastAccessed')}: ${formatMemoryDate(memory.lastAccessedAt)}`));
				}
				if (memory.sourceSessionId) {
					DOM.append(meta, DOM.$('span', undefined, `${t(state, 'memoryDetailSession')}: ${memory.sourceSessionId.slice(0, 8)}…`));
				}
				if (memory.keywords) {
					const chips = DOM.append(detail, DOM.$('.knox-gui-row.knox-gui-wrap'));
					for (const kw of memory.keywords.split(',')) {
						DOM.append(chips, DOM.$('span.knox-gui-count-badge', undefined, kw.trim()));
					}
				}
			}
		}
	}
	if (state.memoryHasMore) {
		widget.chromeButton(body, { label: t(state, 'memoryLoadMore'), onClick: () => void widget.controller.loadMemories(true) });
	}
}

export function renderMemorySessions(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void { // KN-376 KN-315
	const header = DOM.append(body, DOM.$('.knox-gui-row'));
	const title = DOM.append(header, DOM.$('h4.knox-gui-section-title'));
	appendKnoxGuiSvg(title, 'message-square', 14).style.color = '#159994';
	DOM.append(title, DOM.$('span', undefined, t(state, 'memorySessionHistoryTitle')));
	widget.chromeButton(header, { svg: 'rotate-cw', svgSize: 12, label: t(state, 'memoryRefresh'), onClick: () => void widget.controller.loadMemorySessions() });
	const searchWrap = DOM.append(body, DOM.$('.knox-gui-memory-search'));
	appendKnoxGuiSvg(searchWrap, 'search', 14).classList.add('knox-gui-search-icon');
	const search = DOM.append(searchWrap, DOM.$('input.knox-gui-input')) as HTMLInputElement;
	search.placeholder = t(state, 'memorySessionHistorySearch');
	search.value = state.memorySessionQuery;
	widget.renderStore.add(DOM.addDisposableListener(search, 'input', () => {
		widget.controller.store.patch({ memorySessionQuery: search.value });
		void widget.controller.searchMemoryBacklogs(search.value);
	}));
	if (state.memorySessionQuery.trim().length >= 2) {
		const cross = DOM.append(body, DOM.$('.knox-gui-section-card'));
		const crossHead = DOM.append(cross, DOM.$('.knox-gui-section-label'));
		appendKnoxGuiSvg(crossHead, 'search', 12);
		DOM.append(crossHead, DOM.$('span', undefined, t(state, 'memorySessionHistoryCrossSearch', { count: state.memoryBacklogMatches.length })));
		if (!state.memoryBacklogMatches.length) {
			DOM.append(cross, DOM.$('p.knox-gui-muted', undefined, t(state, 'memorySessionHistoryCrossSearchEmpty')));
		}
		for (const match of state.memoryBacklogMatches.slice(0, 15)) {
			const row = DOM.append(cross, DOM.$('button.knox-gui-card')) as HTMLButtonElement;
			row.type = 'button';
			DOM.append(row, DOM.$('strong', undefined, `[${match.kind === 'semantic' ? (match.category ?? match.kind) : (match.role ?? match.kind)}]${match.title ? ` ${match.title}` : ''}`));
			DOM.append(row, DOM.$('div.knox-gui-muted', undefined, memorySnippet(match.content, 140)));
			if (match.sessionId) {
				DOM.append(row, DOM.$('div.knox-gui-hint', undefined, t(state, 'memorySessionHistoryCrossSearchSession', { id: match.sessionId.slice(0, 8) })));
				widget.renderStore.add(DOM.addDisposableListener(row, 'click', () => void widget.controller.loadMemorySessionHistory(match.sessionId!)));
			}
		}
	}
	const layout = DOM.append(body, DOM.$('.knox-gui-split'));
	const list = DOM.append(layout, DOM.$('.knox-gui-split-list.knox-gui-section-card'));
	DOM.append(list, DOM.$('div.knox-gui-section-label', undefined, t(state, 'memorySessionHistoryList', { count: state.memorySessions.length })));
	const query = state.memorySessionQuery.trim().toLowerCase();
	const sessions = state.memorySessions.filter(session => !query || session.title.toLowerCase().includes(query) || session.id.toLowerCase().includes(query) || (session.summary ?? '').toLowerCase().includes(query));
	if (!sessions.length) {
		DOM.append(list, DOM.$('.knox-gui-empty', undefined, t(state, 'memoryNoSessionsYet')));
	}
	for (const session of sessions) {
		const selected = session.id === state.memorySelectedSessionId;
		const row = DOM.append(list, DOM.$(selected ? 'button.knox-gui-session-row.selected' : 'button.knox-gui-session-row')) as HTMLButtonElement;
		row.type = 'button';
		appendKnoxGuiSvg(row, 'chevron-right', 12).style.color = selected ? '#159994' : '';
		const main = DOM.append(row, DOM.$('div'));
		const titleRow = DOM.append(main, DOM.$('div.knox-gui-ellipsis'));
		DOM.append(titleRow, DOM.$('strong', undefined, session.title || session.id.slice(0, 12)));
		if (session.isActive) {
			const badge = DOM.append(titleRow, DOM.$('span.knox-gui-sleep-badge', undefined, t(state, 'memorySessionActive')));
			badge.style.background = '#15999420';
			badge.style.color = '#159994';
		}
		DOM.append(main, DOM.$('div.knox-gui-muted', undefined, `${t(state, 'memoryMsgs', { count: session.messageCount ?? 0 })} · ${formatMemoryDate(session.updatedAt)}`));
		if (session.summary) {
			DOM.append(main, DOM.$('div.knox-gui-muted', undefined, memorySnippet(session.summary, 140)));
		}
		widget.renderStore.add(DOM.addDisposableListener(row, 'click', () => void widget.controller.loadMemorySessionHistory(session.id)));
	}
	const detail = DOM.append(layout, DOM.$('.knox-gui-split-detail.knox-gui-section-card'));
	DOM.append(detail, DOM.$('div.knox-gui-section-label', undefined, state.memorySelectedSessionId ? t(state, 'memorySessionHistoryDetail') : t(state, 'memorySessionHistorySelectPrompt')));
	const history = state.memorySessionHistory;
	if (!history) {
		DOM.append(detail, DOM.$('p.knox-gui-muted', undefined, t(state, 'memorySessionHistorySelectPrompt')));
		return;
	}
	const meta = DOM.append(detail, DOM.$('.knox-gui-stat-grid.knox-gui-stat-grid-2'));
	metricCell(meta, String(history.messageCount ?? history.episodic.length), t(state, 'memorySessionHistoryMessages'));
	metricCell(meta, (history.tokenEstimate ?? 0).toLocaleString(), t(state, 'memorySessionHistoryTokens'));
	metricCell(meta, String(history.episodic.length), t(state, 'memoryEpisodic'));
	metricCell(meta, String(history.semantic.length), t(state, 'memorySemantic'));
	if (history.topics?.length) {
		const topics = DOM.append(detail, DOM.$('div'));
		const label = DOM.append(topics, DOM.$('div.knox-gui-section-label'));
		appendKnoxGuiSvg(label, 'tag', 12);
		DOM.append(label, DOM.$('span', undefined, t(state, 'memorySessionHistoryTopics')));
		const chips = DOM.append(topics, DOM.$('.knox-gui-row.knox-gui-wrap'));
		for (const topic of history.topics) {
			DOM.append(chips, DOM.$('span.knox-gui-count-badge', undefined, topic));
		}
	}
	if (history.episodic.length) {
		const label = DOM.append(detail, DOM.$('div.knox-gui-section-label'));
		appendKnoxGuiSvg(label, 'file-text', 12);
		DOM.append(label, DOM.$('span', undefined, t(state, 'memorySessionHistoryEpisodic')));
		for (const item of history.episodic.slice(0, 20)) {
			const row = DOM.append(detail, DOM.$('.knox-gui-card'));
			DOM.append(row, DOM.$('div.knox-gui-muted.knox-gui-capitalize', undefined, item.role ?? ''));
			DOM.append(row, DOM.$('div', undefined, memorySnippet(item.content, 180)));
		}
		if (history.episodic.length > 20) {
			DOM.append(detail, DOM.$('p.knox-gui-hint', undefined, t(state, 'memorySessionHistoryTruncated', { count: history.episodic.length - 20 })));
		}
	}
	if (history.semantic.length) {
		const label = DOM.append(detail, DOM.$('div.knox-gui-section-label'));
		appendKnoxGuiSvg(label, 'lightbulb', 12);
		DOM.append(label, DOM.$('span', undefined, t(state, 'memorySessionHistorySemantic')));
		for (const item of history.semantic.slice(0, 10)) {
			const row = DOM.append(detail, DOM.$('.knox-gui-card'));
			DOM.append(row, DOM.$('strong', undefined, `${item.category ? `[${item.category}] ` : ''}${item.title ?? ''}`));
			DOM.append(row, DOM.$('div.knox-gui-muted', undefined, memorySnippet(item.content, 180)));
		}
	}
}

export function renderMemoryGraph(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void { // KN-376 KN-311
	const stats = state.memoryGraphStats;
	if (stats) {
		const row = DOM.append(body, DOM.$('.knox-gui-stat-grid.knox-gui-stat-grid-3'));
		metricCell(row, stats.maxEntities ? `${stats.totalEntities}/${stats.maxEntities}` : String(stats.totalEntities), t(state, 'memoryEntities'));
		metricCell(row, String(stats.totalEdges), t(state, 'memoryEdges'));
		metricCell(row, String(Object.keys(stats.entityTypes ?? {}).length), t(state, 'memoryEntityTypesCount'));
		if (stats.maxEntities) {
			meterRow(
				body,
				t(state, 'memoryGraphCapUtilization'),
				`${((stats.capUtilization ?? 0) * 100).toFixed(1)}%${stats.atCap ? ` ${t(state, 'memoryGraphAtCap')}` : ''}`,
				Math.min(100, (stats.capUtilization ?? 0) * 100),
				stats.atCap ? '#f59e0b' : '#159994',
			);
			DOM.append(body, DOM.$('p.knox-gui-hint', undefined, t(state, 'memoryGraphSpreadingHint', { depth: stats.maxDepth ?? 3, gamma: stats.depthDecayGamma ?? 0.7 })));
		}
	}
	const filters = DOM.append(body, DOM.$('.knox-gui-row'));
	const searchWrap = DOM.append(filters, DOM.$('.knox-gui-memory-search.knox-gui-flex'));
	appendKnoxGuiSvg(searchWrap, 'search', 14).classList.add('knox-gui-search-icon');
	const search = DOM.append(searchWrap, DOM.$('input.knox-gui-input')) as HTMLInputElement;
	search.placeholder = t(state, 'memorySearchEntities');
	search.value = state.memoryGraphQuery;
	widget.renderStore.add(DOM.addDisposableListener(search, 'input', () => {
		widget.controller.store.patch({ memoryGraphQuery: search.value });
	}));
	widget.renderStore.add(DOM.addDisposableListener(search, 'change', () => void widget.controller.loadMemoryGraph(false)));
	const types = Object.keys(stats?.entityTypes ?? {});
	const typeCounts = { ...(stats?.entityTypes ?? {}) };
	for (const entity of state.memoryGraphEntities) {
		if (entity.entityType && typeCounts[entity.entityType] === undefined) {
			typeCounts[entity.entityType] = 0;
		}
	}
	widget.selectField(filters, types.length ? types : Object.keys(typeCounts), state.memoryGraphFilterType, t(state, 'memoryAllTypes'), value => {
		widget.controller.store.patch({ memoryGraphFilterType: value });
		void widget.controller.loadMemoryGraph(false);
	});
	if (state.memoryExplore) {
		const panel = DOM.append(body, DOM.$('.knox-gui-explore-panel'));
		const head = DOM.append(panel, DOM.$('.knox-gui-row'));
		const title = DOM.append(head, DOM.$('h3.knox-gui-section-title'));
		appendKnoxGuiSvg(title, 'compass', 14);
		const centerName = state.memoryExplore.centerName ?? state.memoryExplore.entities.find(entity => entity.id === state.memoryExplore?.centerId)?.name ?? '';
		DOM.append(title, DOM.$('span', undefined, `${t(state, 'memoryExploring')}: ${centerName}`));
		if (state.memoryExplore.depthReached != null) {
			DOM.append(title, DOM.$('span.knox-gui-muted', undefined, `(${t(state, 'memoryGraphDepth', { count: state.memoryExplore.depthReached })})`));
		}
		widget.chromeButton(head, { svg: 'x', svgSize: 12, label: t(state, 'memoryClose'), onClick: () => widget.controller.store.patch({ memoryExplore: undefined }) });
		if (state.memoryExplore.centerDescription) {
			DOM.append(panel, DOM.$('p.knox-gui-muted', undefined, state.memoryExplore.centerDescription));
		}
		if (!state.memoryExplore.edges.length) {
			DOM.append(panel, DOM.$('p.knox-gui-muted', undefined, t(state, 'memoryGraphNoRelationships')));
		} else {
			const depths = state.memoryExplore.entityDepths;
			for (const edge of sortMemoryExploreEdges(state.memoryExplore.edges, depths).slice(0, 24)) {
				const from = state.memoryExplore.entities.find(entity => entity.id === edge.source);
				const to = state.memoryExplore.entities.find(entity => entity.id === edge.target);
				const row = DOM.append(panel, DOM.$('.knox-gui-row.knox-gui-wrap'));
				const hop = memoryExploreEdgeDepth(edge, depths);
				if (hop !== Number.MAX_SAFE_INTEGER) {
					const depth = DOM.append(row, DOM.$('span.knox-gui-muted.knox-gui-mono', undefined, `d${hop}`));
					depth.setAttribute('data-testid', 'knox-gui-memory-graph-depth');
				}
				entityChip(widget, row, from?.name ?? String(edge.source), from?.entityType, from?.id === state.memoryExplore.centerId, () => void widget.controller.exploreMemoryEntity(edge.source));
				DOM.append(row, DOM.$('span.knox-gui-muted.knox-gui-italic', undefined, edge.relationship));
				appendKnoxGuiSvg(row, 'arrow-right', 10).style.opacity = '0.4';
				entityChip(widget, row, to?.name ?? String(edge.target), to?.entityType, to?.id === state.memoryExplore.centerId, () => void widget.controller.exploreMemoryEntity(edge.target));
			}
			DOM.append(panel, DOM.$('p.knox-gui-hint', undefined, `${Math.max(0, state.memoryExplore.entities.length - 1)} ${t(state, 'memoryConnectedEntities')} · ${state.memoryExplore.edges.length} ${t(state, 'memoryRelationships')}`));
		}
	}
	const legend = DOM.append(body, DOM.$('.knox-gui-row.knox-gui-wrap'));
	for (const type of Object.keys(typeCounts).sort((a, b) => (typeCounts[b] ?? 0) - (typeCounts[a] ?? 0) || a.localeCompare(b))) {
		const color = graphEntityColor(type);
		const active = state.memoryGraphFilterType === type;
		const chip = DOM.append(legend, DOM.$('button.knox-gui-type-chip')) as HTMLButtonElement;
		chip.type = 'button';
		chip.style.color = color;
		chip.style.borderColor = active ? color : `${color}30`;
		chip.style.background = active ? `${color}40` : `${color}15`;
		const dot = DOM.append(chip, DOM.$('span.knox-gui-tier-dot'));
		dot.style.background = color;
		DOM.append(chip, DOM.$('span', undefined, `${type} (${typeCounts[type] ?? 0})`));
		widget.renderStore.add(DOM.addDisposableListener(chip, 'click', () => {
			widget.controller.store.patch({ memoryGraphFilterType: active ? 'all' : type });
			void widget.controller.loadMemoryGraph(false);
		}));
	}
	const entities = state.memoryGraphEntities;
	if (!entities.length) {
		DOM.append(body, DOM.$('.knox-gui-empty', undefined, state.memoryGraphQuery.trim() || state.memoryGraphFilterType !== 'all' ? t(state, 'memoryNoEntitiesFound') : t(state, 'memoryNoEntitiesYet')));
		return;
	}
	DOM.append(body, DOM.$('p.knox-gui-hint', undefined, t(state, 'memoryGraphShowingEntities', { shown: entities.length, total: state.memoryGraphTotal || entities.length })));
	for (const entity of entities) {
		const color = graphEntityColor(entity.entityType);
		const row = DOM.append(body, DOM.$('.knox-gui-card.knox-gui-entity-row'));
		const avatar = DOM.append(row, DOM.$('span.knox-gui-entity-avatar', undefined, (entity.entityType?.[0] ?? '?').toUpperCase()));
		avatar.style.background = `${color}20`;
		avatar.style.color = color;
		const main = DOM.append(row, DOM.$('div.knox-gui-entity-main'));
		const title = DOM.append(main, DOM.$('.knox-gui-row'));
		DOM.append(title, DOM.$('strong', undefined, entity.name));
		const type = DOM.append(title, DOM.$('span.knox-gui-count-badge', undefined, entity.entityType));
		type.style.background = `${color}15`;
		type.style.color = color;
		if (entity.description) {
			DOM.append(main, DOM.$('div.knox-gui-muted.knox-gui-ellipsis', undefined, entity.description));
		}
		const meta = DOM.append(main, DOM.$('.knox-gui-hint'));
		DOM.append(meta, DOM.$('span', undefined, `${t(state, 'memoryEntityMentions')}: ${entity.mentionCount}`));
		if (entity.edgeCount != null) {
			DOM.append(meta, DOM.$('span', undefined, ` · ${t(state, 'memoryGraphEntityEdges')}: ${entity.edgeCount}`));
		}
		widget.chromeButton(row, {
			svg: widget.memoryExploringId === entity.id ? undefined : 'compass',
			svgSize: 12,
			label: t(state, 'memoryExplore'),
			disabled: widget.memoryExploringId === entity.id,
			onClick: () => {
				widget.memoryExploringId = entity.id;
				widget.controller.store.patch({});
				void widget.controller.exploreMemoryEntity(entity.id).finally(() => {
					widget.memoryExploringId = null;
					widget.controller.store.patch({});
				});
			},
		});
		if (widget.memoryExploringId === entity.id) {
			widget.appendSpinner(row.lastElementChild as HTMLElement, 12);
		}
	}
	if (state.memoryGraphHasMore) {
		const more = DOM.append(body, DOM.$('.knox-gui-row'));
		if (state.memoryGraphTotal) {
			DOM.append(more, DOM.$('span.knox-gui-muted', undefined, `${state.memoryGraphEntities.length} / ${state.memoryGraphTotal}`));
		}
		widget.chromeButton(more, { label: t(state, 'memoryLoadMore'), onClick: () => void widget.controller.loadMemoryGraph(true) });
	}
}

export function renderMemorySettings(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void { // KN-376 KN-314
	const config = state.memoryConfig;
	for (const group of MEMORY_SETTING_GROUPS) {
		const open = group.collapsed ? widget.memorySettingsOpen.has(group.titleKey) : !widget.memorySettingsOpen.has(`closed:${group.titleKey}`);
		const card = sectionCard(body, t(state, group.titleKey), (MEMORY_SETTING_GROUP_ICONS[group.titleKey] as KnoxGuiSvgIcon) || 'settings', {
			collapsible: true,
			open,
			onToggle: () => {
				if (group.collapsed) {
					if (widget.memorySettingsOpen.has(group.titleKey)) {
						widget.memorySettingsOpen.delete(group.titleKey);
					} else {
						widget.memorySettingsOpen.add(group.titleKey);
					}
				} else {
					const key = `closed:${group.titleKey}`;
					if (widget.memorySettingsOpen.has(key)) {
						widget.memorySettingsOpen.delete(key);
					} else {
						widget.memorySettingsOpen.add(key);
					}
				}
				widget.render();
			},
		});
		if (!open) {
			continue;
		}
		if (group.descKey) {
			DOM.append(card, DOM.$('p.knox-gui-muted', undefined, t(state, group.descKey)));
		}
		let lastSection: string | undefined;
		for (const field of group.fields) {
			if (field.sectionKey && field.sectionKey !== lastSection) {
				lastSection = field.sectionKey;
				DOM.append(card, DOM.$('p.knox-gui-settings-section', undefined, t(state, field.sectionKey)));
			}
			if (field.kind === 'toggle') {
				widget.toggle(card, t(state, field.labelKey), config[field.key] !== false && config[field.key] !== 'false', value => widget.controller.updateMemoryConfig(field.key, value));
			} else if (field.kind === 'text') {
				const row = DOM.append(card, DOM.$('label.knox-gui-settings-stack'));
				DOM.append(row, DOM.$('span', undefined, t(state, field.labelKey)));
				const input = DOM.append(row, DOM.$('input')) as HTMLInputElement;
				input.type = 'text';
				input.value = String(config[field.key] ?? '');
				widget.renderStore.add(DOM.addDisposableListener(input, 'change', () => widget.controller.updateMemoryConfig(field.key, input.value)));
			} else if (field.kind === 'number') {
				if (field.percent) {
					const ratio = Number(config[field.key] ?? field.min ?? 0);
					widget.numberField(card, t(state, field.labelKey), Math.round(ratio * 100), Math.round((field.min ?? 0) * 100), Math.round((field.max ?? 1) * 100), value => widget.controller.updateMemoryConfig(field.key, value / 100), 1, '%');
				} else {
					widget.numberField(card, t(state, field.labelKey), Number(config[field.key] ?? field.min ?? 0), field.min ?? 0, field.max ?? 100000, value => widget.controller.updateMemoryConfig(field.key, value), field.step, field.suffixKey ? t(state, field.suffixKey) : undefined);
				}
			} else if (field.kind === 'select' && field.options) {
				const row = DOM.append(card, DOM.$('label.knox-gui-row'));
				DOM.append(row, DOM.$('span', undefined, t(state, field.labelKey)));
				const select = DOM.append(row, DOM.$('select.knox-gui-select')) as HTMLSelectElement;
				for (const option of field.options) {
					const el = DOM.append(select, DOM.$('option')) as HTMLOptionElement;
					el.value = option.value;
					el.textContent = t(state, option.labelKey);
					if (String(config[field.key] ?? '') === option.value) {
						el.selected = true;
					}
				}
				widget.renderStore.add(DOM.addDisposableListener(select, 'change', () => widget.controller.updateMemoryConfig(field.key, select.value)));
			}
			if (field.descKey) {
				DOM.append(card, DOM.$('p.knox-gui-muted', undefined, t(state, field.descKey)));
			}
		}
	}
	const actionsCard = sectionCard(body, t(state, 'memoryMaintenanceActions'), 'wrench');
	const actions = DOM.append(actionsCard, DOM.$('.knox-gui-stat-grid.knox-gui-stat-grid-2'));
	widget.chromeButton(actions, { svg: 'zap', svgSize: 14, label: t(state, 'memoryOptimizeDb'), testId: 'knox-gui-memory-optimize', onClick: () => void widget.controller.runMemoryMaintenance('optimize') });
	widget.chromeButton(actions, { svg: 'heart-pulse', svgSize: 14, label: t(state, 'memoryHealSystem'), testId: 'knox-gui-memory-heal', onClick: () => void widget.controller.runMemoryMaintenance('heal') });
	widget.chromeButton(actions, { svg: 'rotate-cw', svgSize: 14, label: t(state, 'memoryConsolidateNow'), onClick: () => void widget.controller.consolidateMemory() });
	widget.chromeButton(actions, { svg: 'download', svgSize: 14, label: t(state, 'memoryExportData'), testId: 'knox-gui-memory-export', onClick: () => void widget.controller.exportMemory(widget.memoryExportPassword) });
	const importBtn = widget.chromeButton(actions, { svg: 'file-input', svgSize: 14, label: t(state, 'memoryImportData'), onClick: () => file.click() });
	void importBtn;
	const file = DOM.append(actionsCard, DOM.$('input.knox-gui-hidden-file')) as HTMLInputElement;
	file.type = 'file';
	file.accept = '.json,application/json';
	widget.renderStore.add(DOM.addDisposableListener(file, 'change', () => {
		const picked = file.files?.[0];
		file.value = '';
		if (picked) {
			void importMemoryFile(widget, picked);
		}
	}));
	DOM.append(actionsCard, DOM.$('p.knox-gui-muted', undefined, t(state, 'memoryImportCopiedInstructions')));
	const exp = DOM.append(actionsCard, DOM.$('.knox-gui-settings-stack'));
	DOM.append(exp, DOM.$('label', undefined, t(state, 'memoryExportPasswordOptional')));
	const exportPass = DOM.append(exp, DOM.$('input')) as HTMLInputElement;
	exportPass.type = 'password';
	exportPass.value = widget.memoryExportPassword;
	exportPass.placeholder = t(state, 'memoryExportPasswordPlaceholder');
	widget.renderStore.add(DOM.addDisposableListener(exportPass, 'input', () => { widget.memoryExportPassword = exportPass.value; }));
	const imp = DOM.append(actionsCard, DOM.$('.knox-gui-settings-stack'));
	DOM.append(imp, DOM.$('label', undefined, t(state, 'memoryImportPasswordOptional')));
	const importPass = DOM.append(imp, DOM.$('input')) as HTMLInputElement;
	importPass.type = 'password';
	importPass.value = widget.memoryImportPassword;
	importPass.placeholder = t(state, 'memoryImportPasswordPlaceholder');
	widget.renderStore.add(DOM.addDisposableListener(importPass, 'input', () => { widget.memoryImportPassword = importPass.value; }));
	const danger = sectionCard(body, t(state, 'memoryDangerZone'), 'alert-triangle');
	DOM.append(danger, DOM.$('p.knox-gui-muted', undefined, t(state, 'memoryDangerZoneDesc')));
	widget.chromeButton(danger, {
		svg: 'trash',
		svgSize: 14,
		label: t(state, 'memoryPurgeExpired'),
		extraClass: 'knox-gui-danger',
		testId: 'knox-gui-memory-purge',
		onClick: () => void widget.controller.runMemoryMaintenance('purge'),
	});
}

async function importMemoryFile(widget: KnoxGuiWidget, file: File): Promise<void> {
	try {
		const textContent = await file.text();
		let parsed: { version?: string } | null = null;
		try {
			parsed = JSON.parse(textContent) as { version?: string };
		} catch {
			parsed = null;
		}
		if (!parsed?.version) {
		widget.controller.messenger.post('showToast', ['error', t(widget.controller.store.state, 'memoryImportInvalidFile')]);
			return;
		}
		if (parsed.version === 'knox-brain-encrypted-v1' && !widget.memoryImportPassword.trim()) {
			widget.controller.messenger.post('showToast', ['error', t(widget.controller.store.state, 'memoryImportPasswordRequired')]);
			return;
		}
		await widget.controller.importMemoryData(textContent, widget.memoryImportPassword);
		widget.memoryImportPassword = '';
	} catch {
		// optional
	}
}

function renderMemoryDeleteDialog(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	if (!widget.memoryConfirmDeleteIds) {
		return;
	}
	const overlay = DOM.append(body, DOM.$('.knox-gui-modal'));
	overlay.setAttribute('role', 'dialog');
	const dialog = DOM.append(overlay, DOM.$('.knox-gui-dialog.knox-gui-modal-dialog'));
	const head = DOM.append(dialog, DOM.$('.knox-gui-row'));
	appendKnoxGuiSvg(head, 'alert-triangle', 16).style.color = '#f59e0b';
	DOM.append(head, DOM.$('h3', undefined, t(state, 'memoryConfirmDelete')));
	DOM.append(dialog, DOM.$('p', undefined, widget.memoryConfirmDeleteBulk ? t(state, 'memoryConfirmBulkDelete', { count: widget.memoryConfirmDeleteIds.length }) : t(state, 'memoryConfirmDeleteSingle')));
	DOM.append(dialog, DOM.$('p.knox-gui-muted', undefined, t(state, 'cannotBeUndone')));
	const actions = DOM.append(dialog, DOM.$('.knox-gui-row'));
	widget.chromeButton(actions, { label: t(state, 'cancel'), onClick: () => { widget.memoryConfirmDeleteIds = null; widget.controller.store.patch({}); } });
	widget.chromeButton(actions, {
		label: t(state, 'deleteAction'),
		extraClass: 'knox-gui-danger',
		testId: 'memory-confirm-delete',
		onClick: () => {
			const ids = widget.memoryConfirmDeleteIds ?? [];
			widget.memoryConfirmDeleteIds = null;
			widget.memoryConfirmDeleteBulk = false;
			void widget.controller.deleteMemories(ids);
		},
	});
	widget.renderStore.add(DOM.addDisposableListener(overlay, 'click', e => {
		if (e.target === overlay) {
			widget.memoryConfirmDeleteIds = null;
			widget.controller.store.patch({});
		}
	}));
}

function sectionCard(parent: HTMLElement, title: string, icon: KnoxGuiSvgIcon, options?: { collapsible?: boolean; open?: boolean; onToggle?: () => void }): HTMLElement {
	const card = DOM.append(parent, DOM.$('.knox-gui-section-card'));
	const heading = DOM.append(card, options?.collapsible ? DOM.$('button.knox-gui-section-title') : DOM.$('h3.knox-gui-section-title')) as HTMLElement;
	if (options?.collapsible) {
		(heading as HTMLButtonElement).type = 'button';
	}
	appendKnoxGuiSvg(heading, icon, 14);
	DOM.append(heading, DOM.$('span', undefined, title));
	if (options?.collapsible) {
		appendKnoxGuiSvg(heading, options.open ? 'chevron-down' : 'chevron-right', 14);
		heading.addEventListener('click', () => options.onToggle?.());
	}
	return card;
}

function statCard(parent: HTMLElement, icon: KnoxGuiSvgIcon, label: string, value: string | number): void {
	const cell = DOM.append(parent, DOM.$('.knox-gui-stat-card'));
	appendKnoxGuiSvg(cell, icon, 20).style.color = '#159994';
	DOM.append(cell, DOM.$('strong.knox-gui-stat-value', undefined, typeof value === 'number' ? value.toLocaleString() : value));
	DOM.append(cell, DOM.$('span.knox-gui-muted', undefined, label));
}

function metricCell(parent: HTMLElement, value: string, label: string, color?: string): void {
	const el = DOM.append(parent, DOM.$('.knox-gui-metric'));
	const strong = DOM.append(el, DOM.$('strong', undefined, value));
	strong.style.color = color ?? '#159994';
	DOM.append(el, DOM.$('span.knox-gui-muted', undefined, label));
}

function trendCell(parent: HTMLElement, value: string | undefined, label: string, detail?: string): void {
	if (!value) {
		return;
	}
	const el = DOM.append(parent, DOM.$('.knox-gui-metric'));
	const strong = DOM.append(el, DOM.$('strong.knox-gui-capitalize', undefined, value));
	strong.style.color = MEMORY_TREND_COLORS[value] ?? '#6b7280';
	DOM.append(el, DOM.$('span.knox-gui-muted', undefined, label));
	if (detail) {
		DOM.append(el, DOM.$('span.knox-gui-hint', undefined, detail));
	}
}

function meterRow(parent: HTMLElement, label: string, value: string, pct: number, color: string): void {
	const head = DOM.append(parent, DOM.$('.knox-gui-row'));
	DOM.append(head, DOM.$('span.knox-gui-muted', undefined, label));
	DOM.append(head, DOM.$('span.knox-gui-muted', undefined, value));
	meterBar(parent, pct, color);
}

function meterBar(parent: HTMLElement, pct: number, color: string): void {
	const track = DOM.append(parent, DOM.$('.knox-gui-meter-track'));
	const fill = DOM.append(track, DOM.$('.knox-gui-meter-fill'));
	fill.style.width = `${pct}%`;
	fill.style.background = color;
}

function entityChip(widget: KnoxGuiWidget, parent: HTMLElement, name: string, type: string | undefined, isCenter: boolean, onClick: () => void): void {
	const color = graphEntityColor(type);
	const chip = DOM.append(parent, DOM.$('button.knox-gui-entity-chip')) as HTMLButtonElement;
	chip.type = 'button';
	chip.textContent = name;
	if (isCenter) {
		chip.style.background = color;
		chip.style.color = '#fff';
		chip.style.fontWeight = '700';
	} else {
		chip.style.background = `${color}30`;
		chip.style.color = color;
		chip.style.borderColor = `${color}50`;
	}
	widget.renderStore.add(DOM.addDisposableListener(chip, 'click', onClick));
}
