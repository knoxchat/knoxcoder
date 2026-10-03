/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../knoxGuiWidget.js';
import { t } from './t.js';
import * as DOM from '../../../../../../base/browser/dom.js';
import { appendKnoxGuiSvg } from '../knoxGuiIcons.js';
import { lastUserHistoryIndex } from '../../../common/knoxGuiChat.js';
import {
	autonomousBannerKey,
	autonomousMax,
	autonomousProgress,
	collectLiveTaskPlan,
	countFailedJobs,
	countRunningJobs,
	gitDiffTotals,
	gitFileType,
	gitFileTypeColor,
	gitFileTypeIsConfig,
	isCompactionBannerVisible,
	isInjectedMemoryTimeout,
	isTaskJobId,
	KNOX_GUI_PANEL_CYAN,
	shouldShowAutonomousBanner,
	splitSelectiveMemories,
	taskPlanFillPercent,
	taskPlanStatusLabelKey,
	truncateJobTitle,
	visibleBackgroundJobs,
	compactionMethodKey,
} from '../../../common/knoxGuiPanels.js';
import {
	IKnoxGuiBackgroundJob,
	IKnoxGuiGitDiffFile,
	IKnoxGuiInjectedMemory,
	IKnoxGuiState,
	IKnoxGuiTaskPlanStep,
} from '../../../common/knoxGuiState.js';
import {
	activityKindLabelKey,
	buildAgentActivitySteps,
	collectTurnPromptLogs,
	countTurnToolLoopSteps,
	currentActivityStep,
	estimateTokensFromPromptLogs,
	estimateTurnOutputTokens,
	formatDurationMs,
	formatLoadingElapsed,
	formatTokenCount,
	formatTokenRate,
	hasForegroundCallingToolCalls,
	isTurnGeneratingTokens,
	itemCreatedAtMs,
	knoxGuiShowsCodeToEditOnEmptyComposer,
	loadingPixelDelays,
	loadingVariantFor,
	resolveAgentMaxSteps,
	summarizeJevPromptLogs,
	tickTokensPerSecond,
	turnElapsedMs,
} from '../../../common/knoxGuiTranscript.js';

export function renderAgentMeter(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const userIndex = lastUserHistoryIndex(state.history);
	const steps = buildAgentActivitySteps(state.history, userIndex, { inProgress: state.isStreaming });
	const live = state.isStreaming || hasForegroundCallingToolCalls(state.history);
	const autonomousActive = state.autonomous != null && state.autonomous.status !== 'idle';
	const used = Math.max(state.toolLoopSteps, countTurnToolLoopSteps(state.history, userIndex));
	if (userIndex < 0 && !state.isStreaming && !autonomousActive) {
		widget.clearMeterClock();
		return;
	}
	if (!steps.length && !state.isStreaming && used === 0 && !autonomousActive) {
		widget.clearMeterClock();
		return;
	}
	const meter = DOM.append(parent, DOM.$('.knox-gui-meter.knox-gui-attached'));
	meter.setAttribute('data-testid', 'agent-turn-meter');
	meter.setAttribute('data-composer-slot', 'agentMeter');
	meter.style.fontSize = `${state.fontSize - 3}px`;
	if (autonomousActive && state.autonomous) {
		widget.renderAutonomousBanner(meter, state);
	}
	const canExpand = steps.length > 0;
	const open = widget.agentMeterOpen && canExpand;
	const current = currentActivityStep(steps);
	const maxSteps = resolveAgentMaxSteps(state.agentMaxSteps);
	const nearCap = maxSteps !== null && maxSteps > 0 && used / maxSteps >= 0.8;
	const progress = maxSteps !== null && maxSteps > 0 ? Math.min(100, Math.round((used / maxSteps) * 100)) : null;
	const startedAt = itemCreatedAtMs(state.history[userIndex]);
	const logs = collectTurnPromptLogs(state.history, userIndex);
	const tokens = estimateTokensFromPromptLogs(logs);
	const outputTokens = estimateTurnOutputTokens(state.history, userIndex, logs);
	const generating = isTurnGeneratingTokens(state.isStreaming, state.history);
	const turnKey = `${userIndex}:${startedAt ?? ''}`;
	if (widget.meterTurnKey !== turnKey) {
		widget.meterFollowEnabled = true;
	}
	widget.meterStartedAt = startedAt;
	widget.meterGenerating = generating;
	widget.meterOutputTokens = outputTokens;
	widget.meterTurnKey = turnKey;
	widget.meterTpsClock = tickTokensPerSecond(widget.meterTpsClock, outputTokens, generating, turnKey, Date.now());
	const jevSummary = summarizeJevPromptLogs(logs);
	const elapsed = turnElapsedMs(state.history, userIndex, Date.now(), live);
	const toggle = DOM.append(meter, DOM.$('button.knox-gui-meter-toggle')) as HTMLButtonElement;
	toggle.type = 'button';
	toggle.setAttribute('data-testid', 'agent-turn-meter-toggle');
	if (canExpand) {
		toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
		widget.hover(toggle, t(state, 'activityTimeline'));
		const chevron = DOM.append(toggle, DOM.$('span.knox-gui-meter-chevron'));
		appendKnoxGuiSvg(chevron, open ? 'chevron-down' : 'chevron-right', 13);
		widget.renderStore.add(DOM.addDisposableListener(toggle, 'click', () => {
			widget.agentMeterOpen = !widget.agentMeterOpen;
			widget.meterFollowEnabled = true;
			widget.controller.setActivityPanelExpanded(widget.agentMeterOpen);
			widget.render();
		}));
	} else {
		toggle.disabled = false;
		toggle.classList.add('knox-gui-meter-toggle-static');
	}
	if (live) {
		renderLoadingState(widget, toggle, {
			label: current ? t(state, activityKindLabelKey(current.kind)) : t(state, 'activityLoading'),
			variant: loadingVariantFor(current?.kind),
			startedAt,
			testId: 'agent-turn-meter-loading',
		});
	}
	const meta = DOM.append(toggle, DOM.$('span.knox-gui-meter-meta'));
	const stepsLabel = maxSteps === null
		? t(state, 'activityStepsUnlimited', { used })
		: t(state, 'activityStepsUsed', { used, max: maxSteps });
	const stepsEl = DOM.append(meta, DOM.$('span', undefined, stepsLabel));
	if (nearCap) {
		stepsEl.classList.add('knox-gui-meter-warn');
	}
	if (state.agentProfile === 'systems' || state.agentProfile === 'rust') {
		const profile = DOM.append(meta, DOM.$('span'));
		profile.setAttribute('data-testid', 'agent-turn-meter-profile');
		profile.textContent = t(state, state.agentProfile === 'systems' ? 'activityProfileSystems' : 'activityProfileRust');
	}
	if (jevSummary) {
		const jev = DOM.append(meta, DOM.$('span'));
		jev.setAttribute('data-testid', 'agent-turn-meter-jev');
		jev.textContent = jevSummary.skill
			? t(state, 'activityJevSkill', { route: jevSummary.route, skill: jevSummary.skill })
			: t(state, 'activityJev', { route: jevSummary.route });
	}
	if (autonomousActive && state.autonomous) {
		const auto = DOM.append(meta, DOM.$('span'));
		auto.setAttribute('data-testid', 'agent-turn-meter-autonomous');
		auto.textContent = autonomousMax(state.autonomous) > 0
			? t(state, 'activityAutonomous', { iteration: state.autonomous.iteration, max: autonomousMax(state.autonomous) })
			: t(state, 'activityAutonomousUnlimited', { iteration: state.autonomous.iteration });
	}
	if (tokens > 0) {
		const tokenEl = DOM.append(meta, DOM.$('span', undefined, t(state, 'activityTokens', { count: formatTokenCount(tokens) })));
		widget.hover(tokenEl, `${tokens.toLocaleString()} — ${t(state, 'activityTokensEstimate')}`);
	}
	if (widget.meterTpsClock.tps > 0) {
		const tpsEl = DOM.append(meta, DOM.$('span.knox-gui-meter-tps'));
		tpsEl.setAttribute('data-testid', 'agent-turn-meter-tps');
		tpsEl.textContent = t(state, 'activityTokensPerSecond', { count: formatTokenRate(widget.meterTpsClock.tps) });
		widget.hover(tpsEl, t(state, 'activityTokensPerSecondEstimate'));
		widget.meterTpsEl = tpsEl;
	} else {
		widget.meterTpsEl = undefined;
	}
	if (!live && elapsed > 0) {
		DOM.append(meta, DOM.$('span', undefined, formatDurationMs(elapsed)));
	}
	if (canExpand) {
		DOM.append(toggle, DOM.$('span.knox-gui-muted.knox-gui-meter-count', undefined, t(state, steps.length === 1 ? 'activityRowCount' : 'activityRowCount_plural', { count: steps.length })));
	}
	if (progress !== null && (live || used > 0)) {
		const bar = DOM.append(meter, DOM.$('.knox-gui-meter-progress'));
		bar.setAttribute('role', 'progressbar');
		bar.setAttribute('aria-valuenow', String(used));
		bar.setAttribute('aria-valuemin', '0');
		if (maxSteps !== null) {
			bar.setAttribute('aria-valuemax', String(maxSteps));
		}
		const fill = DOM.append(bar, DOM.$('.knox-gui-meter-progress-fill'));
		if (nearCap) {
			fill.classList.add('warn');
		}
		fill.style.width = `${progress}%`;
	}
	if (canExpand) {
		const collapse = DOM.append(meter, DOM.$(`.knox-gui-meter-list${open ? '.open' : ''}`));
		const scroll = DOM.append(collapse, DOM.$('.knox-gui-meter-scroll'));
		scroll.setAttribute('data-testid', 'agent-turn-meter-scroll');
		widget.renderActivitySteps(scroll, state, steps);
		if (open) {
			bindMeterStickToBottom(widget, scroll, live, `${steps.length}:${steps[steps.length - 1]?.id ?? ''}:${steps[steps.length - 1]?.status ?? ''}:${steps[steps.length - 1]?.detail ?? ''}`);
		}
	}
	syncMeterClock(widget, live, generating, outputTokens, turnKey, state);
}

