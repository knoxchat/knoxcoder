/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Overview tab: health banner, stats, spaced repetition, cycle phases, context, graph channel, trends, tiers, categories and sessions. */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import { KnoxGuiSvgIcon } from '../../knoxGuiIcons.js';
import {
	dashboardHealthGrade,
	formatHealthScore,
	formatBytes,
	formatMemoryTimeAgo,
	healthStatusColor,
	MEMORY_CATEGORY_ICONS,
	MEMORY_CYCLE_PHASES,
	MEMORY_EFFECTIVE_TIERS,
	MEMORY_SLEEP_PHASE_LABELS,
	MEMORY_TIER_COLORS,
	formatAnswerableHorizon,
	formatTheoremError,
	formatInjectedLastTurn,
	memoryHeadlineMetrics,
} from '../../../../common/knoxGuiMemory.js';
import { IKnoxGuiEffectiveContext, IKnoxGuiState } from '../../../../common/knoxGuiState.js';
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

type MemoryLevel = IKnoxGuiEffectiveContext['levels'][number];

function levelIsStore(level: MemoryLevel): boolean {
	if (level.inCAddr === true || level.role === 'store') {
		return true;
	}
	if (level.inCAddr === false || level.role === 'buffer') {
		return false;
	}
	return /^M[345]($|[^0-9])/i.test(level.id);
}

function levelLifetimeLabel(state: IKnoxGuiState, lifetime: MemoryLevel['lifetime']): string | undefined {
	switch (lifetime) {
		case 'turn': return t(state, 'memoryLifetimeTurn');
		case 'call': return t(state, 'memoryLifetimeCall');
		case 'session': return t(state, 'memoryLifetimeSession');
		case 'stored': return t(state, 'memoryLifetimeStored');
		default: return undefined;
	}
}

function tokenCountLabel(state: IKnoxGuiState, tokens: number): string {
	return t(state, 'memoryTokenCount', { count: tokens.toLocaleString() });
}

function sharePct(tokens: number, maxTokens: number): number {
	if (maxTokens <= 0 || tokens <= 0) {
		return 0;
	}
	return Math.min(100, Math.max(2.5, (tokens / maxTokens) * 100));
}

function boundColor(pct: number): string {
	if (pct >= 100) {
		return '#ef4444';
	}
	if (pct >= 85) {
		return '#f59e0b';
	}
	return '#159994';
}

function renderAddrChip(parent: HTMLElement, label: string, value: string): void {
	const chip = mk(parent, 'div', 'addr-chip');
	mk(chip, 'span', 'addr-chip-label', label);
	mk(chip, 'span', 'addr-chip-value', value);
}

function renderLevelRow(parent: HTMLElement, state: IKnoxGuiState, level: MemoryLevel, options: {
	maxTokens: number;
	store: boolean;
	budget?: number;
}): void {
	const row = mk(parent, 'div', options.store ? 'addr-level' : 'addr-level is-buffer');
	const head = mk(row, 'div', 'kv xs');
	const left = mk(head, 'div', 'flex items-center gap-1_5 min-w-0');
	mk(left, 'span', options.store ? 'addr-id' : 'addr-id is-buffer', level.id);
	mk(left, 'span', 'truncate', level.name);
	const lifetime = levelLifetimeLabel(state, level.lifetime);
	if (lifetime) {
		mk(left, 'span', 'addr-life', lifetime);
	}
	mk(head, 'span', 'shrink-0 mono xs', tokenCountLabel(state, level.tokens));
	if (options.store) {
		meterBar(row, sharePct(level.tokens, options.maxTokens), '#159994');
	}
	if (!options.store && (options.budget ?? 0) > 0) {
		const budget = options.budget ?? 0;
		const cap = mk(row, 'div', 'mt-1');
		meterHead(cap, t(state, 'memoryWorkingMemoryBudget'), t(state, 'memoryContextUseOfWindow', {
			use: level.tokens.toLocaleString(),
			w: budget.toLocaleString(),
		}));
		meterBar(cap, Math.min(100, (level.tokens / budget) * 100), '#64748b');
	}
}

