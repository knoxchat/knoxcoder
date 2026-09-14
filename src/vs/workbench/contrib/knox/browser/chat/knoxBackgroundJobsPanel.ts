/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass } from '../knoxGuiIcons.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { formatKnoxDurationMs } from '../../common/knoxAgentActivity.js';
import {
	isKnoxTaskJobId,
	knoxCountRunningJobs,
	knoxMergeBackgroundJobs,
	knoxCollectRunningTaskJobs,
	knoxTruncateJobTitle,
} from '../../common/knoxBackgroundJobs.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { IKnoxBackgroundJob } from '../../common/knoxChatTypes.js';
import { KnoxAttachedPanel } from './knoxAttachedPanel.js';

/**
 * Shell + builtin_task background jobs (T5.13).
 */
export class KnoxBackgroundJobsPanel extends Disposable {

	private readonly _panel: KnoxAttachedPanel;
	private readonly _clear: HTMLButtonElement;
	private readonly _contentStore = this._register(new DisposableStore());
	private readonly _hoverStore = this._register(new DisposableStore());
	private _openLogId: string | null = null;
	private _now = Date.now();
	private _tick: ReturnType<typeof setInterval> | undefined;

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@IHoverService private readonly _hoverService: IHoverService,
	) {
		super();
		this._panel = this._register(new KnoxAttachedPanel(parent, 'agent-jobs-panel', this._chatService.jobsPanelOpen));
		this._clear = append(this._panel.extra, $<HTMLButtonElement>('button.knox-attached-text-action'));
		this._clear.type = 'button';
		this._clear.textContent = localize('knox.jobsClearFinished', "Clear");
		this._register(addDisposableListener(this._clear, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			void this._chatService.runAgentJobAction('clear');
		}));
		this._register(addDisposableListener(this._panel.toggle, 'click', () => {
			this._chatService.setJobsPanelOpen(this._panel.open);
		}));
		this._register(this._panel.onDidChangeHeight(() => this._onDidChangeHeight.fire()));
		this._register(this._chatService.onDidChange(() => this._render()));
		this._render();
	}

	override dispose(): void {
		this._stopTick();
		super.dispose();
	}

	private _jobs(): IKnoxBackgroundJob[] {
		return knoxMergeBackgroundJobs(
			this._chatService.backgroundJobs,
			knoxCollectRunningTaskJobs(this._chatService.history),
		);
	}

	private _syncTick(running: number): void {
		if (running === 0) {
			this._stopTick();
			return;
		}
		if (this._tick) {
			return;
		}
		this._tick = setInterval(() => {
			this._now = Date.now();
			this._render();
		}, 1000);
	}

	private _stopTick(): void {
		if (this._tick) {
			clearInterval(this._tick);
			this._tick = undefined;
		}
	}

	private _render(): void {
		this._contentStore.clear();
		this._hoverStore.clear();
		const mode = this._chatService.mode;
		const jobs = this._jobs();
		const visible = mode === 'agent' && jobs.length > 0;
		if (!visible) {
			this._stopTick();
			this._panel.setVisible(false);
			return;
		}
		if (this._panel.open !== this._chatService.jobsPanelOpen) {
			this._panel.setOpen(this._chatService.jobsPanelOpen);
		}
		this._panel.setVisible(true);
		const running = knoxCountRunningJobs(jobs);
		this._syncTick(running);
		const failed = jobs.filter(job => job.status === 'exited' && typeof job.exitCode === 'number' && job.exitCode !== 0).length;
		this._panel.title.textContent = jobs.length === 1
			? localize('knox.jobsCountOne', "1 background job")
			: localize('knox.jobsCountMany', "{0} background jobs", jobs.length);
		const bits: string[] = [];
		if (running > 0) {
			bits.push(localize('knox.jobsRunning', "{0} running", running));
		}
		if (failed > 0) {
			bits.push(localize('knox.jobsFailedCount', "{0} failed", failed));
		}
		this._panel.meta.textContent = bits.join('  ');
		const canClear = jobs.some(job => job.status !== 'running');
		this._clear.classList.toggle('hidden', !canClear);
		const clearHint = localize('knox.jobsClearFinishedHint', "Remove finished jobs from the list");
		this._clear.setAttribute('aria-label', clearHint);
		this._hoverStore.add(this._hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), this._clear, clearHint));

		clearNode(this._panel.body);
		const list = append(this._panel.body, $('ul.knox-jobs-list'));
		for (const job of jobs) {
			this._renderJob(list, job);
		}
	}

	private _renderJob(list: HTMLElement, job: IKnoxBackgroundJob): void {
		const li = append(list, $('li.knox-job'));
		li.setAttribute('data-testid', `agent-job-${job.id}`);
		const row = append(li, $('.knox-job-row'));
		const failed = job.status === 'exited' && typeof job.exitCode === 'number' && job.exitCode !== 0;
		const glyph = append(row, $('span.knox-job-glyph'));
		glyph.className = `knox-job-glyph ${knoxGuiIconClass(
			job.status === 'running' ? 'spinner' : (job.kind === 'task' ? 'bot' : 'terminal'),
		)}`;
		glyph.classList.toggle('failed', failed);
		const title = append(row, $<HTMLButtonElement>('button.knox-job-title'));
		title.type = 'button';
		title.title = localize('knox.jobsOutputHint', "Show command output");
		title.textContent = knoxTruncateJobTitle(job.title);
		if (job.detail) {
			append(title, $('span.knox-job-detail')).textContent = ` ${knoxTruncateJobTitle(job.detail, 40)}`;
		}
		this._contentStore.add(addDisposableListener(title, 'click', () => {
			this._openLogId = this._openLogId === job.id ? null : job.id;
			this._render();
		}));
		const elapsed = job.startedAt && job.startedAt > 0
			? formatKnoxDurationMs((job.endedAt ?? this._now) - job.startedAt)
			: '';
		const status = append(row, $('span.knox-job-status'));
		status.classList.toggle('failed', failed);
		status.textContent = job.status === 'running'
			? elapsed
			: job.status === 'killed'
				? localize('knox.jobsStatusKilled', "stopped")
				: localize('knox.jobsStatusExited', "exit {0}", job.exitCode ?? '—');
		const canKill = job.status === 'running' && !isKnoxTaskJobId(job.id);
		const canDismiss = job.kind === 'shell' && job.status !== 'running' && !isKnoxTaskJobId(job.id);
		if (canKill) {
			const kill = append(row, $<HTMLButtonElement>('button.knox-job-kill'));
			kill.type = 'button';
			kill.textContent = localize('knox.jobsKill', "Kill");
			const killHint = localize('knox.jobsKillHint', "Stop this background command");
			kill.setAttribute('aria-label', killHint);
			this._hoverStore.add(this._hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), kill, killHint));
			this._contentStore.add(addDisposableListener(kill, 'click', () => void this._chatService.runAgentJobAction('kill', job.id)));
		}
		if (canDismiss) {
			const dismiss = append(row, $<HTMLButtonElement>('button.knox-attached-dismiss'));
			dismiss.type = 'button';
			const dismissHint = localize('knox.jobsDismissHint', "Remove from the list");
			dismiss.setAttribute('aria-label', dismissHint);
			const glyph = append(dismiss, $('span'));
			glyph.className = knoxGuiIconClass('x');
			this._hoverStore.add(this._hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), dismiss, dismissHint));
			this._contentStore.add(addDisposableListener(dismiss, 'click', () => void this._chatService.runAgentJobAction('dismiss', job.id)));
		}
		if (this._openLogId === job.id) {
			const log = append(li, $('pre.knox-attached-pre.knox-job-log'));
			log.setAttribute('data-testid', `agent-job-log-${job.id}`);
			log.textContent = job.output?.trim() || localize('knox.jobsNoOutput', "No output yet");
		}
	}
}