export function renderLoadingState(
	widget: KnoxGuiWidget,
	parent: HTMLElement,
	options: { label: string; variant: 'drive' | 'dots' | 'orbit'; startedAt?: number; testId: string; ownClock?: boolean },
): void {
	const loading = DOM.append(parent, DOM.$('span.knox-gui-loading-state'));
	loading.setAttribute('role', 'status');
	loading.setAttribute('aria-live', 'polite');
	loading.setAttribute('data-testid', options.testId);
	const { delays, durationMs, round } = loadingPixelDelays(options.variant);
	const grid = DOM.append(loading, DOM.$('span.knox-gui-loading-grid'));
	grid.setAttribute('aria-hidden', 'true');
	grid.style.setProperty('--knox-pixel-dur', `${durationMs}ms`);
	for (const delay of delays) {
		const pixel = DOM.append(grid, DOM.$(`.knox-gui-loading-pixel${round ? '.round' : ''}`));
		if (delay === null) {
			pixel.style.opacity = '0.07';
		} else {
			pixel.style.opacity = '0.16';
			pixel.style.animation = `knox-pixel-on var(--knox-pixel-dur) ease-in-out ${delay}ms infinite`;
		}
	}
	DOM.append(loading, DOM.$('span.knox-gui-loading-label', undefined, options.label));
	const elapsed = DOM.append(loading, DOM.$('span.knox-gui-loading-elapsed'));
	const origin = options.startedAt ?? Date.now();
	const tick = () => {
		elapsed.textContent = formatLoadingElapsed(Math.max(0, (Date.now() - origin) / 1000));
		loading.setAttribute('aria-label', `${options.label} ${elapsed.textContent}`);
	};
	tick();
	if (options.ownClock) {
		const timer = setInterval(tick, 100);
		widget.renderStore.add({ dispose: () => clearInterval(timer) });
		return;
	}
	widget.meterElapsedEl = elapsed;
}

function bindMeterStickToBottom(widget: KnoxGuiWidget, scroll: HTMLElement, live: boolean, _fingerprint: string): void {
	if (widget.meterFollowEnabled && live) {
		widget.meterProgrammaticScroll = true;
		scroll.scrollTop = scroll.scrollHeight;
		queueMicrotask(() => {
			widget.meterProgrammaticScroll = false;
		});
	}
	widget.renderStore.add(DOM.addDisposableListener(scroll, 'scroll', () => {
		if (widget.meterProgrammaticScroll) {
			return;
		}
		const distance = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
		if (scroll.scrollTop < widget.meterLastScrollTop - 0.5) {
			widget.meterFollowEnabled = false;
		} else if (distance <= 8) {
			widget.meterFollowEnabled = true;
		}
		widget.meterLastScrollTop = scroll.scrollTop;
	}));
	widget.renderStore.add(DOM.addDisposableListener(scroll, 'wheel', (e: WheelEvent) => {
		if (e.deltaY < 0) {
			widget.meterFollowEnabled = false;
		} else if (scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= 8) {
			widget.meterFollowEnabled = true;
		}
	}));
}

