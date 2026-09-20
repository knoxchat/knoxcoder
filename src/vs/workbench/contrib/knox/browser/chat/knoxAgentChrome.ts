/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxActivityKindIcon, knoxGuiIconClass, KnoxGuiIconName } from '../knoxGuiIcons.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { KNOX_ACTIVITY_PANEL_EXPANDED_KEY } from '../../common/knoxChat.js';
import {
	buildKnoxAgentActivitySteps,
	collectKnoxTurnPromptLogs,
	currentKnoxActivityStep,
	estimateKnoxTokensFromPromptLogs,
	findLastKnoxUserIndex,
	formatKnoxDurationMs,
	formatKnoxTokenCount,
	IKnoxAgentActivityStep,
	knoxItemCreatedAtMs,
	knoxLoadingVariantFor,
	KnoxAgentActivityKind,
	KnoxAgentActivityStatus,
	knoxActivityAnchorId,
	knoxTurnElapsedMs,
	summarizeJevPromptLogs,
	summarizeKnoxActivity,
	visibleKnoxActivitySteps,
} from '../../common/knoxAgentActivity.js';
import { resolveAgentMaxSteps } from '../../common/knoxAgentMaxSteps.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { IKnoxAutonomousLoopState } from '../../common/knoxChatTypes.js';
import { hasUnsettledToolCalls } from '../../common/knoxChatHistory.js';
import { IKnoxGuiBridge } from '../../common/knoxGuiProtocol.js';
import { knoxNls } from '../../common/knoxI18n.js';
import { renderKnoxLoadingState } from './knoxLoadingState.js';

export function knoxActivityKindLabel(kind: KnoxAgentActivityKind): string {
	switch (kind) {
		case 'thinking': return localize('knox.activity.kindThinking', "Thinking");
		case 'read': return localize('knox.activity.kindRead', "Read");
		case 'search': return localize('knox.activity.kindSearch', "Search");
		case 'edit': return localize('knox.activity.kindEdit', "Edit");
		case 'test': return localize('knox.activity.kindTest', "Test");
		case 'shell': return localize('knox.activity.kindShell', "Shell");
		case 'git': return localize('knox.activity.kindGit', "Git");
		case 'task': return localize('knox.activity.kindTask', "Task");
		case 'ask': return localize('knox.activity.kindAsk', "Ask");
		case 'reply': return localize('knox.activity.kindReply', "Reply");
		default: return localize('knox.activity.kindOther', "Tool");
	}
}

function countLabel(one: string, many: string, count: number): string {
	return count === 1 ? one : many;
}

export function knoxActivitySummaryLine(steps: readonly IKnoxAgentActivityStep[]): string {
	const s = summarizeKnoxActivity(steps);
	const parts: string[] = [];
	if (s.thinking) {
		parts.push(localize('knox.activity.summaryThinking', "Thinking"));
	}
	if (s.reads) {
		parts.push(countLabel(
			localize('knox.activity.summaryRead', "{0} read", s.reads),
			localize('knox.activity.summaryReads', "{0} reads", s.reads),
			s.reads,
		));
	}
	if (s.searches) {
		parts.push(countLabel(
			localize('knox.activity.summarySearch', "{0} search", s.searches),
			localize('knox.activity.summarySearches', "{0} searches", s.searches),
			s.searches,
		));
	}
	if (s.edits) {
		parts.push(countLabel(
			localize('knox.activity.summaryEdit', "{0} edit", s.edits),
			localize('knox.activity.summaryEdits', "{0} edits", s.edits),
			s.edits,
		));
	}
	if (s.tests) {
		parts.push(countLabel(
			localize('knox.activity.summaryTest', "{0} test", s.tests),
			localize('knox.activity.summaryTests', "{0} tests", s.tests),
			s.tests,
		));
	}
	if (s.other) {
		parts.push(countLabel(
			localize('knox.activity.summaryOtherOne', "{0} other", s.other),
			localize('knox.activity.summaryOther', "{0} other", s.other),
			s.other,
		));
	}
	return parts.join(' · ') || localize('knox.activity.working', "Working…");
}

