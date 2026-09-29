/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../knoxGuiWidget.js';
import { t } from './t.js';
import { KnoxGuiRoute } from '../../../common/knoxGuiProtocol.js';
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
	MEMORY_BROWSER_CATEGORY_ICONS,
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
	memoryBrowserEmptyKey,
	memoryGraphTypeCounts,
	memorySnippet,
	parseMemorySettingInput,
	rangeSelectMemoryIds,
	type IKnoxGuiMemorySettingField,
	visibleMemoryExploreEdges,
	uniqueMemoryCategories,
} from '../../../common/knoxGuiMemory.js';
import { IKnoxGuiState } from '../../../common/knoxGuiState.js';

/** `index.tsx`: Brain / Database / Settings are `text-knoxcyan`; the inline Sessions and Graph svgs use `currentColor`. */
const MEMORY_TEAL_TAB_ICONS = new Set(['overview', 'memories', 'settings']);

/** Tokens map to `knox-gui-memory-<token>` (Tailwind-equivalent classes in knoxGuiMemory.css); `knox-gui-*`, `is-*` and `selected` pass through. */
function memoryClasses(tokens: string): string {
	return tokens.split(' ').filter(Boolean).map(token => token.startsWith('knox-gui-') || token.startsWith('is-') || token === 'selected' ? token : `knox-gui-memory-${token}`).join(' ');
}

function mk<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, tokens: string, text?: string): HTMLElementTagNameMap[K] {
	const el = DOM.append(parent, DOM.$(tag)) as HTMLElementTagNameMap[K];
	if (tokens) {
		el.className = memoryClasses(tokens);
	}
	if (text !== undefined) {
		el.textContent = text;
	}
	return el;
}

function svg(parent: HTMLElement, icon: KnoxGuiSvgIcon, size: number, tokens?: string): SVGSVGElement {
	const el = appendKnoxGuiSvg(parent, icon, size);
	if (tokens) {
		el.classList.add(...memoryClasses(tokens).split(' '));
	}
	return el;
}

function spinner(parent: HTMLElement, size: number, border = 2): HTMLElement {
	const el = mk(parent, 'div', 'spinner');
	el.style.width = `${size}px`;
	el.style.height = `${size}px`;
	el.style.borderWidth = `${border}px`;
	el.setAttribute('aria-hidden', 'true');
	return el;
}

function memoryButton(widget: KnoxGuiWidget, parent: HTMLElement, options: {
	tokens: string;
	icon?: KnoxGuiSvgIcon;
	iconSize?: number;
	iconTokens?: string;
	spinning?: boolean;
	label?: string;
	labelTokens?: string;
	title?: string;
	ariaLabel?: string;
	disabled?: boolean;
	testId?: string;
	onClick: (e: MouseEvent) => void;
}): HTMLButtonElement {
	const button = mk(parent, 'button', options.tokens);
	button.type = 'button';
	if (options.testId) {
		button.setAttribute('data-testid', options.testId);
	}
	if (options.title) {
		button.title = options.title;
	}
	if (options.ariaLabel) {
		button.setAttribute('aria-label', options.ariaLabel);
	}
	button.disabled = !!options.disabled;
	if (options.spinning) {
		svg(button, 'loader-2', options.iconSize ?? 12, 'spin');
	} else if (options.icon) {
		svg(button, options.icon, options.iconSize ?? 12, options.iconTokens);
	}
	if (options.label !== undefined) {
		mk(button, 'span', options.labelTokens ?? '', options.label);
	}
	widget.renderStore.add(DOM.addDisposableListener(button, 'click', (e: MouseEvent) => {
		e.stopPropagation();
		options.onClick(e);
	}));
	return button;
}

function modalHost(body: HTMLElement): HTMLElement {
	return body.closest<HTMLElement>('.knox-gui-memory-page') ?? body;
}