export function syncMeterClock(
	widget: KnoxGuiWidget,
	live: boolean,
	generating: boolean,
	outputTokens: number,
	turnKey: string,
	state: IKnoxGuiState,
): void {
	widget.meterGenerating = generating;
	widget.meterOutputTokens = outputTokens;
	widget.meterTurnKey = turnKey;
	if (!live && !generating) {
		widget.clearMeterClock();
		return;
	}
	if (widget.meterClockTimer) {
		return;
	}
	widget.meterClockTimer = setInterval(() => {
		const now = Date.now();
		if (widget.meterElapsedEl && widget.meterStartedAt) {
			widget.meterElapsedEl.textContent = formatLoadingElapsed(Math.max(0, (now - widget.meterStartedAt) / 1000));
		}
		widget.meterTpsClock = tickTokensPerSecond(
			widget.meterTpsClock,
			widget.meterOutputTokens,
			widget.meterGenerating,
			widget.meterTurnKey,
			now,
		);
		if (widget.meterTpsEl && widget.meterTpsClock.tps > 0 && widget.lastState) {
			widget.meterTpsEl.textContent = t(widget.lastState, 'activityTokensPerSecond', { count: formatTokenRate(widget.meterTpsClock.tps) });
		}
	}, 100);
	void state;
}

export function clearMeterClock(widget: KnoxGuiWidget): void {
	if (widget.meterClockTimer) {
		clearInterval(widget.meterClockTimer);
		widget.meterClockTimer = undefined;
	}
	widget.meterElapsedEl = undefined;
	widget.meterTpsEl = undefined;
}

export function renderPanels(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const wrap = DOM.append(parent, DOM.$('.knox-gui-attached-panels'));
	wrap.setAttribute('data-composer-slot', 'panels');
	wrap.setAttribute('role', 'region');
	wrap.setAttribute('aria-label', t(state, 'attachedPanelsLabel'));
	widget.renderGitDiffPanel(wrap, state);
	widget.renderCompactionPanel(wrap, state);
	widget.renderWorktreePanel(wrap, state);
	widget.renderReviewPanel(wrap, state);
	widget.renderHooksPanel(wrap, state);
	widget.renderTaskPlanPanel(wrap, state);
	widget.renderInjectedMemoriesPanel(wrap, state);
	widget.renderBackgroundJobsPanel(wrap, state);
	if (knoxGuiShowsCodeToEditOnEmptyComposer(state.mode, state.history.length) || (state.mode !== 'edit' && state.codeToEdit.length)) {
		if (state.mode === 'edit') {
			widget.renderCodeToEditCard(wrap, state);
		} else {
			const chips = DOM.append(wrap, DOM.$('.knox-gui-chips'));
			chips.setAttribute('data-testid', 'knox-gui-code-to-edit-chips');
			for (const [index, code] of state.codeToEdit.entries()) {
				const chip = DOM.append(chips, DOM.$('span.knox-gui-chip', undefined, code.filepath.split(/[/\\]/).pop() ?? code.filepath));
				chip.setAttribute('data-testid', 'knox-gui-code-to-edit-chip');
				widget.iconButton(chip, '×', () => widget.controller.removeCodeToEdit(index));
			}
		}
	}
}

export function renderAutonomousBanner(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const loop = state.autonomous;
	if (!shouldShowAutonomousBanner(loop)) {
		return;
	}
	const banner = DOM.append(parent, DOM.$('.knox-gui-auto-banner'));
	banner.setAttribute('data-testid', 'autonomous-iteration-banner');
	banner.style.fontSize = `${Math.max(9, state.fontSize - 3)}px`;
	const row = DOM.append(banner, DOM.$('.knox-gui-auto-banner-row'));
	const icon = DOM.append(row, DOM.$('span.knox-gui-attached-icon'));
	if (loop.status === 'running') {
		widget.appendSpinner(icon, 12);
	} else if (loop.status === 'completed') {
		appendKnoxGuiSvg(icon, 'check', 12);
	} else {
		appendKnoxGuiSvg(icon, 'x', 12);
	}
	appendKnoxGuiSvg(row, 'bot', 12).classList.add('knox-gui-attached-icon');
	const max = autonomousMax(loop);
	const label = DOM.append(row, DOM.$('span.knox-gui-auto-banner-label', undefined, t(state, autonomousBannerKey(loop), max > 0
		? { iteration: loop.iteration, max }
		: { iteration: loop.iteration })));
	const progress = autonomousProgress(loop);
	if (progress?.nearCap) {
		label.classList.add('warn');
	}
	widget.hover(label, loop.goal || label.textContent || '');
	if (loop.goal) {
		const goal = DOM.append(row, DOM.$('span.knox-gui-muted.knox-gui-auto-banner-goal', undefined, loop.goal));
		widget.hover(goal, loop.goal);
	}
	if (progress) {
		const bar = DOM.append(banner, DOM.$('.knox-gui-attached-progress'));
		bar.setAttribute('role', 'progressbar');
		bar.setAttribute('aria-valuenow', String(loop.iteration));
		bar.setAttribute('aria-valuemin', '0');
		bar.setAttribute('aria-valuemax', String(max));
		const fill = DOM.append(bar, DOM.$('.knox-gui-attached-progress-fill'));
		if (progress.nearCap) {
			fill.classList.add('warn');
		}
		fill.style.width = `${progress.percent}%`;
	}
}

export function renderGitDiffPanel(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const files = state.gitDiffFiles;
	if (!files.length) {
		return;
	}
	if (!widget.gitDiffExpandedPinned && files.length > 0) {
		widget.gitDiffExpanded = true;
	}
	const totals = gitDiffTotals(files);
	const panel = widget.attachedPanel(parent, 'git-diff-status-panel');
	const toggle = widget.attachedToggle(panel, state, {
		expanded: widget.gitDiffExpanded,
		testId: 'git-diff-status-toggle',
		onToggle: () => {
			widget.gitDiffExpandedPinned = true;
			widget.gitDiffExpanded = !widget.gitDiffExpanded;
			widget.controller.setGitDiffExpanded(widget.gitDiffExpanded);
			widget.render();
		},
	});
	DOM.append(toggle, DOM.$('span.knox-gui-attached-title', undefined, t(state, 'filesChanged', { count: files.length })));
	if (totals.additions > 0 || totals.deletions > 0) {
		const stats = DOM.append(toggle, DOM.$('span.knox-gui-attached-stats'));
		if (totals.additions > 0) {
			DOM.append(stats, DOM.$('span.knox-gui-diff-add', undefined, `+${totals.additions}`));
		}
		if (totals.deletions > 0) {
			DOM.append(stats, DOM.$('span.knox-gui-diff-del', undefined, `-${totals.deletions}`));
		}
	}
	const body = widget.attachedBody(panel, widget.gitDiffExpanded);
	for (const file of files) {
		widget.renderGitDiffRow(body, state, file);
	}
}