export function knoxActivityRowCountLabel(count: number): string {
	return count === 1
		? localize('knox.activity.rowOne', "{0} row", count)
		: localize('knox.activity.rowMany', "{0} rows", count);
}

function statusIcon(status: KnoxAgentActivityStatus): KnoxGuiIconName {
	if (status === 'running') {
		return 'spinner';
	}
	if (status === 'done') {
		return 'lucide-check';
	}
	if (status === 'canceled') {
		return 'x';
	}
	return 'circle-dot';
}

export function renderKnoxActivitySteps(
	container: HTMLElement,
	steps: readonly IKnoxAgentActivityStep[],
	onSelect: (step: IKnoxAgentActivityStep) => void,
	bridge: IKnoxGuiBridge,
	hoverService: IHoverService,
	notificationService: INotificationService,
	store: DisposableStore,
): void {
	clearNode(container);
	if (!steps.length) {
		return;
	}
	const list = append(container, $('ol.knox-activity-steps'));
	for (const step of steps) {
		const li = append(list, $('li.knox-activity-step'));
		const button = append(li, $<HTMLButtonElement>('button.knox-activity-step-main'));
		button.type = 'button';
		button.title = knoxActivityKindLabel(step.kind);
		const glyph = append(button, $('span.knox-activity-glyph'));
		glyph.className = `knox-activity-glyph ${knoxGuiIconClass(statusIcon(step.status))}`;
		const kindIcon = append(button, $('span.knox-activity-kind-icon'));
		kindIcon.className = knoxGuiIconClass(knoxActivityKindIcon(step.kind));
		append(button, $('span.knox-activity-kind')).textContent = knoxActivityKindLabel(step.kind);
		if (step.detail) {
			append(button, $('code.knox-activity-detail')).textContent = step.detail;
		}
		store.add(addDisposableListener(button, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			onSelect(step);
		}));
		if (step.workspaceCheckpointId) {
			const cp = append(li, $<HTMLButtonElement>('button.knox-activity-checkpoint'));
			cp.type = 'button';
			cp.textContent = `cp ${step.workspaceCheckpointId.slice(0, 8)}`;
			const tooltip = localize('knox.activity.checkpointRestore', "Restore {0} (Shift: files and memory)", step.workspaceCheckpointId);
			cp.setAttribute('aria-label', tooltip);
			store.add(hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), cp, tooltip));
			store.add(addDisposableListener(cp, 'click', async e => {
				e.preventDefault();
				e.stopPropagation();
				try {
					await bridge.request('restoreCheckpoint', {
						checkpointId: step.workspaceCheckpointId,
						rewindMemory: e.shiftKey,
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					notificationService.error(localize('knox.restoreFailedDetail', "Could not restore the checkpoint: {0}", message));
				}
			}));
		}
	}
}

export function renderKnoxActivityTimeline(
	container: HTMLElement,
	steps: readonly IKnoxAgentActivityStep[],
	expanded: boolean,
	onToggle: (expanded: boolean) => void,
	onSelect: (step: IKnoxAgentActivityStep) => void,
	bridge: IKnoxGuiBridge,
	hoverService: IHoverService,
	notificationService: INotificationService,
	store: DisposableStore,
): void {
	clearNode(container);
	if (!steps.length) {
		return;
	}
	const root = append(container, $('.knox-activity-timeline'));
	const { visible, hiddenCount } = visibleKnoxActivitySteps(steps, expanded);

	const toggle = append(root, $<HTMLButtonElement>('button.knox-activity-summary'));
	toggle.type = 'button';
	toggle.title = localize('knox.activity.timeline', "Agent activity");
	append(toggle, $('span.knox-activity-summary-text')).textContent = knoxActivitySummaryLine(steps);
	append(toggle, $('span.knox-activity-summary-count')).textContent = knoxActivityRowCountLabel(steps.length);
	store.add(addDisposableListener(toggle, 'click', e => {
		e.preventDefault();
		e.stopPropagation();
		onToggle(!expanded);
	}));

	const body = append(root, $('.knox-activity-timeline-body'));
	if (hiddenCount > 0) {
		const earlier = append(body, $<HTMLButtonElement>('button.knox-activity-earlier'));
		earlier.type = 'button';
		earlier.textContent = localize('knox.activity.showEarlier', "Show {0} earlier rows", hiddenCount);
		store.add(addDisposableListener(earlier, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			onToggle(true);
		}));
	}
	const stepsHost = append(body, $('.knox-activity-steps-host'));
	renderKnoxActivitySteps(stepsHost, visible, onSelect, bridge, hoverService, notificationService, store);
}