function renderLevelGroup(parent: HTMLElement, state: IKnoxGuiState, options: {
	titleKey: string;
	testId: string;
	levels: MemoryLevel[];
	store: boolean;
	budget?: number;
}): void {
	if (!options.levels.length) {
		return;
	}
	const group = mk(parent, 'div', 'addr-group sy-1_5');
	group.setAttribute('data-testid', options.testId);
	const head = mk(group, 'div', 'kv xs fw-5 o-70');
	mk(head, 'span', '', t(state, options.titleKey));
	const total = options.levels.reduce((sum, level) => sum + level.tokens, 0);
	mk(head, 'span', 'mono fw-5', tokenCountLabel(state, total));
	const maxTokens = options.levels.reduce((max, level) => Math.max(max, level.tokens), 0);
	for (const level of options.levels) {
		renderLevelRow(group, state, level, {
			maxTokens,
			store: options.store,
			budget: level.id === 'M2' ? options.budget : undefined,
		});
	}
}

/** MEM-10 / MEM-41 / MEM-42: C_addr hero, C_use bound by W, Rec / H_0.85 / sigma / eps_* chips when published. */
function renderAddressableHeadline(body: HTMLElement, state: IKnoxGuiState): void {
	const ctx = state.memoryEffectiveContext;
	if (!ctx) {
		return;
	}
	const headline = memoryHeadlineMetrics(ctx);
	const card = sectionCard(body, t(state, 'memoryEffectiveContext'), 'layers');
	card.setAttribute('data-testid', 'memory-addressable-headline');
	mk(card, 'p', 'mb-2 xs o-60', t(state, 'memoryAddressableDesc'));

	const top = mk(card, 'div', 'addr-top');
	const stored = mk(top, 'div', 'addr-hero');
	mk(stored, 'div', 'addr-kicker', t(state, 'memoryAddressable'));
	mk(stored, 'div', 'addr-value', headline.cAddr.toLocaleString());
	mk(stored, 'div', 'addr-caption', t(state, 'memoryAddressableStoredCaption'));

	const use = mk(top, 'div', 'addr-use');
	const useHead = mk(use, 'div', 'kv xs o-70');
	mk(useHead, 'span', '', t(state, 'memoryContextUseVsWindow'));
	const usePct = headline.w && headline.w > 0
		? (headline.cUse / headline.w) * 100
		: (ctx.windowUtilization ?? 0) * 100;
	const showUseMeter = headline.w !== undefined || (ctx.windowUtilization ?? 0) > 0;
	if (showUseMeter) {
		mk(useHead, 'span', 'mono', `${Math.min(100, usePct).toFixed(1)}%`);
	}
	const useLine = mk(use, 'div', 'flex items-center gap-1 min-w-0');
	mk(useLine, 'span', 'addr-use-value', headline.cUse.toLocaleString());
	if (headline.w !== undefined) {
		mk(useLine, 'span', 'addr-use-window truncate', `/ ${headline.w.toLocaleString()}`);
		use.title = t(state, 'memoryContextUseBound', { use: headline.cUse.toLocaleString(), w: headline.w.toLocaleString() });
	}
	if (showUseMeter) {
		meterBar(use, Math.min(100, usePct), boundColor(usePct));
	}
	mk(use, 'div', 't-10 o-50', t(state, 'memoryLastInjectHint'));

	const chips: Array<{ label: string; value: string }> = [];
	if (headline.recRolling !== undefined) {
		chips.push({ label: t(state, 'memoryRollingRec'), value: `${(headline.recRolling * 100).toFixed(1)}%` });
	}
	if (headline.answerableHorizon !== undefined) {
		chips.push({ label: t(state, 'memoryAnswerableHorizon'), value: formatAnswerableHorizon(headline.answerableHorizon) });
	}
	if (headline.sigma !== undefined) {
		chips.push({ label: t(state, 'memorySelectivity'), value: headline.sigma.toFixed(3) });
	}
	if (headline.epsilonB !== undefined || headline.epsilonBNote) {
		chips.push({ label: t(state, 'memoryEpsilonB'), value: formatTheoremError(headline.epsilonB, headline.epsilonBNote) });
	}
	if (headline.epsilonS !== undefined) {
		chips.push({ label: t(state, 'memoryEpsilonS'), value: formatTheoremError(headline.epsilonS) });
	}
	if (chips.length) {
		const row = mk(card, 'div', 'addr-chips mt-3');
		for (const chip of chips) {
			renderAddrChip(row, chip.label, chip.value);
		}
	}

	const visibleLevels = ctx.levels.filter(level => level.role === 'buffer' || level.tokens !== 0);
	const stores = visibleLevels.filter(levelIsStore);
	const buffers = visibleLevels.filter(level => !levelIsStore(level));
	if (stores.length || buffers.length) {
		const levels = mk(card, 'div', 'divided mt-3 pt-3 sy-3');
		mk(levels, 'div', 'xs fw-5 o-70', t(state, 'memoryHierarchyLevels'));
		renderLevelGroup(levels, state, {
			titleKey: 'memoryHierarchyStored',
			testId: 'memory-addressable-stored',
			levels: stores,
			store: true,
		});
		renderLevelGroup(levels, state, {
			titleKey: 'memoryHierarchyBuffers',
			testId: 'memory-addressable-buffers',
			levels: buffers,
			store: false,
			budget: ctx.workingMemoryBudget,
		});
	}

	const ageTiers = MEMORY_EFFECTIVE_TIERS
		.map(tier => ({ tier, tokens: ctx.tierTokens?.[tier] ?? 0 }))
		.filter(item => item.tokens > 0);
	if (ageTiers.length) {
		const age = mk(card, 'div', 'divided mt-3 pt-3 sy-1_5');
		age.setAttribute('data-testid', 'memory-addressable-age');
		const ageHead = mk(age, 'div', 'kv xs fw-5 o-70');
		mk(ageHead, 'span', '', t(state, 'memoryAgeMix'));
		const ageTotal = ageTiers.reduce((sum, item) => sum + item.tokens, 0);
		mk(ageHead, 'span', 'mono fw-5', tokenCountLabel(state, ageTotal));
		const stack = mk(age, 'div', 'addr-stack');
		for (const item of ageTiers) {
			const seg = mk(stack, 'div', 'addr-stack-seg');
			seg.style.width = `${(item.tokens / ageTotal) * 100}%`;
			seg.style.backgroundColor = MEMORY_TIER_COLORS[item.tier]?.text ?? '#6b7280';
			seg.title = `${t(state, `memoryTier${item.tier[0].toUpperCase()}${item.tier.slice(1)}`)} · ${tokenCountLabel(state, item.tokens)}`;
		}
		const legend = mk(age, 'div', 'addr-age-legend');
		for (const item of ageTiers) {
			const cell = mk(legend, 'div', 'addr-age-item');
			mk(cell, 'span', 'dot-2').style.backgroundColor = MEMORY_TIER_COLORS[item.tier]?.text ?? '#6b7280';
			mk(cell, 'span', 'capitalize', t(state, `memoryTier${item.tier[0].toUpperCase()}${item.tier.slice(1)}`));
			mk(cell, 'span', 'mono o-70', item.tokens.toLocaleString());
		}
	}
}