export function renderGitDiffRow(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, file: IKnoxGuiGitDiffFile): void {
	const row = DOM.append(parent, DOM.$('button.knox-gui-git-row')) as HTMLButtonElement;
	row.type = 'button';
	widget.hover(row, file.filepath);
	widget.renderStore.add(DOM.addDisposableListener(row, 'click', () => widget.controller.openGitFile(file)));
	if (gitFileTypeIsConfig(file.fileType)) {
		const icon = DOM.append(row, DOM.$('span.codicon.codicon-settings-gear.knox-gui-git-type'));
		icon.style.color = gitFileTypeColor(file.fileType);
	} else {
		const badge = DOM.append(row, DOM.$('span.knox-gui-git-type', undefined, file.fileType));
		badge.style.color = gitFileTypeColor(file.fileType);
	}
	DOM.append(row, DOM.$('span.knox-gui-git-name', undefined, file.displayPath));
	const stats = DOM.append(row, DOM.$('span.knox-gui-attached-stats'));
	const showStats = file.additions > 0 || file.deletions > 0;
	if (file.isBinary && !showStats) {
		DOM.append(stats, DOM.$('span.knox-gui-muted', undefined, t(state, 'gitDiffBinary')));
	} else if (showStats) {
		if (file.additions > 0) {
			DOM.append(stats, DOM.$('span.knox-gui-diff-add', undefined, `+${file.additions}`));
		}
		if (file.deletions > 0) {
			DOM.append(stats, DOM.$('span.knox-gui-diff-del', undefined, `-${file.deletions}`));
		}
	}
}

export function renderCompactionPanel(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	if (!isCompactionBannerVisible(state.compaction)) {
		return;
	}
	const compaction = state.compaction;
	const panel = widget.attachedPanel(parent, 'compaction-status-panel');
	const toggle = widget.attachedToggle(panel, state, {
		expanded: widget.compactionOpen,
		testId: 'compaction-status-toggle',
		onToggle: () => {
			widget.compactionOpen = !widget.compactionOpen;
			widget.render();
		},
	});
	DOM.append(toggle, DOM.$('span.knox-gui-attached-title', undefined, t(state, 'compactionAppliedTitle')));
	DOM.append(toggle, DOM.$('span.knox-gui-muted', undefined, t(state, compactionMethodKey(compaction.summarizationMethod))));
	widget.attachedDismiss(toggle, t(state, 'compactionDismiss'), () => widget.controller.dismissCompaction());
	const body = widget.attachedBody(panel, widget.compactionOpen);
	const stats = [
		t(state, 'compactionStats', { from: compaction.originalMessageCount, to: compaction.compactedMessageCount }),
		compaction.deduplicated ? t(state, 'compactionDeduplicated') : '',
		compaction.summarized ? t(state, 'compactionSummarized') : '',
	].filter(Boolean).join(' · ');
	DOM.append(body, DOM.$('div.knox-gui-muted', undefined, stats));
	if (compaction.summaryText) {
		DOM.append(body, DOM.$('pre.knox-gui-attached-pre', undefined, compaction.summaryText));
	} else {
		DOM.append(body, DOM.$('div.knox-gui-muted', undefined, t(state, 'compactionNoSummary')));
	}
}

export function renderWorktreePanel(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	if (state.mode !== 'agent' || (!state.worktree.enabled && !state.worktree.error)) {
		return;
	}
	const panel = DOM.append(parent, DOM.$('.knox-gui-worktree'));
	panel.setAttribute('data-testid', 'agent-worktree-panel');
	panel.style.fontSize = `${Math.max(9, state.fontSize - 2)}px`;
	const row = DOM.append(panel, DOM.$('.knox-gui-worktree-row'));
	const fileCount = state.worktree.files.length;
	const label = state.worktree.enabled
		? t(state, fileCount === 1 ? 'worktreeActive' : 'worktreeActive_plural', { branch: state.worktree.branch ?? 'knox/agent', count: fileCount })
		: t(state, 'worktreeChip');
	DOM.append(row, DOM.$('span.knox-gui-muted.knox-gui-worktree-label', undefined, label));
	if (state.worktree.enabled) {
		const actions = DOM.append(row, DOM.$('.knox-gui-worktree-actions'));
		const apply = widget.chromeButton(actions, {
			label: t(state, 'worktreeApply'),
			title: t(state, 'worktreeApplyHint'),
			disabled: state.worktree.busy || fileCount === 0,
			extraClass: 'knox-gui-worktree-apply knox-gui-text-action',
			onClick: () => void widget.controller.runWorktree('apply'),
		});
		apply.disabled = state.worktree.busy || fileCount === 0;
		const discard = widget.chromeButton(actions, {
			label: t(state, 'worktreeDiscard'),
			title: t(state, 'worktreeDiscardHint'),
			disabled: state.worktree.busy,
			extraClass: 'knox-gui-worktree-discard knox-gui-text-action',
			onClick: () => void widget.controller.runWorktree('discard'),
		});
		discard.disabled = state.worktree.busy;
	}
	if (state.worktree.error) {
		DOM.append(panel, DOM.$('span.knox-gui-worktree-error', undefined, state.worktree.error));
	} else if (state.worktree.path) {
		const path = DOM.append(panel, DOM.$('code.knox-gui-worktree-path', undefined, state.worktree.path));
		widget.hover(path, state.worktree.path);
	}
}