function autonomousBannerCopy(loop: IKnoxAutonomousLoopState): string {
	const unlimited = loop.maxIterations <= 0;
	if (loop.status === 'completed') {
		return unlimited
			? localize('knox.autonomous.completedUnlimited', "Autonomous finished · {0}", loop.iteration)
			: localize('knox.autonomous.completed', "Autonomous finished · {0}/{1}", loop.iteration, loop.maxIterations);
	}
	if (loop.status === 'cancelled') {
		return unlimited
			? localize('knox.autonomous.cancelledUnlimited', "Autonomous stopped · {0}", loop.iteration)
			: localize('knox.autonomous.cancelled', "Autonomous stopped · {0}/{1}", loop.iteration, loop.maxIterations);
	}
	return unlimited
		? localize('knox.autonomous.runningUnlimited', "Autonomous {0}", loop.iteration)
		: localize('knox.autonomous.running', "Autonomous {0}/{1}", loop.iteration, loop.maxIterations);
}

export function renderKnoxAutonomousBanner(
	container: HTMLElement,
	loop: IKnoxAutonomousLoopState,
): void {
	clearNode(container);
	if (loop.status === 'idle') {
		container.classList.add('hidden');
		return;
	}
	container.classList.remove('hidden');
	const max = loop.maxIterations;
	const unlimited = max <= 0;
	const nearCap = !unlimited && max > 0 && loop.iteration / max >= 0.8;
	const progress = unlimited ? null : Math.min(100, Math.round((loop.iteration / max) * 100));

	const row = append(container, $('.knox-autonomous-banner-row'));
	const glyph = append(row, $('span.knox-activity-glyph'));
	glyph.className = knoxGuiIconClass(loop.status === 'running' ? 'spinner' : loop.status === 'completed' ? 'lucide-check' : 'x');
	const bot = append(row, $('span'));
	bot.className = knoxGuiIconClass('bot');
	const label = append(row, $('span.knox-autonomous-label'));
	label.textContent = autonomousBannerCopy(loop);
	label.classList.toggle('near-cap', nearCap);
	if (loop.goal) {
		label.title = loop.goal;
		const goal = append(row, $('span.knox-autonomous-goal'));
		goal.textContent = loop.goal;
		goal.title = loop.goal;
	}
	if (progress !== null) {
		const bar = append(container, $('div.knox-progress'));
		bar.setAttribute('role', 'progressbar');
		bar.setAttribute('aria-valuenow', String(loop.iteration));
		bar.setAttribute('aria-valuemin', '0');
		bar.setAttribute('aria-valuemax', String(max));
		const fill = append(bar, $('div.knox-progress-fill'));
		fill.classList.toggle('near-cap', nearCap);
		fill.style.width = `${progress}%`;
	}
}

export class KnoxAgentTurnMeter extends Disposable {

	readonly element: HTMLElement;

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	private readonly _onDidSelectStep = this._register(new Emitter<IKnoxAgentActivityStep>());
	readonly onDidSelectStep = this._onDidSelectStep.event;

	private readonly _banner: HTMLElement;
	private readonly _toggle: HTMLButtonElement;
	private readonly _chevron: HTMLElement;
	private readonly _loadingHost: HTMLElement;
	private readonly _meta: HTMLElement;
	private readonly _jev: HTMLElement;
	private readonly _count: HTMLElement;
	private readonly _progress: HTMLElement;
	private readonly _progressFill: HTMLElement;
	private readonly _stepsHost: HTMLElement;
	private readonly _stepsScroll: HTMLElement;
	private readonly _contentStore = this._register(new DisposableStore());
	private _open: boolean;

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@IStorageService private readonly _storageService: IStorageService,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
		@IHoverService private readonly _hoverService: IHoverService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		super();
		this._open = this._storageService.getBoolean(KNOX_ACTIVITY_PANEL_EXPANDED_KEY, StorageScope.PROFILE, false);