export function renderMemoryOverview(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void { // KN-376 KN-310-313
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
	mk(status, 'div', 'xs o-70', (d.healthScore !== undefined && d.healthScore !== null) ? `${t(state, 'memoryHealthScore')}: ${formatHealthScore(d.healthScore)}` : `${totalMemories.toLocaleString()} ${t(state, 'memoryTotalMemories')}`);
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

	renderAddressableHeadline(body, state);

	const stats = mk(body, 'div', 'stat-grid');
	statCard(stats, 'brain', t(state, 'memorySemantic'), d.totalSemantic);
	statCard(stats, 'file-text', t(state, 'memoryEpisodic'), d.totalEpisodic);
	statCard(stats, 'link', t(state, 'memoryEntities'), d.totalEntities);
	statCard(stats, 'globe', t(state, 'memorySessions'), d.totalSessions);
	statCard(stats, 'refresh-cw', t(state, 'memoryEdges'), d.totalEdges);
	statCard(stats, 'bar-chart-3', t(state, 'memoryPatterns'), d.totalPatterns ?? 0);
	statCard(stats, 'clipboard-list', t(state, 'memoryProcedures'), d.totalProcedures ?? 0);
	statCard(stats, 'hard-drive', t(state, 'memoryDbSize'), formatBytes(d.dbSizeBytes));

	const lastInject = (d.lastInject?.length ? d.lastInject : state.memoryLastInject) ?? [];
	if (lastInject.length) {
		const card = sectionCard(body, t(state, 'memoryLastInject'), 'brain');
		card.setAttribute('data-testid', 'memory-last-inject');
		const list = mk(card, 'div', 'divided mt-2 pt-2 sy-1');
		for (const item of lastInject.slice(0, 8)) {
			const row = mk(list, 'div', 'sy-0_5');
			mk(row, 'div', 'xs fw-5 truncate', item.title || t(state, 'memoryInjectedLastTurn'));
			const notice = formatInjectedLastTurn(item.reason, item.evidence);
			mk(row, 'div', 'xs o-60', t(state, notice.key, notice.params));
		}
	}

	if (state.memoryEbbinghausStats) {
		const card = sectionCard(body, t(state, 'memorySpacedRepetition'), 'brain');
		const ebb = mk(card, 'div', 'metric-grid');
		metricCell(ebb, String(state.memoryEbbinghausStats.reviewDueCount), t(state, 'memoryReviewDueCount'));
		metricCell(ebb, `${Math.round(state.memoryEbbinghausStats.avgRetention * 100)}%`, t(state, 'memoryAvgRetention'));
		if (state.memoryReviewDue.length) {
			const list = mk(card, 'div', 'divided mt-3 pt-2 sy-1');
			mk(list, 'div', 'xs fw-5 o-70 mb-1', t(state, 'memoryReviewDueList'));
			for (const item of state.memoryReviewDue) {
				const row = mk(list, 'div', 'kv xs o-80');
				mk(row, 'span', 'truncate pr-2', `${item.overdue ? '⚠ ' : ''}${item.category ? `[${item.category}] ` : ''}${item.title}`);
				if ((item.currentRetention !== undefined && item.currentRetention !== null)) {
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
			// allow-any-unicode-next-line
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

	if ((d.graphChannelSize ?? d.graphTotalEntities ?? d.totalEntities ?? 0) > 0) {
		const card = sectionCard(body, t(state, 'memoryKnowledgeGraphCap'), 'link');
		const grid = mk(card, 'div', 'stat-grid');
		statCard(grid, 'link', t(state, 'memoryGraphEntities'), String(d.graphChannelSize ?? d.graphTotalEntities ?? d.totalEntities ?? 0));
		statCard(grid, 'refresh-cw', t(state, 'memoryEdges'), d.graphTotalEdges ?? d.totalEdges);
		// allow-any-unicode-next-line
		statCard(grid, 'compass', t(state, 'memoryGraphPprAlpha'), `α=${d.graphPprAlpha ?? 0.15}`);
		mk(card, 'p', 'mt-3 t-10 o-50', t(state, 'memoryGraphCapLruHint'));
	}

	const trend = state.memoryMetricsTrend;
	if (trend) {
		const card = sectionCard(body, t(state, 'memoryMetricsTrend'), 'bar-chart-3');
		if (!trend.snapshots?.length) {
			mk(card, 'p', 'xs o-60', t(state, 'memoryNoMetricsSnapshots'));
		} else {
			const grid = mk(card, 'div', 'trend-grid');
			const snap = trend.snapshots[0];
			trendCell(grid, trend.addressableMemory, t(state, 'memoryTrendAddressable'), (snap.cAddr !== undefined && snap.cAddr !== null) ? Math.round(snap.cAddr).toLocaleString() : undefined);
			trendCell(grid, trend.response, t(state, 'memoryTrendResponse'), `${snap.avgResponseMs.toFixed(0)}ms`);
			trendCell(grid, trend.success, t(state, 'memoryTrendSuccess'), `${(snap.successRate * 100).toFixed(1)}%`);
			trendCell(grid, trend.growth, t(state, 'memoryTrendGrowth'), `${snap.memoryCount.toLocaleString()} ${t(state, 'memoryTotalMemories').toLowerCase()}`);
			if ((trend.periodHours !== undefined && trend.periodHours !== null)) {
				mk(card, 'div', 'mt-2 text-center t-10 o-50', t(state, 'memoryTrendPeriod', { hours: trend.periodHours, count: trend.snapshots.length }));
			}
		}
	}

	const tierCard = sectionCard(body, t(state, 'memoryTierDistribution'), 'bar-chart-3');
	const tierList = mk(tierCard, 'div', 'sy-2');
	const tierCounts = d.tierCounts ?? {};
	const tierTotal = MEMORY_EFFECTIVE_TIERS.reduce((sum, tier) => sum + (tierCounts[tier] ?? 0), 0);
	for (const tier of MEMORY_EFFECTIVE_TIERS) {
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
			mk(main, 'span', 'ml-2 o-50', (session.messageCount !== undefined && session.messageCount !== null) ? t(state, 'memoryMsgs', { count: session.messageCount }) : t(state, 'memoryMsgsUnknown'));
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