/** K-026: files the agent edited but that are still held back; apply or discard them, or open a diff. */
/** Workspace-relative path for a staged file (falls back to the absolute path outside the workspace). */
function reviewDisplayPath(path: string, workspaceDirectory: string): string {
	let clean = path;
	try {
		clean = decodeURIComponent(path);
	} catch {
		// keep the raw path
	}
	const root = workspaceDirectory.replace(/^file:\/\//, '').replace(/\/+$/, '');
	return root && clean.startsWith(`${root}/`) ? clean.slice(root.length + 1) : clean;
}

export function renderReviewPanel(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const review = state.review;
	if (state.mode !== 'agent' || (!review.enabled && !review.error)) {
		return;
	}
	const panel = widget.attachedPanel(parent, 'agent-review-panel');
	panel.classList.add('knox-gui-review');
	const count = review.files.length;
	const toggle = widget.attachedToggle(panel, state, {
		expanded: widget.reviewOpen,
		testId: 'review-toggle',
		onToggle: () => {
			widget.reviewOpen = !widget.reviewOpen;
			widget.render();
		},
	});
	DOM.append(toggle, DOM.$('span.knox-gui-attached-title', undefined, t(state, count === 1 ? 'reviewPending' : 'reviewPending_plural', { count })));
	const actions = DOM.append(toggle, DOM.$('span.knox-gui-attached-stats'));
	const inlineAction = (label: string, title: string, testId: string, disabled: boolean, onClick: () => void) => {
		const btn = DOM.append(actions, DOM.$('span.knox-gui-text-action', undefined, label));
		btn.setAttribute('role', 'button');
		btn.setAttribute('title', title);
		btn.setAttribute('data-testid', testId);
		btn.tabIndex = disabled ? -1 : 0;
		if (disabled) {
			btn.setAttribute('aria-disabled', 'true');
			btn.style.opacity = '0.5';
			btn.style.pointerEvents = 'none';
		}
		const run = (e: Event) => {
			e.stopPropagation();
			if (!disabled) {
				onClick();
			}
		};
		widget.renderStore.add(DOM.addDisposableListener(btn, 'click', run));
		widget.renderStore.add(DOM.addDisposableListener(btn, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				run(e);
			}
		}));
	};
	const lockAll = review.busy || count === 0 || state.isStreaming;
	inlineAction(t(state, 'reviewApplyAll'), t(state, 'reviewApplyHint'), 'review-apply-all', lockAll, () => void widget.controller.runReview('apply'));
	inlineAction(t(state, 'reviewDiscardAll'), t(state, 'reviewDiscardHint'), 'review-discard-all', lockAll, () => void widget.controller.runReview('discard'));
	const bodyEl = widget.attachedBody(panel, widget.reviewOpen);
	if (review.error) {
		DOM.append(bodyEl, DOM.$('span.knox-gui-worktree-error', undefined, review.error));
	}
	for (const file of review.files) {
		const item = DOM.append(bodyEl, DOM.$('.knox-gui-worktree-row.knox-gui-review-file'));
		item.setAttribute('data-testid', 'review-file');
		const name = file.fileUri.replace(/^file:\/\//, '');
		DOM.append(item, DOM.$('span.knox-gui-review-kind', undefined, t(state, `reviewKind_${file.kind}`)));
		// Same presentation as the "files changed" list: type badge + workspace-relative path.
		const fileType = gitFileType(name);
		if (gitFileTypeIsConfig(fileType)) {
			const icon = DOM.append(item, DOM.$('span.codicon.codicon-settings-gear.knox-gui-git-type'));
			icon.style.color = gitFileTypeColor(fileType);
		} else {
			const badge = DOM.append(item, DOM.$('span.knox-gui-git-type', undefined, fileType));
			badge.style.color = gitFileTypeColor(fileType);
		}
		const label = DOM.append(item, DOM.$('button.knox-gui-worktree-path.knox-gui-review-link', undefined, reviewDisplayPath(name, widget.controller.workspaceDirectory))) as HTMLButtonElement;
		label.type = 'button';
		label.setAttribute('data-testid', 'review-open-file');
		label.disabled = review.busy;
		widget.hover(label, name);
		widget.renderStore.add(DOM.addDisposableListener(label, 'click', () => void widget.controller.openReviewInEditor(file.fileUri)));
		const counts = DOM.append(item, DOM.$('span.knox-gui-review-counts'));
		counts.setAttribute('data-testid', 'review-counts');
		DOM.append(counts, DOM.$('span.knox-gui-review-add', undefined, `+${file.added}`));
		DOM.append(counts, DOM.$('span.knox-gui-review-del', undefined, ` -${file.removed}`));
		const fileActions = DOM.append(item, DOM.$('.knox-gui-worktree-actions'));
		const opened = review.openFileUri === file.fileUri;
		widget.chromeButton(fileActions, {
			label: t(state, opened ? 'reviewHideDiff' : 'reviewShowDiff'),
			extraClass: 'knox-gui-text-action',
			onClick: () => {
				if (opened) {
					widget.controller.store.patch({ review: { ...review, openFileUri: undefined, openDiff: undefined } });
				} else {
					void widget.controller.runReview('diff', [file.fileUri]);
				}
			},
		}).disabled = review.busy;
		widget.chromeButton(fileActions, {
			label: t(state, 'reviewApplyOne'),
			extraClass: 'knox-gui-text-action',
			onClick: () => void widget.controller.runReview('apply', [file.fileUri]),
		}).disabled = review.busy || state.isStreaming;
		widget.chromeButton(fileActions, {
			label: t(state, 'reviewDiscardOne'),
			extraClass: 'knox-gui-text-action',
			onClick: () => void widget.controller.runReview('discard', [file.fileUri]),
		}).disabled = review.busy || state.isStreaming;
		if (opened && review.openDiff !== undefined) {
			const pre = DOM.append(bodyEl, DOM.$('pre.knox-gui-attached-pre'));
			for (const line of review.openDiff.split('\n')) {
				DOM.append(pre, DOM.$(line.startsWith('+') ? 'div.knox-gui-review-add' : line.startsWith('-') ? 'div.knox-gui-review-del' : 'div', undefined, line || ' '));
			}
		}
	}
}

/** K-023: configured hook events and the recent audit log; only shown when hooks exist or have run. */
export function renderHooksPanel(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const hooks = state.hooks;
	if (state.mode !== 'agent' || (!hooks.events.length && !hooks.entries.length)) {
		return;
	}
	const panel = widget.attachedPanel(parent, 'agent-hooks-panel');
	const toggle = widget.attachedToggle(panel, state, {
		expanded: hooks.open,
		testId: 'hooks-toggle-log',
		onToggle: () => {
			widget.controller.store.patch({ hooks: { ...hooks, open: !hooks.open } });
			if (!hooks.open) {
				void widget.controller.refreshHooks();
			}
		},
	});
	const icon = DOM.append(toggle, DOM.$('span.knox-gui-attached-icon'));
	appendKnoxGuiSvg(icon, 'list-checks', 12);
	const label = hooks.events.length ? t(state, 'hooksActive', { events: hooks.events.join(', ') }) : t(state, 'hooksNone');
	DOM.append(toggle, DOM.$('span.knox-gui-attached-title', undefined, label));
	const meta = DOM.append(toggle, DOM.$('span.knox-gui-attached-stats'));
	DOM.append(meta, DOM.$('span.knox-gui-muted', undefined, String(hooks.entries.length)));
	if (hooks.open) {
		widget.attachedDismiss(toggle, t(state, 'hooksClearLog'), () => void widget.controller.refreshHooks('clear'))
			.setAttribute('data-testid', 'hooks-clear-log');
		const body = widget.attachedBody(panel, true);
		const pre = DOM.append(body, DOM.$('pre.knox-gui-attached-pre'));
		pre.setAttribute('data-testid', 'hooks-log');
		if (!hooks.entries.length) {
			DOM.append(pre, DOM.$('div', undefined, t(state, 'hooksEmptyLog')));
		}
		for (const e of hooks.entries) {
			const time = new Date(e.at).toISOString().slice(11, 19);
			const bad = e.outcome === 'deny' || e.outcome === 'error' || e.outcome === 'timeout';
			DOM.append(pre, DOM.$(bad ? 'div.knox-gui-review-del' : 'div', undefined, `${time} ${e.event}${e.toolName ? ' ' + e.toolName : ''} ${e.command} -> ${e.outcome} (${e.durationMs}ms)${e.detail ? ': ' + e.detail : ''}`));
		}
	}
}