		this.element = append(parent, $('.knox-turn-meter.hidden'));
		this._banner = append(this.element, $('.knox-autonomous-banner'));
		this._toggle = append(this.element, $<HTMLButtonElement>('button.knox-turn-meter-toggle'));
		this._toggle.type = 'button';
		this._chevron = append(this._toggle, $('span.knox-turn-meter-chevron'));
		this._loadingHost = append(this._toggle, $('.knox-turn-meter-loading'));
		this._meta = append(this._toggle, $('span.knox-turn-meter-meta'));
		this._jev = append(this._toggle, $('span.knox-turn-meter-jev.hidden'));
		this._jev.setAttribute('data-testid', 'agent-turn-meter-jev');
		this._count = append(this._toggle, $('span.knox-turn-meter-count'));
		this._progress = append(this.element, $('div.knox-progress.hidden'));
		this._progress.setAttribute('role', 'progressbar');
		this._progressFill = append(this._progress, $('div.knox-progress-fill'));
		this._stepsScroll = append(this.element, $('.knox-turn-meter-steps.hidden'));
		this._stepsHost = append(this._stepsScroll, $('.knox-activity-steps-host'));

		this._register(this._chatService.onDidChange(() => this._render()));
		this._register(addDisposableListener(this._toggle, 'click', () => this._onToggle()));
		this._render();
	}

	private _onToggle(): void {
		const history = this._chatService.history;
		const userIndex = findLastKnoxUserIndex(history);
		const steps = buildKnoxAgentActivitySteps(history, userIndex, { inProgress: this._chatService.isStreaming });
		if (!steps.length) {
			return;
		}
		this._open = !this._open;
		this._storageService.store(KNOX_ACTIVITY_PANEL_EXPANDED_KEY, this._open, StorageScope.PROFILE, StorageTarget.MACHINE);
		this._render();
		this._onDidChangeHeight.fire();
	}

	private _render(): void {
		this._contentStore.clear();
		const history = this._chatService.history;
		const isStreaming = this._chatService.isStreaming;
		const loop = this._chatService.autonomousLoop;
		const toolLoopSteps = this._chatService.toolLoopSteps;
		const userIndex = findLastKnoxUserIndex(history);
		const steps = buildKnoxAgentActivitySteps(history, userIndex, { inProgress: isStreaming });
		const current = currentKnoxActivityStep(steps);
		const autonomousActive = loop.status !== 'idle';
		const unsettled = hasUnsettledToolCalls(history);
		const live = isStreaming || unsettled;
		const canExpand = steps.length > 0;

		if (userIndex < 0 && !isStreaming && !autonomousActive) {
			this.element.classList.add('hidden');
			this._onDidChangeHeight.fire();
			return;
		}
		if (!steps.length && !isStreaming && toolLoopSteps === 0 && !autonomousActive) {
			this.element.classList.add('hidden');
			this._onDidChangeHeight.fire();
			return;
		}

		this.element.classList.remove('hidden');
		renderKnoxAutonomousBanner(this._banner, loop);

		this._chevron.className = `knox-turn-meter-chevron ${knoxGuiIconClass(this._open && canExpand ? 'lucide-chevron-down' : 'lucide-chevron-right')}`;
		this._chevron.classList.toggle('hidden', !canExpand);
		this._toggle.classList.toggle('clickable', canExpand);
		this._toggle.setAttribute('aria-expanded', String(canExpand && this._open));
		this._toggle.title = canExpand ? localize('knox.activity.timeline', "Agent activity") : '';

		clearNode(this._loadingHost);
		if (live) {
			this._loadingHost.classList.remove('hidden');
			renderKnoxLoadingState(this._loadingHost, {
				label: current ? knoxActivityKindLabel(current.kind) : localize('knox.activity.loading', "Working"),
				variant: knoxLoadingVariantFor(current?.kind),
				startedAt: knoxItemCreatedAtMs(history[userIndex]),
			}, this._contentStore);
		} else {
			this._loadingHost.classList.add('hidden');
		}

		const maxSteps = resolveAgentMaxSteps(
			this._chatService.config?.experimental?.agentMaxSteps,
			this._chatService.config?.experimental?.agentProfile,
		);
		const nearCap = maxSteps !== null && maxSteps > 0 && toolLoopSteps / maxSteps >= 0.8;
		const stepsLabel = maxSteps === null
			? localize('knox.activity.stepsUnlimited', "{0} steps", toolLoopSteps)
			: localize('knox.activity.stepsUsed', "{0}/{1} steps", toolLoopSteps, maxSteps);
		const profile = this._chatService.config?.experimental?.agentProfile;
		const profileLabel = profile === 'systems'
			? localize('knox.activity.profileSystems', "systems")
			: profile === 'rust'
				? localize('knox.activity.profileRust', "rust")
				: undefined;
		const tokens = estimateKnoxTokensFromPromptLogs(collectKnoxTurnPromptLogs(history, userIndex));
		const elapsed = knoxTurnElapsedMs(history, userIndex, Date.now(), live);

		const bits: string[] = [stepsLabel];
		if (profileLabel) {
			bits.push(profileLabel);
		}
		if (autonomousActive) {
			bits.push(loop.maxIterations > 0
				? localize('knox.activity.autonomous', "{0}/{1} outer", loop.iteration, loop.maxIterations)
				: localize('knox.activity.autonomousUnlimited', "{0} outer", loop.iteration));
		}
		if (tokens > 0) {
			bits.push(localize('knox.activity.tokens', "~{0} tok", formatKnoxTokenCount(tokens)));
		}
		if (!live && elapsed > 0) {
			bits.push(formatKnoxDurationMs(elapsed));
		}
		this._meta.textContent = bits.join('  ');
		this._meta.classList.toggle('near-cap', nearCap);
		const jevSummary = summarizeJevPromptLogs(collectKnoxTurnPromptLogs(history, userIndex));
		if (jevSummary?.route) {
			this._jev.classList.remove('hidden');
			this._jev.textContent = jevSummary.skill
				? knoxNls('activityJevSkill', { route: jevSummary.route, skill: jevSummary.skill }, 'jev {{route}} · {{skill}}')
				: knoxNls('activityJev', { route: jevSummary.route }, 'jev {{route}}');
		} else {
			this._jev.classList.add('hidden');
			this._jev.textContent = '';
		}

		this._count.textContent = canExpand ? knoxActivityRowCountLabel(steps.length) : '';
		this._count.classList.toggle('hidden', !canExpand);

		const progress = maxSteps !== null && maxSteps > 0
			? Math.min(100, Math.round((toolLoopSteps / maxSteps) * 100))
			: null;
		if (progress !== null && (live || toolLoopSteps > 0)) {
			this._progress.classList.remove('hidden');
			this._progress.setAttribute('aria-valuenow', String(toolLoopSteps));
			this._progress.setAttribute('aria-valuemax', String(maxSteps));
			this._progressFill.style.width = `${progress}%`;
			this._progressFill.classList.toggle('near-cap', nearCap);
		} else {
			this._progress.classList.add('hidden');
		}

		const showSteps = this._open && canExpand;
		this._stepsScroll.classList.toggle('hidden', !showSteps);
		if (showSteps) {
			renderKnoxActivitySteps(
				this._stepsHost,
				steps,
				step => this._onDidSelectStep.fire(step),
				this._bridge,
				this._hoverService,
				this._notificationService,
				this._contentStore,
			);
			if (live) {
				this._stepsScroll.scrollTop = this._stepsScroll.scrollHeight;
			}
		} else {
			clearNode(this._stepsHost);
		}

		this._onDidChangeHeight.fire();
	}

	revealStep(step: IKnoxAgentActivityStep): void {
		const el = this.element.ownerDocument.getElementById(knoxActivityAnchorId(step.id));
		el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}
}