export function renderMemory(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void { // KN-376
	body.classList.add('knox-gui-memory-page');
	body.setAttribute('data-testid', 'knox-gui-memory');
	if (state.lockedRoute === KnoxGuiRoute.Memory && !state.memoryTabHydrated) {
		// MemoryPanelPage.tsx renders nothing until the saved tab id is known, so Overview never flashes first.
		return;
	}
	const bar = mk(body, 'div', 'tabbar');
	const tabs = mk(bar, 'div', 'tabs');
	for (const id of MEMORY_TAB_IDS) {
		const selected = state.memoryTab === id;
		const tab = mk(tabs, 'button', selected ? 'tab selected' : 'tab');
		tab.type = 'button';
		tab.style.fontSize = `${state.fontSize - 2}px`;
		tab.setAttribute('data-testid', `knox-gui-memory-tab-${id}`);
		const icon = MEMORY_TAB_ICONS[id] as KnoxGuiSvgIcon | undefined;
		if (icon) {
			svg(tab, icon, 14, MEMORY_TEAL_TAB_ICONS.has(id) ? 'teal' : undefined);
		}
		mk(tab, 'span', '', t(state, MEMORY_TAB_KEYS[id]));
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
	const pane = mk(body, 'div', 'body');
	const paneTestIds: Record<string, string> = {
		overview: 'knox-gui-memory-overview',
		memories: 'knox-gui-memory-browser',
		sessions: 'knox-gui-memory-sessions',
		graph: 'knox-gui-memory-graph',
		settings: 'knox-gui-memory-settings',
	};
	pane.setAttribute('data-testid', paneTestIds[state.memoryTab] ?? `knox-gui-memory-${state.memoryTab}`);
	const view = mk(pane, 'div', 'view');
	if (state.memoryActionMessage) {
		const notice = mk(view, 'div', 'banner is-notice');
		svg(notice, 'check', 14);
		mk(notice, 'span', 'flex-1', t(state, state.memoryActionMessage));
	}
	if (state.memoryTab === 'overview') {
		widget.renderMemoryOverview(view, state);
	} else if (state.memoryTab === 'memories') {
		widget.renderMemoryBrowser(view, state);
	} else if (state.memoryTab === 'sessions') {
		widget.renderMemorySessions(view, state);
	} else if (state.memoryTab === 'graph') {
		widget.renderMemoryGraph(view, state);
	} else {
		widget.renderMemorySettings(view, state);
	}
}

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

export function renderMemoryBrowser(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void { // KN-376 KN-311
	body.classList.add(...memoryClasses('py-4 sy-3').split(' '));
	renderMemoryDeleteDialog(widget, body, state);
	const resetSelection = () => {
		widget.memorySelectedIds.clear();
		widget.memoryLastClickedId = null;
	};
	const reload = () => {
		resetSelection();
		void widget.controller.loadMemories(false);
	};
	if (state.memoryBrowserError) {
		const banner = mk(body, 'div', 'banner is-error');
		banner.setAttribute('data-testid', 'memory-browser-error');
		svg(banner, 'x', 14);
		mk(banner, 'span', 'flex-1', t(state, state.memoryBrowserError.key, { count: state.memoryBrowserError.count ?? 0 }));
		memoryButton(widget, banner, { tokens: 'banner-close', icon: 'x', ariaLabel: t(state, 'close'), onClick: () => widget.controller.showMemoryBanner('error', undefined) });
	}
	if (state.memoryBrowserNotice) {
		const banner = mk(body, 'div', 'banner is-notice');
		banner.setAttribute('data-testid', 'memory-browser-notice');
		svg(banner, 'check', 14);
		mk(banner, 'span', 'flex-1', t(state, state.memoryBrowserNotice.key, { count: state.memoryBrowserNotice.count ?? 0 }));
	}
	const searchWrap = mk(body, 'div', 'search knox-gui-memory-search');
	const input = mk(searchWrap, 'input', 'field search-input');
	input.type = 'text';
	input.placeholder = t(state, 'memorySearchPlaceholder');
	input.value = widget.memorySearchDraft || state.memoryQuery;
	svg(searchWrap, 'search', 14, 'search-icon o-50');
	widget.renderStore.add(DOM.addDisposableListener(input, 'input', () => {
		widget.memorySearchDraft = input.value;
		clear.hidden = !input.value;
		applyMemoryBrowserFilter(widget, widget.controller.store.state);
		if (widget.memorySearchTimer) {
			clearTimeout(widget.memorySearchTimer);
		}
		widget.memorySearchTimer = setTimeout(() => {
			widget.controller.store.patch({ memoryQuery: widget.memorySearchDraft });
			reload();
		}, 300);
	}));
	const clear = memoryButton(widget, searchWrap, {
		tokens: 'search-clear',
		icon: 'x',
		ariaLabel: t(state, 'clearSearch'),
		onClick: () => {
			widget.memorySearchDraft = '';
			input.value = '';
			clear.hidden = true;
			if (widget.memorySearchTimer) {
				clearTimeout(widget.memorySearchTimer);
				widget.memorySearchTimer = undefined;
			}
			applyMemoryBrowserFilter(widget, widget.controller.store.state);
			widget.controller.store.patch({ memoryQuery: '' });
			reload();
			input.focus();
		},
	});
	clear.hidden = !(widget.memorySearchDraft || state.memoryQuery);

	const filters = mk(body, 'div', 'flex flex-wrap items-center gap-2 xs');
	const filterSelect = (options: ReadonlyArray<readonly [string, string]>, current: string, onChange: (value: string) => void): HTMLSelectElement => {
		const select = mk(filters, 'select', 'dropdown');
		for (const [value, label] of options) {
			const el = mk(select, 'option', '', label);
			el.value = value;
			el.selected = value === current;
		}
		widget.renderStore.add(DOM.addDisposableListener(select, 'change', () => onChange(select.value)));
		return select;
	};
	filterSelect([['all', t(state, 'memoryAllCategories')], ...uniqueMemoryCategories(state.memories).map(cat => [cat, cat] as const)], state.memoryFilterCategory, value => {
		widget.controller.store.patch({ memoryFilterCategory: value });
		reload();
	});
	filterSelect([['all', t(state, 'memoryAllTiers')], ['hot', t(state, 'memoryTierHot')], ['warm', t(state, 'memoryTierWarm')], ['cold', t(state, 'memoryTierCold')]], state.memoryFilterTier, value => {
		widget.controller.store.patch({ memoryFilterTier: value });
		reload();
	}).setAttribute('data-testid', 'memory-filter-tier');
	filterSelect([['all', t(state, 'memoryAllPins')], ['pinned', t(state, 'memoryPinnedOnly')], ['unpinned', t(state, 'memoryUnpinnedOnly')]], state.memoryFilterPinned, value => {
		widget.controller.store.patch({ memoryFilterPinned: value as IKnoxGuiState['memoryFilterPinned'] });
		reload();
	}).setAttribute('aria-label', t(state, 'memoryAllPins'));
	filterSelect([['recent', t(state, 'memorySortRecent')], ['importance', t(state, 'memorySortImportance')], ['accessed', t(state, 'memorySortAccessed')]], state.memorySortBy, value => {
		widget.controller.store.patch({ memorySortBy: value as IKnoxGuiState['memorySortBy'] });
	});

	const memories = filterAndSortMemories(state.memories, {
		category: state.memoryFilterCategory,
		tier: state.memoryFilterTier,
		pinned: state.memoryFilterPinned,
		sortBy: state.memorySortBy,
	});
	const orderedIds = memories.map(memory => memory.id);
	const selectAll = () => {
		widget.memorySelectedIds = new Set(orderedIds);
		widget.memorySelectionMode = true;
		widget.render();
	};
	const exitSelection = () => {
		widget.memorySelectionMode = false;
		resetSelection();
		widget.render();
	};
	if (widget.memorySelectionMode) {
		widget.renderStore.add(DOM.addDisposableListener(DOM.getWindow(body), 'keydown', (e: KeyboardEvent) => {
			if (widget.memoryConfirmDeleteIds) {
				return;
			}
			if (e.key === 'Escape') {
				exitSelection();
				return;
			}
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
				const target = e.target as HTMLElement | null;
				if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
					return;
				}
				e.preventDefault();
				selectAll();
			}
		}));
	}

	const toolbar = mk(body, 'div', 'browser-toolbar');
	const counts = mk(toolbar, 'div', 'flex items-center gap-2 xs o-70');
	if (widget.memorySelectedIds.size) {
		const badge = mk(counts, 'span', 'selected-badge');
		badge.setAttribute('data-testid', 'memory-selected-count');
		svg(badge, 'check', 10);
		mk(badge, 'span', '', t(state, 'selectedCount', { count: widget.memorySelectedIds.size }));
	}
	const found = mk(counts, 'span', '', `${memories.length} ${t(state, 'memoryMemoriesFound')}`);
	found.setAttribute('data-memory-found-count', '1');
	const tools = mk(toolbar, 'div', 'flex flex-wrap items-center gap-1');
	const selected = [...widget.memorySelectedIds];
	const busy = state.memoryBrowserBusy;
	const toolButton = (icon: KnoxGuiSvgIcon, label: string, title: string, onClick: () => void, options?: { disabled?: boolean; danger?: boolean; smInline?: boolean }) => memoryButton(widget, tools, {
		tokens: options?.danger ? 'toolbar-btn is-danger' : 'toolbar-btn btn-secondary',
		icon,
		label,
		labelTokens: options?.smInline ? 'sm-inline' : '',
		title,
		disabled: options?.disabled,
		onClick,
	});
	if (!widget.memorySelectionMode) {
		toolButton('check-square', t(state, 'select'), t(state, 'memorySelectMultiple'), () => { widget.memorySelectionMode = true; widget.render(); });
	} else {
		toolButton('check-square', t(state, 'selectAll'), t(state, 'memorySelectAllMemories'), selectAll);
		toolButton('square', t(state, 'clear'), t(state, 'clearAllSelections'), () => { resetSelection(); widget.render(); });
		toolButton('pin', t(state, 'memoryPin'), t(state, 'memoryPinSelected'), () => void widget.controller.pinMemories(selected, true, true), { disabled: !selected.length || busy, smInline: true });
		toolButton('pin-off', t(state, 'memoryUnpin'), t(state, 'memoryUnpinSelected'), () => void widget.controller.pinMemories(selected, false, true), { disabled: !selected.length || busy, smInline: true });
		const exportSelected = (format: 'json' | 'markdown') => {
			const picked = memories.filter(memory => widget.memorySelectedIds.has(memory.id));
			if (!picked.length) {
				return;
			}
			const text = format === 'json' ? memoriesToExportJson(picked) : memoriesToExportMarkdown(picked);
			void widget.controller.messenger.request('copyText', { text }).then(
				() => widget.controller.showMemoryBanner('notice', { key: 'memoryExportSelectedCopied', count: picked.length }),
				() => widget.controller.showMemoryBanner('error', { key: 'memoryExportSelectedFailed' }),
			);
		};
		toolButton('file-json', 'JSON', t(state, 'memoryExportSelectedJson'), () => exportSelected('json'), { disabled: !selected.length });
		toolButton('copy', 'MD', t(state, 'memoryExportSelectedMarkdown'), () => exportSelected('markdown'), { disabled: !selected.length });
		toolButton('trash-2', t(state, 'deleteCount', { count: selected.length }), t(state, 'memoryDeleteSelected'), () => { widget.memoryConfirmDeleteIds = selected; widget.memoryConfirmDeleteBulk = true; widget.render(); }, { disabled: !selected.length || busy, danger: true });
		toolButton('x', t(state, 'exit'), t(state, 'exitSelectionMode'), exitSelection);
	}

	if (widget.memorySelectionMode && memories.length) {
		const all = orderedIds.every(id => widget.memorySelectedIds.has(id));
		const some = orderedIds.some(id => widget.memorySelectedIds.has(id));
		const header = mk(body, 'button', 'select-all');
		header.type = 'button';
		header.setAttribute('data-testid', 'memory-select-all-header');
		const box = mk(header, 'span', 'check');
		box.setAttribute('role', 'checkbox');
		box.setAttribute('aria-checked', all ? 'true' : some ? 'mixed' : 'false');
		if (some) {
			box.style.borderColor = '#159994';
		}
		if (all) {
			box.style.backgroundColor = '#159994';
			svg(box, 'check', 10);
		} else if (some) {
			mk(box, 'span', 'check-dot');
		}
		mk(header, 'span', '', all ? t(state, 'clear') : t(state, 'selectAll'));
		widget.renderStore.add(DOM.addDisposableListener(header, 'click', () => {
			if (all) {
				resetSelection();
				widget.render();
			} else {
				selectAll();
			}
		}));
	}

	const list = mk(body, 'div', 'sy-2');
	if (state.memoriesLoading) {
		const loading = mk(list, 'div', 'py-8 text-center');
		loading.setAttribute('data-testid', 'memory-browser-loading');
		spinner(loading, 24).classList.add('knox-gui-memory-mx-auto');
		return;
	}
	if (!memories.length) {
		mk(list, 'div', 'py-8 text-center sm o-50', t(state, memoryBrowserEmptyKey(state.memoryQuery, state.memoryFilterPinned, state.memoryFilterTier)));
		return;
	}
	if (state.memorySortBy === 'recent') {
		for (const group of groupMemoriesByDate(memories)) {
			const section = mk(list, 'div', 'sy-2 knox-gui-memory-date-group');
			const head = mk(section, 'div', 'kv pt-1');
			mk(head, 'h2', 'xs fw-6 o-70', t(state, group.headerKey));
			const groupCount = mk(head, 'span', 't-10 o-50', t(state, 'itemsCount', { count: group.memories.length }));
			groupCount.setAttribute('data-memory-group-count', '1');
			for (const memory of group.memories) {
				renderMemoryRow(widget, section, state, memory, orderedIds);
			}
		}
	} else {
		for (const memory of memories) {
			renderMemoryRow(widget, list, state, memory, orderedIds);
		}
	}
	const empty = mk(list, 'div', 'py-8 text-center sm o-50', t(state, memoryBrowserEmptyKey(widget.memorySearchDraft || state.memoryQuery, state.memoryFilterPinned, state.memoryFilterTier)));
	empty.setAttribute('data-memory-empty', '1');
	applyMemoryBrowserFilter(widget, state);
	if (state.memoryHasMore) {
		const more = mk(body, 'div', 'flex justify-center pt-2');
		const button = memoryButton(widget, more, {
			tokens: 'load-more btn-secondary',
			icon: state.memoriesLoadingMore ? undefined : 'chevron-down',
			iconSize: 14,
			label: t(state, 'memoryLoadMore'),
			disabled: state.memoriesLoadingMore,
			testId: 'memory-load-more',
			onClick: () => void widget.controller.loadMemories(true),
		});
		if (state.memoriesLoadingMore) {
			button.prepend(spinner(button, 12, 1));
		}
	}
}

function renderMemoryRow(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, memory: IKnoxGuiState['memories'][number], orderedIds: string[]): void {
	const selected = widget.memorySelectedIds.has(memory.id);
	const row = mk(body, 'div', selected ? 'memory-row selected' : 'memory-row');
	row.setAttribute('data-testid', `memory-row-${memory.id}`);
	row.setAttribute('data-memory-id', memory.id);
	if (widget.memorySelectionMode) {
		row.classList.add('is-selecting');
	}
	widget.renderStore.add(DOM.addDisposableListener(row, 'click', e => {
		if (widget.memorySelectionMode) {
			widget.memorySelectedIds = rangeSelectMemoryIds(orderedIds, e.shiftKey ? widget.memoryLastClickedId : null, memory.id, widget.memorySelectedIds);
			widget.memoryLastClickedId = memory.id;
		} else if (!(e.target as HTMLElement).closest('button')) {
			widget.memoryExpandedId = widget.memoryExpandedId === memory.id ? null : memory.id;
		}
		widget.render();
	}));
	const head = mk(row, 'div', 'flex items-center gap-2');
	if (widget.memorySelectionMode) {
		const box = mk(head, 'span', 'check xs');
		box.setAttribute('role', 'checkbox');
		box.setAttribute('aria-checked', String(selected));
		box.setAttribute('aria-label', t(state, 'memorySelectRow', { title: memory.title }));
		if (selected) {
			box.style.borderColor = '#159994';
			box.style.backgroundColor = '#159994';
			svg(box, 'check', 10);
		}
	}
	svg(mk(head, 'span', 'sm'), (MEMORY_BROWSER_CATEGORY_ICONS[memory.category ?? ''] as KnoxGuiSvgIcon) || 'file', 14);
	if (memory.category) {
		mk(head, 'span', 'row-badge badge-colors', memory.category);
	}
	if (memory.tier) {
		const color = MEMORY_TIER_COLORS[memory.tier];
		if (color) {
			const badge = mk(head, 'span', 'row-badge knox-gui-tier', memory.tier);
			badge.style.backgroundColor = color.bg;
			badge.style.color = color.text;
		}
	}
	const title = mk(head, 'span', 'flex-1 truncate sm fw-5');
	if (memory.pinned) {
		svg(title, 'pin', 11, 'row-pin teal');
	}
	title.append(memory.title);
	if (!widget.memorySelectionMode) {
		const hover = mk(head, 'div', 'row-actions');
		memoryButton(widget, hover, {
			tokens: 'row-action',
			icon: memory.pinned ? 'pin-off' : 'pin',
			iconTokens: memory.pinned ? 'teal' : undefined,
			title: memory.pinned ? t(state, 'memoryUnpin') : t(state, 'memoryPin'),
			onClick: () => void widget.controller.pinMemories([memory.id], !memory.pinned, false),
		});
		memoryButton(widget, hover, {
			tokens: 'row-action is-forget',
			icon: 'x',
			title: t(state, 'memoryForget'),
			onClick: () => { widget.memoryConfirmDeleteIds = [memory.id]; widget.memoryConfirmDeleteBulk = false; widget.render(); },
		});
	}
	if (widget.memoryExpandedId !== memory.id) {
		mk(row, 'div', 'mt-1 truncate pl-6 xs o-55', memorySnippet(memory.content ?? memory.title));
	} else if (!widget.memorySelectionMode) {
		const detail = mk(row, 'div', 'divided mt-2 pt-2 sy-2');
		mk(detail, 'pre', 'raw-md xs o-80 knox-gui-raw-md', memory.content ?? '');
		const meta = mk(detail, 'div', 'flex flex-wrap gap-3 xs o-50');
		mk(meta, 'span', '', `${t(state, 'memoryDetailImportance')}: ${(memory.importance ?? 0).toFixed(2)}`);
		mk(meta, 'span', '', `${t(state, 'memoryDetailUsed')}: ${t(state, 'memoryDetailUsedTimes', { count: memory.retrievalCount ?? 0 })}`);
		if (memory.createdAt) {
			mk(meta, 'span', '', `${t(state, 'memoryDetailCreated')}: ${formatMemoryDate(memory.createdAt)}`);
		}
		if (memory.lastAccessedAt) {
			mk(meta, 'span', '', `${t(state, 'memoryDetailLastAccessed')}: ${formatMemoryDate(memory.lastAccessedAt)}`);
		}
		if (memory.sourceSessionId) {
			mk(meta, 'span', '', `${t(state, 'memoryDetailSession')}: ${memory.sourceSessionId.slice(0, 8)}…`);
		}
		if (memory.keywords) {
			const chips = mk(detail, 'div', 'flex flex-wrap gap-1');
			for (const kw of memory.keywords.split(',')) {
				mk(chips, 'span', 'tag-chip badge-colors xs', kw.trim());
			}
		}
	}
}

export function renderMemorySessions(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void { // KN-376 KN-315
	body.classList.add('knox-gui-memory-sessions-view');
	const header = mk(body, 'div', 'kv shrink-0 gap-2');
	const title = mk(header, 'h2', 'flex items-center gap-1_5 sm fw-6');
	svg(title, 'message-square', 14, 'teal');
	title.append(t(state, 'memorySessionHistoryTitle'));
	memoryButton(widget, header, { tokens: 'pill-btn is-quiet btn-secondary', icon: 'refresh-cw', label: t(state, 'memoryRefresh'), onClick: () => void widget.controller.loadMemorySessions() });
	const searchWrap = mk(body, 'div', 'search shrink-0 knox-gui-memory-search');
	svg(searchWrap, 'search', 14, 'search-icon is-session o-40');
	const search = mk(searchWrap, 'input', 'field session-search-input');
	search.type = 'text';
	search.placeholder = t(state, 'memorySessionHistorySearch');
	search.value = state.memorySessionQuery;
	widget.renderStore.add(DOM.addDisposableListener(search, 'input', () => {
		const value = search.value;
		applyMemorySessionFilter(widget, value);
		widget.controller.store.patch({ memorySessionQuery: value, ...(value.trim().length < 2 ? { memoryBacklogMatches: [] } : {}) });
		if (widget.memorySessionSearchTimer) {
			clearTimeout(widget.memorySessionSearchTimer);
		}
		widget.memorySessionSearchTimer = setTimeout(() => {
			widget.memorySessionSearchTimer = undefined;
			void widget.controller.searchMemoryBacklogs(value);
		}, 350);
	}));
	if (state.memorySessionQuery.trim().length >= 2) {
		const cross = mk(body, 'div', 'panel shrink-0');
		cross.setAttribute('data-testid', 'memory-backlog-search');
		const crossHead = mk(cross, 'div', 'panel-head flex items-center gap-2');
		svg(crossHead, state.memoryBacklogSearching ? 'loader-2' : 'search', 12, state.memoryBacklogSearching ? 'spin' : undefined);
		crossHead.append(t(state, 'memorySessionHistoryCrossSearch', { count: state.memoryBacklogMatches.length }));
		const crossBody = mk(cross, 'div', 'cross-body');
		if (!state.memoryBacklogMatches.length && !state.memoryBacklogSearching) {
			mk(crossBody, 'p', 'px-1 py-2 xs o-50', t(state, 'memorySessionHistoryCrossSearchEmpty'));
		} else {
			const matches = mk(crossBody, 'div', 'sy-1_5');
			for (const match of state.memoryBacklogMatches.slice(0, 15)) {
				const row = mk(matches, 'button', 'cross-match');
				row.type = 'button';
				mk(row, 'div', 'fw-5 o-80', `[${match.kind === 'semantic' ? (match.category ?? match.kind) : (match.role ?? match.kind)}]${match.title ? ` ${match.title}` : ''}`);
				mk(row, 'div', 'clamp-2 o-70', match.content);
				if (match.sessionId) {
					mk(row, 'div', 'mt-0_5 t-10 o-50', t(state, 'memorySessionHistoryCrossSearchSession', { id: match.sessionId.slice(0, 8) }));
					widget.renderStore.add(DOM.addDisposableListener(row, 'click', () => void widget.controller.loadMemorySessionHistory(match.sessionId!)));
				}
			}
		}
	}
	if (state.memorySessionError) {
		const error = mk(body, 'div', 'session-error', t(state, state.memorySessionError));
		error.setAttribute('data-testid', 'memory-session-error');
	}
	const layout = mk(body, 'div', 'session-grid');
	const list = mk(layout, 'div', 'panel session-panel');
	const query = state.memorySessionQuery.trim().toLowerCase();
	const sessions = state.memorySessions;
	const listHead = mk(list, 'div', 'panel-head shrink-0', t(state, 'memorySessionHistoryList', { count: sessions.filter(session => memorySessionMatchesQuery(session, query)).length }));
	listHead.setAttribute('data-testid', 'memory-session-count');
	const listBody = mk(list, 'div', 'panel-scroll');
	if (state.memorySessionsLoading) {
		svg(mk(listBody, 'div', 'center py-8'), 'loader-2', 20, 'spin o-50');
	} else if (!sessions.length) {
		mk(listBody, 'p', 'px-3 py-4 xs o-50', t(state, 'memoryNoSessionsYet'));
	}
	for (const session of state.memorySessionsLoading ? [] : sessions) {
		const selected = session.id === state.memorySelectedSessionId;
		const row = mk(listBody, 'button', selected ? 'session-row selected' : 'session-row');
		row.type = 'button';
		row.setAttribute('data-session-id', session.id);
		row.hidden = Boolean(query) && !memorySessionMatchesQuery(session, query);
		svg(row, 'chevron-right', 12, selected ? 'mt-0_5 teal' : 'mt-0_5');
		const main = mk(row, 'div', 'min-w-0 flex-1');
		const titleRow = mk(main, 'div', 'truncate fw-5', session.title || session.id.slice(0, 12));
		if (session.isActive) {
			mk(titleRow, 'span', 'teal-badge ml-1_5 px-1 t-10', t(state, 'memorySessionActive'));
		}
		mk(main, 'div', 'mt-0_5 o-50', `${t(state, 'memoryMsgs', { count: session.messageCount ?? 0 })} · ${formatMemoryDate(session.updatedAt)}`);
		if (session.summary) {
			mk(main, 'div', 'mt-1 clamp-2 o-60', session.summary);
		}
		widget.renderStore.add(DOM.addDisposableListener(row, 'click', () => void widget.controller.loadMemorySessionHistory(session.id)));
	}
	const detailPanel = mk(layout, 'div', 'panel session-panel');
	mk(detailPanel, 'div', 'panel-head shrink-0', state.memorySelectedSessionId ? t(state, 'memorySessionHistoryDetail') : t(state, 'memorySessionHistorySelectPrompt'));
	const detail = mk(detailPanel, 'div', 'panel-scroll p-3');
	const history = state.memorySessionHistory;
	if (!state.memorySelectedSessionId) {
		mk(detail, 'p', 'xs o-50', t(state, 'memorySessionHistorySelectPrompt'));
		return;
	}
	if (state.memorySessionHistoryLoading) {
		const loading = mk(detail, 'div', 'center py-8');
		loading.setAttribute('data-testid', 'memory-session-history-loading');
		svg(loading, 'loader-2', 20, 'spin o-50');
		return;
	}
	if (!history) {
		return;
	}
	const content = mk(detail, 'div', 'sy-4');
	const meta = mk(content, 'div', 'grid-2 gap-2 xs');
	const metaCell = (label: string, value: string) => {
		const cell = mk(meta, 'div', '');
		mk(cell, 'span', 'o-50', label);
		mk(cell, 'div', 'fw-5', value);
	};
	metaCell(t(state, 'memorySessionHistoryMessages'), String(history.messageCount ?? history.episodic.length));
	metaCell(t(state, 'memorySessionHistoryTokens'), (history.tokenEstimate ?? 0).toLocaleString());
	metaCell(t(state, 'memoryEpisodic'), String(history.episodic.length));
	metaCell(t(state, 'memorySemantic'), String(history.semantic.length));
	const detailLabel = (parent: HTMLElement, icon: KnoxGuiSvgIcon, label: string) => {
		const el = mk(parent, 'div', 'mb-1_5 flex items-center gap-1 xs fw-5');
		svg(el, icon, 12);
		el.append(label);
	};
	if (history.topics?.length) {
		const topics = mk(content, 'div', '');
		detailLabel(topics, 'tag', t(state, 'memorySessionHistoryTopics'));
		const chips = mk(topics, 'div', 'flex flex-wrap gap-1');
		for (const topic of history.topics) {
			mk(chips, 'span', 'tag-chip badge-colors t-10', topic);
		}
	}
	if (history.episodic.length) {
		const section = mk(content, 'div', '');
		detailLabel(section, 'file-text', t(state, 'memorySessionHistoryEpisodic'));
		const items = mk(section, 'div', 'sy-1_5');
		for (const item of history.episodic.slice(0, 20)) {
			const row = mk(items, 'div', 'detail-card');
			mk(row, 'div', 'mb-0_5 fw-5 capitalize o-70', item.role ?? '');
			mk(row, 'div', 'clamp-3 o-80', item.content);
		}
		if (history.episodic.length > 20) {
			mk(items, 'p', 't-10 o-50', t(state, 'memorySessionHistoryTruncated', { count: history.episodic.length - 20 }));
		}
	}
	if (history.semantic.length) {
		const section = mk(content, 'div', '');
		detailLabel(section, 'lightbulb', t(state, 'memorySessionHistorySemantic'));
		const items = mk(section, 'div', 'sy-1_5');
		for (const item of history.semantic.slice(0, 10)) {
			const row = mk(items, 'div', 'detail-card');
			mk(row, 'div', 'fw-5', `${item.category ? `[${item.category}] ` : ''}${item.title ?? ''}`);
			mk(row, 'div', 'clamp-2 o-70', item.content);
		}
	}
}

export function renderMemoryGraph(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void { // KN-376 KN-311
	body.classList.add(...memoryClasses('py-4 sy-4').split(' '));
	const stats = state.memoryGraphStats;
	if (stats) {
		const row = mk(body, 'div', 'grid-3 gap-3');
		graphStat(row, stats.maxEntities ? `${stats.totalEntities}/${stats.maxEntities}` : String(stats.totalEntities), t(state, 'memoryEntities'));
		graphStat(row, String(stats.totalEdges), t(state, 'memoryEdges'));
		graphStat(row, String(Object.keys(stats.entityTypes ?? {}).length), t(state, 'memoryEntityTypesCount'));
		if (stats.maxEntities) {
			const meter = mk(body, 'div', 'sy-1');
			const value = meterHead(meter, t(state, 'memoryGraphCapUtilization'), `${((stats.capUtilization ?? 0) * 100).toFixed(1)}%`);
			if (stats.atCap) {
				mk(value, 'span', 'ml-1 text-amber', t(state, 'memoryGraphAtCap'));
			}
			meterBar(meter, Math.min(100, (stats.capUtilization ?? 0) * 100), stats.atCap ? '#f59e0b' : '#159994');
			mk(meter, 'p', 't-10 o-50', t(state, 'memoryGraphSpreadingHint', { depth: stats.maxDepth ?? 3, gamma: stats.depthDecayGamma ?? 0.7 }));
		}
	}
	const filters = mk(body, 'div', 'flex gap-2');
	const searchWrap = mk(filters, 'div', 'search flex-1 knox-gui-memory-search');
	const search = mk(searchWrap, 'input', 'field graph-search-input');
	search.type = 'text';
	search.placeholder = t(state, 'memorySearchEntities');
	search.value = state.memoryGraphQuery;
	svg(searchWrap, 'search', 14, 'search-icon o-50');
	widget.renderStore.add(DOM.addDisposableListener(search, 'input', () => {
		widget.controller.store.patch({ memoryGraphQuery: search.value });
		applyMemoryGraphFilter(widget, widget.controller.store.state);
		if (widget.memoryGraphSearchTimer) {
			clearTimeout(widget.memoryGraphSearchTimer);
		}
		widget.memoryGraphSearchTimer = setTimeout(() => {
			widget.memoryGraphSearchTimer = undefined;
			void widget.controller.loadMemoryGraph(false);
		}, 300);
	}));
	const typeCounts = memoryGraphTypeCounts(stats?.entityTypes, state.memoryGraphEntities);
	const typeSelect = mk(filters, 'select', 'dropdown xs');
	typeSelect.setAttribute('data-testid', 'memory-graph-type');
	for (const [value, label] of [['all', t(state, 'memoryAllTypes')] as const, ...typeCounts.map(([type, count]) => [type, `${type} (${count})`] as const)]) {
		const option = mk(typeSelect, 'option', '', label);
		option.value = value;
		option.selected = value === state.memoryGraphFilterType;
	}
	widget.renderStore.add(DOM.addDisposableListener(typeSelect, 'change', () => {
		widget.controller.store.patch({ memoryGraphFilterType: typeSelect.value });
		void widget.controller.loadMemoryGraph(false);
	}));
	if (state.memoryExplore) {
		const explore = state.memoryExplore;
		const panel = mk(body, 'div', 'explore-panel');
		const head = mk(panel, 'div', 'kv mb-2');
		const title = mk(head, 'h3', 'flex items-center gap-2 sm fw-6');
		svg(title, 'compass', 14);
		const centerName = explore.centerName ?? explore.entities.find(entity => entity.id === explore.centerId)?.name ?? '';
		title.append(`${t(state, 'memoryExploring')}: ${centerName}`);
		if (explore.depthReached != null) {
			mk(title, 'span', 'xs o-50', `(${t(state, 'memoryGraphDepth', { count: explore.depthReached })})`);
		}
		const close = memoryButton(widget, head, { tokens: 'explore-close xs o-60', icon: 'x', onClick: () => widget.controller.store.patch({ memoryExplore: undefined }) });
		close.append(` ${t(state, 'memoryClose')}`);
		if (explore.centerDescription) {
			mk(panel, 'p', 'mb-2 xs o-70', explore.centerDescription);
		}
		const edges = visibleMemoryExploreEdges(explore);
		if (!edges.length) {
			mk(panel, 'div', 'xs o-50', t(state, 'memoryGraphNoRelationships'));
		} else {
			const depths = explore.entityDepths;
			const edgeList = mk(panel, 'div', 'explore-edges sy-1');
			for (const edge of edges) {
				const from = explore.entities.find(entity => entity.id === edge.source);
				const to = explore.entities.find(entity => entity.id === edge.target);
				const row = mk(edgeList, 'div', 'flex flex-wrap items-center gap-1_5');
				row.setAttribute('data-testid', 'memory-explore-edge');
				const hop = memoryExploreEdgeDepth(edge, depths);
				const depth = mk(row, 'span', 'edge-depth t-10 o-40', hop === Number.MAX_SAFE_INTEGER ? '' : `d${hop}`);
				if (hop !== Number.MAX_SAFE_INTEGER) {
					depth.setAttribute('data-testid', 'knox-gui-memory-graph-depth');
				}
				entityChip(widget, row, from?.name ?? String(edge.source), from?.entityType, from?.id === explore.centerId, () => void widget.controller.exploreMemoryEntity(edge.source), from?.description ?? from?.entityType);
				mk(row, 'span', 'xs italic o-60', edge.relationship);
				svg(row, 'arrow-right', 10, 'o-40');
				entityChip(widget, row, to?.name ?? String(edge.target), to?.entityType, to?.id === explore.centerId, () => void widget.controller.exploreMemoryEntity(edge.target), to?.description ?? to?.entityType);
			}
		}
		mk(panel, 'div', 'mt-2 xs o-50', `${Math.max(0, explore.entities.length - 1)} ${t(state, 'memoryConnectedEntities')} · ${edges.length} ${t(state, 'memoryRelationships')}`);
	}
	if (typeCounts.length) {
		const legend = mk(body, 'div', 'flex flex-wrap gap-2');
		for (const [type, count] of typeCounts) {
			const color = graphEntityColor(type);
			const active = state.memoryGraphFilterType === type;
			const chip = mk(legend, 'button', 'type-chip');
			chip.type = 'button';
			chip.style.color = color;
			chip.style.border = `1px solid ${active ? color : `${color}30`}`;
			chip.style.backgroundColor = active ? `${color}40` : `${color}15`;
			mk(chip, 'span', 'dot-2').style.backgroundColor = color;
			chip.append(type);
			mk(chip, 'span', 'o-60', `(${count})`);
			widget.renderStore.add(DOM.addDisposableListener(chip, 'click', () => {
				widget.controller.store.patch({ memoryGraphFilterType: active ? 'all' : type });
				void widget.controller.loadMemoryGraph(false);
			}));
		}
	}
	const entities = state.memoryGraphEntities;
	if (state.memoryGraphLoading) {
		const loading = mk(body, 'div', 'py-8 text-center');
		loading.setAttribute('data-testid', 'memory-graph-loading');
		spinner(loading, 24).classList.add('knox-gui-memory-mx-auto');
		return;
	}
	if (state.memoryGraphError) {
		const error = mk(body, 'div', 'sy-2 py-8 text-center sm');
		error.setAttribute('data-testid', 'memory-graph-error');
		mk(error, 'div', 'o-70', `${t(state, 'memoryGraphLoadFailed')}: ${state.memoryGraphError}`);
		memoryButton(widget, error, { tokens: 'retry btn-secondary', label: t(state, 'memoryRetry'), onClick: () => void widget.controller.loadMemoryGraph(false) });
		return;
	}
	if (!entities.length) {
		mk(body, 'div', 'py-8 text-center sm o-50', state.memoryGraphQuery.trim() || state.memoryGraphFilterType !== 'all' ? t(state, 'memoryNoEntitiesFound') : t(state, 'memoryNoEntitiesYet'));
		return;
	}
	const list = mk(body, 'div', 'sy-2');
	const shown = mk(list, 'div', 'xs o-50', t(state, 'memoryGraphShowingEntities', { shown: entities.length, total: state.memoryGraphTotal || entities.length }));
	shown.setAttribute('data-graph-shown-count', '1');
	for (const entity of entities) {
		const color = graphEntityColor(entity.entityType);
		const row = mk(list, 'div', 'entity-row');
		row.setAttribute('data-entity-id', String(entity.id));
		const avatar = mk(row, 'div', 'entity-avatar', (entity.entityType?.[0] ?? '?').toUpperCase());
		avatar.style.backgroundColor = `${color}20`;
		avatar.style.color = color;
		const main = mk(row, 'div', 'min-w-0 flex-1');
		const title = mk(main, 'div', 'flex items-center gap-2');
		mk(title, 'span', 'truncate sm fw-5', entity.name);
		const type = mk(title, 'span', 'row-badge shrink-0', entity.entityType);
		type.style.backgroundColor = `${color}15`;
		type.style.color = color;
		if (entity.description) {
			mk(main, 'p', 'mt-0_5 truncate xs o-60', entity.description);
		}
		const meta = mk(main, 'div', 'mt-0_5 flex items-center gap-3 xs o-40');
		mk(meta, 'span', '', `${t(state, 'memoryEntityMentions')}: ${entity.mentionCount}`);
		if (entity.edgeCount != null) {
			mk(meta, 'span', '', `${t(state, 'memoryGraphEntityEdges')}: ${entity.edgeCount}`);
		}
		const exploring = widget.memoryExploringId === entity.id;
		memoryButton(widget, row, {
			tokens: 'pill-btn shrink-0 btn-secondary',
			icon: 'compass',
			spinning: exploring,
			label: t(state, 'memoryExplore'),
			disabled: exploring,
			onClick: () => {
				widget.memoryExploringId = entity.id;
				widget.controller.store.patch({});
				void widget.controller.exploreMemoryEntity(entity.id).finally(() => {
					widget.memoryExploringId = null;
					widget.controller.store.patch({});
				});
			},
		});
	}
	if (state.memoryGraphHasMore) {
		memoryButton(widget, list, {
			tokens: 'graph-more btn-secondary',
			spinning: state.memoryGraphLoadingMore,
			label: t(state, 'memoryLoadMore'),
			disabled: state.memoryGraphLoadingMore,
			testId: 'memory-graph-load-more',
			onClick: () => void widget.controller.loadMemoryGraph(true),
		});
	}
}

export function renderMemorySettings(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void { // KN-376 KN-314
	const config = state.memoryConfig;
	if (state.memoryConfigLoading && !Object.keys(config).length) {
		const loading = mk(body, 'div', 'center py-12');
		loading.setAttribute('data-testid', 'memory-settings-loading');
		spinner(loading, 24);
		return;
	}
	body.classList.add(...memoryClasses('py-4 sy-4').split(' '));
	renderMemorySettingsConfirm(widget, body, state);
	const result = state.memorySettingsResult;
	if (result) {
		const toast = mk(body, 'div', `banner is-${result.type} settings-result`);
		toast.setAttribute('data-testid', 'memory-settings-result');
		svg(toast, result.type === 'success' ? 'check' : 'x', 14);
		mk(toast, 'span', 'flex-1', result.message);
		memoryButton(widget, toast, { tokens: 'banner-close', icon: 'x', ariaLabel: t(state, 'close'), onClick: () => widget.controller.store.patch({ memorySettingsResult: undefined }) });
	}
	for (const group of MEMORY_SETTING_GROUPS) {
		const icon = (MEMORY_SETTING_GROUP_ICONS[group.titleKey] as KnoxGuiSvgIcon) || 'settings';
		const open = !group.collapsed || widget.memorySettingsOpen.has(group.titleKey);
		const content = group.collapsed
			? collapsibleSettingsSection(widget, body, t(state, group.titleKey), icon, open, () => {
				if (widget.memorySettingsOpen.has(group.titleKey)) {
					widget.memorySettingsOpen.delete(group.titleKey);
				} else {
					widget.memorySettingsOpen.add(group.titleKey);
				}
				widget.render();
			})
			: settingsSection(body, t(state, group.titleKey), icon);
		if (!content) {
			continue;
		}
		if (group.descKey) {
			mk(content, 'p', 'xs o-50', t(state, group.descKey));
		}
		let lastSection: string | undefined;
		for (const field of group.fields) {
			if (field.sectionKey && field.sectionKey !== lastSection) {
				mk(content, 'p', lastSection ? 'pt-2 xs fw-5 o-70' : 'xs fw-5 o-70', t(state, field.sectionKey));
				lastSection = field.sectionKey;
			}
			renderMemorySettingRow(widget, content, state, field);
		}
	}
	const busy = state.memorySettingsAction;
	const maintenance = settingsSection(body, t(state, 'memoryMaintenanceActions'), 'wrench');
	const actions = mk(maintenance, 'div', 'grid-2 gap-2');
	const file = DOM.$('input.knox-gui-hidden-file') as HTMLInputElement;
	const actionButton = (id: string, icon: KnoxGuiSvgIcon, labelKey: string, testId: string, onClick: () => void) => memoryButton(widget, actions, {
		tokens: 'action-btn btn-secondary',
		icon,
		iconSize: 14,
		spinning: busy === id,
		label: t(state, labelKey),
		testId,
		disabled: busy === id,
		onClick,
	});
	actionButton('optimize', 'zap', 'memoryOptimizeDb', 'knox-gui-memory-optimize', () => void widget.controller.runMemoryMaintenance('optimize'));
	actionButton('consolidate', 'refresh-cw', 'memoryConsolidateNow', 'knox-gui-memory-consolidate-now', () => {
		widget.memorySettingsConfirm = { action: 'consolidate', label: t(state, 'memoryConsolidateNow'), description: t(state, 'memoryConsolidateWarning') };
		widget.render();
	});
	actionButton('export', 'file-down', 'memoryExportData', 'knox-gui-memory-export', () => {
		void widget.controller.exportMemory(widget.memoryExportPassword).then(ok => {
			if (ok) {
				widget.memoryExportPassword = '';
				widget.render();
			}
		});
	});
	actionButton('import', 'upload', 'memoryImportData', 'knox-gui-memory-import', () => file.click());
	actionButton('heal', 'heart-pulse', 'memoryHealSystem', 'knox-gui-memory-heal', () => void widget.controller.runMemoryMaintenance('heal'));
	const passwords = mk(maintenance, 'div', 'password-grid');
	const passwordField = (labelKey: string, placeholderKey: string, testId: string, value: string, onInput: (value: string) => void) => {
		const label = mk(passwords, 'label', 'block xs o-70', t(state, labelKey));
		const input = mk(label, 'input', 'field password-input');
		input.type = 'password';
		input.value = value;
		input.placeholder = t(state, placeholderKey);
		input.setAttribute('data-testid', testId);
		widget.renderStore.add(DOM.addDisposableListener(input, 'input', () => onInput(input.value)));
	};
	passwordField('memoryExportPasswordOptional', 'memoryExportPasswordPlaceholder', 'memory-export-password', widget.memoryExportPassword, value => { widget.memoryExportPassword = value; });
	passwordField('memoryImportPasswordOptional', 'memoryImportPasswordPlaceholder', 'memory-import-password', widget.memoryImportPassword, value => { widget.memoryImportPassword = value; });
	mk(maintenance, 'p', 'xs o-50', t(state, 'memoryBackupLocalOnly'));
	maintenance.appendChild(file);
	file.type = 'file';
	file.accept = '.json,application/json';
	widget.renderStore.add(DOM.addDisposableListener(file, 'change', () => {
		const picked = file.files?.[0];
		file.value = '';
		if (picked) {
			void importMemoryFile(widget, picked);
		}
	}));
	const danger = settingsSection(body, t(state, 'memoryDangerZone'), 'alert-triangle');
	mk(danger, 'p', 'mb-3 xs o-60', t(state, 'memoryDangerZoneDesc'));
	memoryButton(widget, danger, {
		tokens: 'action-btn is-danger',
		icon: 'trash-2',
		iconSize: 14,
		spinning: busy === 'purge',
		label: t(state, 'memoryPurgeExpired'),
		testId: 'knox-gui-memory-purge',
		disabled: busy === 'purge',
		onClick: () => {
			widget.memorySettingsConfirm = { action: 'purge', label: t(state, 'memoryPurgeExpired'), description: t(state, 'memoryPurgeWarning') };
			widget.render();
		},
	});
}

/** `SettingsSection`: card with an `h3` title; returns the `space-y-3` body. */
function settingsSection(parent: HTMLElement, title: string, icon: KnoxGuiSvgIcon): HTMLElement {
	const card = mk(parent, 'div', 'card');
	const heading = mk(card, 'h3', 'card-title mb-3');
	svg(heading, icon, 14);
	heading.append(title);
	return mk(card, 'div', 'sy-3');
}

/** `CollapsibleSettingsSection`: returns the `mt-3 space-y-3` body, or `undefined` while collapsed. */
function collapsibleSettingsSection(widget: KnoxGuiWidget, parent: HTMLElement, title: string, icon: KnoxGuiSvgIcon, open: boolean, onToggle: () => void): HTMLElement | undefined {
	const card = mk(parent, 'div', 'card');
	const toggle = mk(card, 'button', 'collapse-head');
	toggle.type = 'button';
	toggle.setAttribute('aria-expanded', String(open));
	const label = mk(toggle, 'span', 'flex items-center gap-1_5');
	svg(label, icon, 14);
	label.append(title);
	svg(toggle, open ? 'chevron-down' : 'chevron-right', 14);
	widget.renderStore.add(DOM.addDisposableListener(toggle, 'click', onToggle));
	return open ? mk(card, 'div', 'mt-3 sy-3') : undefined;
}

/** `ToggleSetting` / `NumberSetting` / `DecimalSetting` / `FloatSetting` / `TextSetting` / `SelectSetting`. */
function renderMemorySettingRow(widget: KnoxGuiWidget, card: HTMLElement, state: IKnoxGuiState, field: IKnoxGuiMemorySettingField): void {
	const config = state.memoryConfig;
	const row = mk(card, 'div', field.kind === 'toggle' ? 'setting-row' : 'setting-row gap-3');
	row.setAttribute('data-setting', field.key);
	const text = mk(row, 'div', 'flex-1');
	const title = mk(text, 'div', 'flex items-center gap-2 sm');
	const inputId = `knox-memory-setting-${field.key}`;
	mk(title, 'label', 'setting-label', t(state, field.labelKey)).htmlFor = inputId;
	if (state.memorySavedKey === field.key) {
		const saved = svg(title, 'check', 12, 'saved');
		saved.setAttribute('data-testid', 'memory-setting-saved');
	}
	mk(text, 'div', 'xs o-50', field.descKey ? t(state, field.descKey) : '');
	const commitOnBlurOrEnter = (input: HTMLInputElement, commit: () => void) => {
		widget.renderStore.add(DOM.addDisposableListener(input, 'blur', commit));
		widget.renderStore.add(DOM.addDisposableListener(input, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.isComposing) {
				commit();
			}
		}));
	};
	if (field.kind === 'toggle') {
		const isOn = config[field.key] !== false && config[field.key] !== 'false';
		const toggle = mk(row, 'button', isOn ? 'toggle is-on' : 'toggle');
		toggle.type = 'button';
		toggle.id = inputId;
		toggle.setAttribute('role', 'switch');
		toggle.setAttribute('aria-checked', String(isOn));
		mk(toggle, 'span', 'toggle-knob');
		widget.renderStore.add(DOM.addDisposableListener(toggle, 'click', () => widget.controller.updateMemoryConfig(field.key, !isOn)));
	} else if (field.kind === 'text') {
		const input = mk(row, 'input', 'field setting-input w-48');
		input.id = inputId;
		input.type = 'text';
		const current = String(config[field.key] ?? '');
		input.value = current;
		commitOnBlurOrEnter(input, () => {
			if (input.value !== current) {
				widget.controller.updateMemoryConfig(field.key, input.value);
			}
		});
	} else if (field.kind === 'number') {
		const raw = Number(config[field.key] ?? field.min ?? 0);
		const shown = field.percent ? String(Math.round(raw * 100)) : String(raw);
		const control = field.float ? row : mk(row, 'div', 'flex items-center gap-1');
		const input = mk(control, 'input', field.float ? 'field setting-input text-right w-24' : 'field setting-input text-right w-20');
		input.id = inputId;
		input.type = 'number';
		input.value = shown;
		if (field.percent) {
			input.min = String(Math.round((field.min ?? 0) * 100));
			input.max = String(Math.round((field.max ?? 1) * 100));
		} else {
			if (field.min != null) {
				input.min = String(field.min);
			}
			if (field.max != null) {
				input.max = String(field.max);
			}
			if (field.step != null) {
				input.step = String(field.step);
			}
		}
		commitOnBlurOrEnter(input, () => {
			const parsed = parseMemorySettingInput(field, input.value);
			if (parsed === undefined) {
				input.value = shown;
			} else if (parsed !== raw) {
				widget.controller.updateMemoryConfig(field.key, parsed);
			}
		});
		const suffix = field.percent ? '%' : field.suffixKey ? t(state, field.suffixKey) : undefined;
		if (suffix && !field.float) {
			mk(control, 'span', 'xs o-50', suffix);
		}
	} else if (field.kind === 'select' && field.options) {
		const select = mk(row, 'select', 'field setting-input');
		select.id = inputId;
		for (const option of field.options) {
			const el = mk(select, 'option', '', t(state, option.labelKey));
			el.value = option.value;
			if (String(config[field.key] ?? '') === option.value) {
				el.selected = true;
			}
		}
		widget.renderStore.add(DOM.addDisposableListener(select, 'change', () => widget.controller.updateMemoryConfig(field.key, select.value)));
	}
}

/** Confirmation dialog shared by `MemorySettings.tsx` and `MemoryBrowser.tsx`. */
function memoryConfirmDialog(widget: KnoxGuiWidget, body: HTMLElement, options: {
	title: string;
	lines: Array<{ text: string; tokens: string }>;
	cancelLabel: string;
	confirmLabel: string;
	busy?: boolean;
	testId?: string;
	confirmTestId: string;
	onCancel: () => void;
	onConfirm: () => void;
}): HTMLElement {
	const overlay = mk(modalHost(body), 'div', 'modal');
	overlay.setAttribute('role', 'dialog');
	if (options.testId) {
		overlay.setAttribute('data-testid', options.testId);
	}
	const dialog = mk(overlay, 'div', 'dialog');
	const head = mk(dialog, 'div', 'mb-3 flex items-center gap-2');
	svg(head, 'alert-triangle', 16, 'text-amber');
	mk(head, 'h3', 'sm fw-6', options.title);
	for (const line of options.lines) {
		mk(dialog, 'p', line.tokens, line.text);
	}
	const actions = mk(dialog, 'div', 'flex justify-end gap-2');
	memoryButton(widget, actions, { tokens: 'dialog-btn is-cancel', label: options.cancelLabel, disabled: options.busy, onClick: options.onCancel });
	memoryButton(widget, actions, { tokens: 'dialog-btn is-confirm', label: options.confirmLabel, disabled: options.busy, testId: options.confirmTestId, onClick: options.onConfirm });
	return overlay;
}

function renderMemorySettingsConfirm(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	const confirm = widget.memorySettingsConfirm;
	if (!confirm) {
		return;
	}
	const close = () => {
		widget.memorySettingsConfirm = null;
		widget.render();
	};
	const overlay = memoryConfirmDialog(widget, body, {
		title: t(state, 'memoryConfirmAction'),
		lines: [{ text: confirm.description, tokens: 'mb-4 xs o-70' }],
		cancelLabel: t(state, 'memoryCancel'),
		confirmLabel: confirm.label,
		testId: 'memory-settings-confirm',
		confirmTestId: 'memory-settings-confirm-run',
		onCancel: close,
		onConfirm: () => {
			widget.memorySettingsConfirm = null;
			void widget.controller.runMemoryMaintenance(confirm.action);
			widget.render();
		},
	});
	widget.renderStore.add(DOM.addDisposableListener(overlay, 'mousedown', (e: MouseEvent) => {
		if (e.target === overlay) {
			close();
		}
	}));
}

async function importMemoryFile(widget: KnoxGuiWidget, file: File): Promise<void> {
	try {
		if (await widget.controller.importMemoryData(await file.text(), widget.memoryImportPassword)) {
			widget.memoryImportPassword = '';
			widget.render();
		}
	} catch {
		// optional
	}
}

function renderMemoryDeleteDialog(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	if (!widget.memoryConfirmDeleteIds) {
		return;
	}
	const busy = state.memoryBrowserBusy;
	const close = () => {
		if (!busy) {
			widget.memoryConfirmDeleteIds = null;
			widget.render();
		}
	};
	const overlay = memoryConfirmDialog(widget, body, {
		title: t(state, 'memoryConfirmDelete'),
		lines: [
			{ text: widget.memoryConfirmDeleteBulk ? t(state, 'memoryConfirmBulkDelete', { count: widget.memoryConfirmDeleteIds.length }) : t(state, 'memoryConfirmDeleteSingle'), tokens: 'mb-2 xs o-70' },
			{ text: t(state, 'cannotBeUndone'), tokens: 'mb-4 xs o-50' },
		],
		cancelLabel: t(state, 'cancel'),
		confirmLabel: t(state, 'deleteAction'),
		busy,
		confirmTestId: 'memory-confirm-delete',
		onCancel: close,
		onConfirm: () => {
			const ids = widget.memoryConfirmDeleteIds ?? [];
			const bulk = widget.memoryConfirmDeleteBulk;
			void widget.controller.deleteMemories(ids, bulk).then(() => {
				widget.memoryConfirmDeleteIds = null;
				widget.memoryConfirmDeleteBulk = false;
				if (bulk) {
					widget.memorySelectedIds.clear();
					widget.memoryLastClickedId = null;
					widget.memorySelectionMode = false;
				} else {
					widget.memorySelectedIds.delete(ids[0]);
				}
				widget.render();
			});
		},
	});
	widget.renderStore.add(DOM.addDisposableListener(overlay, 'click', e => {
		if (e.target === overlay) {
			close();
		}
	}));
}

/** `MemoryOverview.tsx` `SectionCard`: children go straight into the card after the `mb-2` title. */
function sectionCard(parent: HTMLElement, title: string, icon: KnoxGuiSvgIcon): HTMLElement {
	const card = mk(parent, 'div', 'card');
	const heading = mk(card, 'h3', 'card-title mb-2');
	svg(heading, icon, 14);
	heading.append(title);
	return card;
}

function statCard(parent: HTMLElement, icon: KnoxGuiSvgIcon, label: string, value: string | number): void {
	const cell = mk(parent, 'div', 'stat-card');
	svg(mk(cell, 'span', 'stat-icon'), icon, 20);
	mk(cell, 'span', 'lg fw-7 teal', typeof value === 'number' ? value.toLocaleString() : value);
	mk(cell, 'span', 'xs o-60', label);
}

function metricCell(parent: HTMLElement, value: string, label: string): void {
	const el = mk(parent, 'div', '');
	mk(el, 'div', 'lg fw-7 teal', value);
	mk(el, 'div', 'o-60', label);
}

function graphStat(parent: HTMLElement, value: string, label: string): void {
	const el = mk(parent, 'div', 'graph-stat');
	mk(el, 'div', 'lg fw-7 teal', value);
	mk(el, 'div', 'xs o-60', label);
}

function trendCell(parent: HTMLElement, value: string | undefined, label: string, detail?: string): void {
	if (!value) {
		return;
	}
	const el = mk(parent, 'div', '');
	mk(el, 'div', 'lg fw-7 capitalize', value).style.color = MEMORY_TREND_COLORS[value] ?? '#6b7280';
	mk(el, 'div', 'o-60', label);
	if (detail) {
		mk(el, 'div', 'mt-0_5 o-50', detail);
	}
}

/** Meter caption row (`text-xs opacity-70`); returns the value span so callers can append an at-cap marker. */
function meterHead(parent: HTMLElement, label: string, value: string): HTMLElement {
	const head = mk(parent, 'div', 'kv xs o-70');
	mk(head, 'span', '', label);
	return mk(head, 'span', '', value);
}

function meterBar(parent: HTMLElement, pct: number, color: string): void {
	const track = mk(parent, 'div', 'meter');
	const fill = mk(track, 'div', 'meter-fill');
	fill.style.width = `${pct}%`;
	fill.style.backgroundColor = color;
}

function entityChip(widget: KnoxGuiWidget, parent: HTMLElement, name: string, type: string | undefined, isCenter: boolean, onClick: () => void, title?: string): void {
	const color = graphEntityColor(type);
	const chip = mk(parent, 'button', isCenter ? 'entity-chip fw-7' : 'entity-chip', name);
	chip.type = 'button';
	if (title) {
		chip.title = title;
	}
	if (isCenter) {
		chip.style.backgroundColor = color;
		chip.style.color = '#fff';
	} else {
		chip.style.backgroundColor = `${color}30`;
		chip.style.color = color;
		chip.style.border = `1px solid ${color}50`;
		widget.renderStore.add(DOM.addDisposableListener(chip, 'click', onClick));
	}
}

export function syncMemoryFilters(widget: KnoxGuiWidget, state: IKnoxGuiState): void {
	applyMemoryBrowserFilter(widget, state);
	applyMemorySessionFilter(widget, state.memorySessionQuery);
	applyMemoryGraphFilter(widget, state);
}

function memorySessionMatchesQuery(session: IKnoxGuiState['memorySessions'][number], query: string): boolean {
	if (!query) {
		return true;
	}
	return session.title.toLowerCase().includes(query) || session.id.toLowerCase().includes(query) || (session.summary ?? '').toLowerCase().includes(query);
}

function applyMemoryBrowserFilter(widget: KnoxGuiWidget, state: IKnoxGuiState): void {
	const pane = widget.root.querySelector('[data-testid="knox-gui-memory-browser"]') as HTMLElement | null;
	if (!pane) {
		return;
	}
	const matched = new Set(filterAndSortMemories(state.memories, {
		category: state.memoryFilterCategory,
		tier: state.memoryFilterTier,
		pinned: state.memoryFilterPinned,
		sortBy: state.memorySortBy,
		query: widget.memorySearchDraft || state.memoryQuery,
	}).map(memory => memory.id));
	for (const row of pane.querySelectorAll<HTMLElement>('[data-memory-id]')) {
		const id = row.getAttribute('data-memory-id');
		row.hidden = !(id && matched.has(id));
	}
	for (const group of pane.querySelectorAll<HTMLElement>('.knox-gui-memory-date-group')) {
		const visible = group.querySelectorAll('[data-memory-id]:not([hidden])').length;
		group.hidden = visible === 0;
		const count = group.querySelector('[data-memory-group-count]');
		if (count) {
			count.textContent = t(state, 'itemsCount', { count: visible });
		}
	}
	const found = pane.querySelector('[data-memory-found-count]');
	if (found) {
		found.textContent = `${matched.size} ${t(state, 'memoryMemoriesFound')}`;
	}
	const empty = pane.querySelector<HTMLElement>('[data-memory-empty]');
	if (empty) {
		empty.hidden = matched.size > 0;
		empty.textContent = t(state, memoryBrowserEmptyKey(widget.memorySearchDraft || state.memoryQuery, state.memoryFilterPinned, state.memoryFilterTier));
	}
	const clear = pane.querySelector<HTMLElement>('.knox-gui-memory-search-clear');
	if (clear) {
		clear.hidden = !(widget.memorySearchDraft || state.memoryQuery);
	}
}

function applyMemorySessionFilter(widget: KnoxGuiWidget, query: string): void {
	const pane = widget.root.querySelector('[data-testid="knox-gui-memory-sessions"]') as HTMLElement | null;
	if (!pane) {
		return;
	}
	const q = query.trim().toLowerCase();
	const state = widget.controller.store.state;
	let visible = 0;
	for (const row of pane.querySelectorAll<HTMLElement>('[data-session-id]')) {
		const id = row.getAttribute('data-session-id');
		const session = state.memorySessions.find(item => item.id === id);
		const show = !session || memorySessionMatchesQuery(session, q);
		row.hidden = !show;
		if (show) {
			visible += 1;
		}
	}
	const head = pane.querySelector('[data-testid="memory-session-count"]');
	if (head) {
		head.textContent = t(state, 'memorySessionHistoryList', { count: visible });
	}
}

function memoryGraphEntityMatchesQuery(entity: IKnoxGuiState['memoryGraphEntities'][number], query: string): boolean {
	const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (!tokens.length) {
		return true;
	}
	const haystack = [entity.name, entity.entityType, entity.description].filter(Boolean).join(' ').toLowerCase();
	return tokens.every(token => haystack.includes(token));
}

function applyMemoryGraphFilter(widget: KnoxGuiWidget, state: IKnoxGuiState): void {
	const pane = widget.root.querySelector('[data-testid="knox-gui-memory-graph"]') as HTMLElement | null;
	if (!pane) {
		return;
	}
	let visible = 0;
	for (const row of pane.querySelectorAll<HTMLElement>('[data-entity-id]')) {
		const id = Number(row.getAttribute('data-entity-id'));
		const entity = state.memoryGraphEntities.find(item => item.id === id);
		const show = !entity || memoryGraphEntityMatchesQuery(entity, state.memoryGraphQuery);
		row.hidden = !show;
		if (show) {
			visible += 1;
		}
	}
	const shown = pane.querySelector('[data-graph-shown-count]');
	if (shown) {
		shown.textContent = t(state, 'memoryGraphShowingEntities', { shown: visible, total: state.memoryGraphTotal || state.memoryGraphEntities.length });
	}
}