export function renderTaskPlanPanel(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const plan = collectLiveTaskPlan(state.history);
	if (!plan) {
		return;
	}
	if (widget.taskPlanDismissedKey === plan.fingerprint) {
		return;
	}
	const structureKey = `${plan.title}|${plan.steps.map(step => step.id).join(',')}`;
	if (widget.lastTaskPlanStructure && widget.lastTaskPlanStructure !== structureKey) {
		widget.taskPlanOpen = true;
	}
	widget.lastTaskPlanStructure = structureKey;
	const panel = widget.attachedPanel(parent, 'task-plan-panel');
	const toggle = widget.attachedToggle(panel, state, {
		expanded: widget.taskPlanOpen,
		testId: 'task-plan-toggle',
		onToggle: () => {
			widget.taskPlanOpen = !widget.taskPlanOpen;
			widget.render();
		},
	});
	const icon = DOM.append(toggle, DOM.$('span.knox-gui-attached-icon'));
	if (plan.updating) {
		widget.appendSpinner(icon, 12);
	} else {
		appendKnoxGuiSvg(icon, 'list-checks', 12);
	}
	DOM.append(toggle, DOM.$('span.knox-gui-attached-title', undefined, t(state, 'taskPlanTitle')));
	const meta = DOM.append(toggle, DOM.$('span.knox-gui-attached-stats'));
	if (plan.steps.length > 0) {
		const fraction = DOM.append(meta, DOM.$('span.knox-gui-attached-cyan', undefined, plan.remaining === 0
			? t(state, 'taskPlanAllDone')
			: t(state, 'taskPlanFraction', { done: plan.doneCount, total: plan.steps.length })));
		fraction.style.color = KNOX_GUI_PANEL_CYAN;
	} else {
		DOM.append(meta, DOM.$('span.knox-gui-muted', undefined, t(state, 'taskPlanEmpty')));
	}
	if (plan.current) {
		DOM.append(meta, DOM.$('span.knox-gui-muted.knox-gui-attached-current', undefined, plan.current.title));
	}
	widget.attachedDismiss(toggle, t(state, 'taskPlanDismiss'), () => {
		widget.taskPlanDismissedKey = plan.fingerprint;
		widget.render();
	});
	const bar = DOM.append(panel, DOM.$('.knox-gui-attached-progress.knox-gui-task-progress'));
	bar.setAttribute('data-testid', 'task-plan-progress-bar');
	const fill = DOM.append(bar, DOM.$('.knox-gui-attached-progress-fill'));
	fill.style.width = `${taskPlanFillPercent(plan)}%`;
	const body = widget.attachedBody(panel, widget.taskPlanOpen);
	const head = DOM.append(body, DOM.$('.knox-gui-task-head'));
	DOM.append(head, DOM.$('div.knox-gui-task-title', undefined, plan.title));
	if (plan.remaining > 0) {
		DOM.append(head, DOM.$('span.knox-gui-muted', undefined, t(state, 'taskPlanProgress', { remaining: plan.remaining, total: plan.steps.length })));
	}
	if (!plan.steps.length) {
		DOM.append(body, DOM.$('div.knox-gui-muted', undefined, t(state, 'taskPlanEmpty')));
	} else {
		plan.steps.forEach((step, index) => widget.renderTaskPlanStep(body, state, step, index));
	}
}

export function renderTaskPlanStep(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, step: IKnoxGuiTaskPlanStep, index: number): void {
	const row = DOM.append(parent, DOM.$('.knox-gui-task-step'));
	row.setAttribute('data-testid', `task-plan-step-${step.id}`);
	row.setAttribute('data-status', step.status);
	const label = [t(state, taskPlanStatusLabelKey(step.status)), step.activity].filter(Boolean).join(' · ');
	row.setAttribute('aria-label', `${index + 1}. ${step.title} (${label})`);
	widget.hover(row, label);
	if (step.status === 'in_progress') {
		row.classList.add('active');
	}
	const icon = DOM.append(row, DOM.$('span.knox-gui-task-icon'));
	if (step.status === 'done') {
		appendKnoxGuiSvg(icon, 'check-square', 13).style.color = KNOX_GUI_PANEL_CYAN;
	} else if (step.status === 'in_progress') {
		const square = appendKnoxGuiSvg(icon, 'square', 13);
		square.style.color = KNOX_GUI_PANEL_CYAN;
		square.classList.add('knox-gui-task-live');
	} else if (step.status === 'skipped') {
		appendKnoxGuiSvg(icon, 'minus', 13).style.color = '#a1a1aa';
	} else {
		appendKnoxGuiSvg(icon, 'square', 13).style.color = '#6e6e77';
	}
	const title = DOM.append(row, DOM.$('div.knox-gui-task-step-title'));
	if (step.status === 'done' || step.status === 'skipped') {
		title.classList.add('muted');
	}
	if (step.status === 'skipped') {
		title.classList.add('skipped');
	}
	if (step.status === 'in_progress') {
		title.style.color = KNOX_GUI_PANEL_CYAN;
	}
	title.append(`${index + 1}. ${step.title}`);
}

export function renderInjectedMemoriesPanel(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const items = state.injectedMemories;
	if (!items.length) {
		return;
	}
	const timeout = isInjectedMemoryTimeout(items);
	const { visible, collapsed } = splitSelectiveMemories(items, state.memoryMode);
	const rendered = widget.showLowScoringMemories ? [...visible, ...collapsed] : visible;
	const actionable = items.filter(item => item.id != null && item.kind === 'semantic');
	const panel = widget.attachedPanel(parent, 'injected-memories-panel');
	const toggle = widget.attachedToggle(panel, state, {
		expanded: widget.memoriesOpen,
		testId: 'injected-memories-toggle',
		onToggle: () => {
			widget.memoriesOpen = !widget.memoriesOpen;
			widget.render();
		},
	});
	const brain = DOM.append(toggle, DOM.$('span.knox-gui-attached-icon'));
	appendKnoxGuiSvg(brain, 'brain', 12);
	DOM.append(toggle, DOM.$('span.knox-gui-attached-title', undefined, timeout
		? t(state, 'memoryInjectUnavailable')
		: t(state, 'memoryInjectedTitle', { count: items.length })));
	widget.attachedDismiss(toggle, t(state, 'memoryInjectDismiss'), () => widget.controller.dismissInjectedMemories());
	const body = widget.attachedBody(panel, widget.memoriesOpen);
	for (const item of rendered) {
		widget.renderInjectedMemoryRow(body, state, item);
	}
	if (collapsed.length > 0) {
		const more = DOM.append(body, DOM.$('button.knox-gui-attached-more')) as HTMLButtonElement;
		more.type = 'button';
		more.textContent = widget.showLowScoringMemories
			? t(state, 'memoryHideLowerScoring')
			: t(state, 'memoryShowLowerScoring', { count: collapsed.length });
		widget.renderStore.add(DOM.addDisposableListener(more, 'click', () => {
			widget.showLowScoringMemories = !widget.showLowScoringMemories;
			widget.render();
		}));
	}
	if (actionable.length === 0 && !timeout) {
		DOM.append(body, DOM.$('div.knox-gui-muted', undefined, t(state, 'memoryInjectNoActions')));
	}
}

export function renderInjectedMemoryRow(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiInjectedMemory): void {
	const row = DOM.append(parent, DOM.$('.knox-gui-memory-row'));
	const main = DOM.append(row, DOM.$('.knox-gui-memory-main'));
	const title = DOM.append(main, DOM.$('.knox-gui-memory-title'));
	if (item.kind === 'goal') {
		appendKnoxGuiSvg(title, 'target', 10).classList.add('knox-gui-attached-icon');
	} else if (item.pinned) {
		appendKnoxGuiSvg(title, 'pin', 10).classList.add('knox-gui-attached-icon');
	}
	DOM.append(title, DOM.$('span', undefined, item.kind === 'timeout' ? t(state, 'memoryInjectUnavailable') : item.title));
	if (item.category) {
		DOM.append(title, DOM.$('span.knox-gui-muted', undefined, `[${item.category}]`));
	} else if (item.kind === 'goal') {
		DOM.append(title, DOM.$('span.knox-gui-muted', undefined, '[C_goal]'));
	}
	if (typeof item.score === 'number' && Number.isFinite(item.score)) {
		DOM.append(title, DOM.$('span.knox-gui-muted', undefined, item.score.toFixed(2)));
	}
	DOM.append(main, DOM.$('div.knox-gui-muted', undefined, item.kind === 'timeout' ? t(state, 'memoryContextTimeoutReason') : item.reason));
	if (item.kind !== 'timeout' && item.evidence?.length) {
		const chips = DOM.append(main, DOM.$('.knox-gui-memory-evidence'));
		for (const token of item.evidence) {
			DOM.append(chips, DOM.$('span.knox-gui-memory-chip', undefined, token));
		}
	}
	if (item.id != null && item.kind === 'semantic') {
		const actions = DOM.append(row, DOM.$('.knox-gui-memory-actions'));
		const busy = widget.memoriesBusyId === item.id;
		widget.chromeButton(actions, {
			svg: item.pinned ? 'pin-off' : 'pin',
			svgSize: 12,
			title: item.pinned ? t(state, 'memoryUnpin') : t(state, 'memoryPin'),
			disabled: busy,
			onClick: () => {
				widget.memoriesBusyId = item.id;
				void widget.controller.pinInjectedMemory(item.id!, !!item.pinned).finally(() => {
					widget.memoriesBusyId = null;
					widget.render();
				});
			},
		});
		widget.chromeButton(actions, {
			svg: 'thumbs-down',
			svgSize: 12,
			title: t(state, 'memoryNotRelevant'),
			disabled: busy,
			onClick: () => {
				widget.memoriesBusyId = item.id;
				void widget.controller.mismatchInjectedMemory(item.id!).finally(() => {
					widget.memoriesBusyId = null;
					widget.render();
				});
			},
		});
		widget.chromeButton(actions, {
			svg: 'trash',
			svgSize: 12,
			title: t(state, 'memoryForget'),
			disabled: busy,
			extraClass: 'knox-gui-memory-forget',
			onClick: () => {
				widget.memoriesBusyId = item.id;
				void widget.controller.forgetInjectedMemory(item.id!).finally(() => {
					widget.memoriesBusyId = null;
					widget.render();
				});
			},
		});
	}
}

export function renderBackgroundJobsPanel(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const jobs = visibleBackgroundJobs(state);
	if (state.mode !== 'agent' || jobs.length === 0) {
		widget.clearJobClock();
		return;
	}
	const running = countRunningJobs(jobs);
	const failed = countFailedJobs(jobs);
	const canClear = jobs.some(job => job.status !== 'running');
	widget.syncJobClock(jobs);
	const panel = widget.attachedPanel(parent, 'agent-jobs-panel');
	const toggle = widget.attachedToggle(panel, state, {
		expanded: state.jobsPanelOpen,
		testId: 'agent-jobs-toggle',
		onToggle: () => widget.controller.toggleJobsPanel(),
	});
	DOM.append(toggle, DOM.$('span.knox-gui-attached-title', undefined, t(state, 'jobsCount', { count: jobs.length })));
	const stats = DOM.append(toggle, DOM.$('span.knox-gui-attached-stats'));
	if (running > 0) {
		const run = DOM.append(stats, DOM.$('span', undefined, t(state, 'jobsRunning', { count: running })));
		run.style.color = KNOX_GUI_PANEL_CYAN;
	}
	if (failed > 0) {
		DOM.append(stats, DOM.$('span.knox-gui-diff-del', undefined, t(state, 'jobsFailedCount', { count: failed })));
	}
	if (canClear) {
		const clear = DOM.append(toggle, DOM.$('span.knox-gui-attached-clear', undefined, t(state, 'jobsClearFinished')));
		clear.setAttribute('role', 'button');
		clear.tabIndex = 0;
		widget.hover(clear, t(state, 'jobsClearFinishedHint'));
		const runClear = (e: Event) => {
			e.stopPropagation();
			void widget.controller.runJobAction('clear');
		};
		widget.renderStore.add(DOM.addDisposableListener(clear, 'click', runClear));
		widget.renderStore.add(DOM.addDisposableListener(clear, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				runClear(e);
			}
		}));
	}
	const list = widget.attachedBody(panel, state.jobsPanelOpen, 'ul');
	list.classList.add('knox-gui-jobs-list');
	for (const job of jobs) {
		widget.renderJobRow(list, state, job);
	}
}

export function renderJobRow(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, job: IKnoxGuiBackgroundJob): void {
	const item = DOM.append(parent, DOM.$('li.knox-gui-job'));
	item.setAttribute('data-testid', `agent-job-${job.id}`);
	const row = DOM.append(item, DOM.$('.knox-gui-job-row'));
	const icon = DOM.append(row, DOM.$('span.knox-gui-attached-icon'));
	const failed = job.status === 'exited' && typeof job.exitCode === 'number' && job.exitCode !== 0;
	if (job.status === 'running') {
		widget.appendSpinner(icon, 12);
	} else {
		const glyph = appendKnoxGuiSvg(icon, job.kind === 'task' ? 'bot' : 'terminal', 12);
		if (failed) {
			glyph.style.color = '#f87171';
		}
	}
	const title = DOM.append(row, DOM.$('button.knox-gui-job-title')) as HTMLButtonElement;
	title.type = 'button';
	title.setAttribute('aria-label', job.title);
	widget.hover(title, t(state, 'jobsOutputHint'));
	DOM.append(title, DOM.$('span.knox-gui-job-command', undefined, truncateJobTitle(job.title)));
	if (job.detail) {
		DOM.append(title, DOM.$('span.knox-gui-job-detail.knox-gui-muted', undefined, truncateJobTitle(job.detail, 40)));
	}
	widget.renderStore.add(DOM.addDisposableListener(title, 'click', () => {
		widget.jobsLogId = widget.jobsLogId === job.id ? null : job.id;
		widget.render();
	}));
	const elapsed = job.startedAt && job.startedAt > 0
		? formatDurationMs((job.endedAt ?? widget.jobClock) - job.startedAt)
		: '';
	const statusText = job.status === 'running'
		? elapsed
		: job.status === 'killed'
			? t(state, 'jobsStatusKilled')
			: t(state, 'jobsStatusExited', { code: job.exitCode ?? '—' });
	const status = DOM.append(row, DOM.$('span.knox-gui-job-status', undefined, statusText));
	if (failed) {
		status.classList.add('failed');
	}
	if (job.status === 'running' && job.startedAt) {
		widget.jobElapsedEls.set(job.id, status);
	}
	const canKill = job.status === 'running' && !isTaskJobId(job.id);
	const canDismiss = job.kind !== 'task' && job.status !== 'running' && !isTaskJobId(job.id);
	if (canKill) {
		widget.chromeButton(row, {
			label: t(state, 'jobsKill'),
			title: t(state, 'jobsKillHint'),
			extraClass: 'knox-gui-job-kill knox-gui-text-action',
			testId: `agent-job-kill-${job.id}`,
			onClick: () => void widget.controller.runJobAction('kill', job.id),
		});
	}
	if (canDismiss) {
		widget.chromeButton(row, {
			svg: 'x',
			svgSize: 12,
			title: t(state, 'jobsDismissHint'),
			onClick: () => void widget.controller.runJobAction('dismiss', job.id),
		});
	}
	if (widget.jobsLogId === job.id) {
		const log = DOM.append(item, DOM.$('pre.knox-gui-attached-pre.knox-gui-job-log', undefined, job.output?.trim() || t(state, 'jobsNoOutput')));
		log.setAttribute('data-testid', `agent-job-log-${job.id}`);
	}
}

export function attachedPanel(widget: KnoxGuiWidget, parent: HTMLElement, testId: string): HTMLElement {
	const panel = DOM.append(parent, DOM.$('.knox-gui-attached'));
	panel.setAttribute('data-testid', testId);
	return panel;
}

export function attachedToggle(widget: KnoxGuiWidget, panel: HTMLElement, _state: IKnoxGuiState, options: { expanded: boolean; testId: string; onToggle: () => void }): HTMLButtonElement {
	const toggle = DOM.append(panel, DOM.$('button.knox-gui-attached-toggle')) as HTMLButtonElement;
	toggle.type = 'button';
	toggle.setAttribute('aria-expanded', options.expanded ? 'true' : 'false');
	toggle.setAttribute('data-testid', options.testId);
	const chevron = DOM.append(toggle, DOM.$('span.knox-gui-attached-chevron'));
	appendKnoxGuiSvg(chevron, options.expanded ? 'chevron-down' : 'chevron-right', 13);
	widget.renderStore.add(DOM.addDisposableListener(toggle, 'click', options.onToggle));
	return toggle;
}

export function attachedBody(widget: KnoxGuiWidget, panel: HTMLElement, expanded: boolean, tag: 'div' | 'ul' = 'div'): HTMLElement {
	const wrap = DOM.append(panel, DOM.$(`.knox-gui-attached-collapse${expanded ? '.open' : ''}`));
	return DOM.append(wrap, DOM.$(`${tag}.knox-gui-attached-body`));
}

export function attachedDismiss(widget: KnoxGuiWidget, parent: HTMLElement, label: string, onClick: () => void): HTMLElement {
	const btn = DOM.append(parent, DOM.$('span.knox-gui-attached-dismiss'));
	btn.setAttribute('role', 'button');
	btn.tabIndex = 0;
	btn.setAttribute('aria-label', label);
	appendKnoxGuiSvg(btn, 'x', 12);
	const run = (e: Event) => {
		e.stopPropagation();
		onClick();
	};
	widget.renderStore.add(DOM.addDisposableListener(btn, 'click', run));
	widget.renderStore.add(DOM.addDisposableListener(btn, 'keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			run(e);
		}
	}));
	return btn;
}

export function syncJobClock(widget: KnoxGuiWidget, jobs: IKnoxGuiBackgroundJob[]): void {
	widget.jobElapsedEls.clear();
	const running = jobs.some(job => job.status === 'running' && job.startedAt);
	if (running && !widget.jobClockTimer) {
		widget.jobClockTimer = setInterval(() => {
			widget.jobClock = Date.now();
			for (const [id, el] of widget.jobElapsedEls) {
				const job = widget.lastState ? visibleBackgroundJobs(widget.lastState).find(item => item.id === id) : undefined;
				if (job?.startedAt && job.status === 'running') {
					el.textContent = formatDurationMs(widget.jobClock - job.startedAt);
				}
			}
		}, 1000);
	} else if (!running) {
		widget.clearJobClock();
	}
}

export function clearJobClock(widget: KnoxGuiWidget): void {
	if (widget.jobClockTimer) {
		clearInterval(widget.jobClockTimer);
		widget.jobClockTimer = undefined;
	}
	widget.jobElapsedEls.clear();
}
