/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass, KnoxGuiIconName } from '../knoxGuiIcons.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import {
	IKnoxLivePlanStep,
	IKnoxLiveTaskPlan,
	knoxCollectLatestTaskPlanSnapshot,
	knoxApplyLivePlanProgress,
	knoxTaskPlanFillPercent,
	knoxTaskPlanFingerprint,
	knoxTaskPlanStructureKey,
	KnoxPlanStepStatus,
} from '../../common/knoxTaskPlan.js';
import { KnoxAttachedPanel } from './knoxAttachedPanel.js';

function statusLabel(status: KnoxPlanStepStatus): string {
	switch (status) {
		case 'in_progress': return localize('knox.taskPlanStatusActive', "In progress");
		case 'done': return localize('knox.taskPlanStatusDone', "Done");
		case 'skipped': return localize('knox.taskPlanStatusSkipped', "Skipped");
		default: return localize('knox.taskPlanStatusPending', "Pending");
	}
}

function statusIcon(status: KnoxPlanStepStatus): KnoxGuiIconName {
	switch (status) {
		case 'done': return 'check-square';
		case 'in_progress': return 'square';
		case 'skipped': return 'minus';
		default: return 'square';
	}
}

/**
 * Latest builtin_plan + live step status (T5.9).
 */
export class KnoxTaskPlanPanel extends Disposable {

	private readonly _panel: KnoxAttachedPanel;
	private readonly _dismiss: HTMLButtonElement;
	private readonly _contentStore = this._register(new DisposableStore());
	private _dismissedKey: string | null = null;
	private _prevStructure = '';

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
	) {
		super();
		this._panel = this._register(new KnoxAttachedPanel(parent, 'task-plan-panel', true));
		this._panel.setIcon('list-checks');
		this._panel.title.textContent = localize('knox.taskPlanTitle', "Task plan");
		this._dismiss = append(this._panel.extra, $<HTMLButtonElement>('button.knox-attached-dismiss'));
		this._dismiss.type = 'button';
		this._dismiss.setAttribute('aria-label', localize('knox.taskPlanDismiss', "Dismiss"));
		const glyph = append(this._dismiss, $('span'));
		glyph.className = knoxGuiIconClass('x');
		this._register(addDisposableListener(this._dismiss, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			const snapshot = knoxCollectLatestTaskPlanSnapshot(this._chatService.history);
			if (snapshot) {
				this._dismissedKey = knoxTaskPlanFingerprint(snapshot.plan);
			}
			this._render();
		}));
		this._register(this._panel.onDidChangeHeight(() => this._onDidChangeHeight.fire()));
		this._register(this._chatService.onDidChange(() => this._render()));
		this._render();
	}

	private _livePlan(): { plan: IKnoxLiveTaskPlan; fingerprint: string; structure: string } | undefined {
		const snapshot = knoxCollectLatestTaskPlanSnapshot(this._chatService.history);
		if (!snapshot) {
			return undefined;
		}
		return {
			plan: knoxApplyLivePlanProgress(snapshot.plan, this._chatService.history, snapshot.historyIndex),
			fingerprint: knoxTaskPlanFingerprint(snapshot.plan),
			structure: knoxTaskPlanStructureKey(snapshot.plan),
		};
	}

	private _render(): void {
		this._contentStore.clear();
		const live = this._livePlan();
		if (!live || this._dismissedKey === live.fingerprint) {
			this._panel.setVisible(false);
			return;
		}
		if (live.structure && live.structure !== this._prevStructure) {
			this._panel.setOpen(true);
		}
		this._prevStructure = live.structure;
		this._panel.setVisible(true);
		this._panel.setIcon(live.plan.updating ? 'spinner' : 'list-checks');

		const bits: string[] = [];
		if (live.plan.steps.length > 0) {
			bits.push(live.plan.remaining === 0
				? localize('knox.taskPlanAllDone', "All done")
				: localize('knox.taskPlanFraction', "{0}/{1}", live.plan.doneCount, live.plan.steps.length));
		} else {
			bits.push(localize('knox.taskPlanEmpty', "No steps yet"));
		}
		if (live.plan.current) {
			bits.push(live.plan.current.title);
		}
		this._panel.meta.textContent = bits.join('  ');
		this._panel.setProgress(knoxTaskPlanFillPercent(live.plan));

		clearNode(this._panel.body);
		const header = append(this._panel.body, $('.knox-task-plan-header'));
		append(header, $('span.knox-task-plan-name')).textContent = live.plan.title;
		if (live.plan.remaining > 0) {
			append(header, $('span.knox-task-plan-remaining')).textContent = localize(
				'knox.taskPlanProgress',
				"{0} remaining / {1} total",
				live.plan.remaining,
				live.plan.steps.length,
			);
		}
		if (live.plan.steps.length === 0) {
			append(this._panel.body, $('div.knox-attached-empty')).textContent = localize('knox.taskPlanEmpty', "No steps yet");
			return;
		}
		live.plan.steps.forEach((step, index) => this._renderStep(step, index));
	}

	private _renderStep(step: IKnoxLivePlanStep, index: number): void {
		const row = append(this._panel.body, $('.knox-task-plan-step'));
		row.setAttribute('data-testid', `task-plan-step-${step.id}`);
		row.setAttribute('data-status', step.status);
		row.classList.toggle('active', step.status === 'in_progress');
		row.classList.toggle('muted', step.status === 'done' || step.status === 'skipped');
		row.classList.toggle('skipped', step.status === 'skipped');
		const label = [statusLabel(step.status), step.activity].filter(Boolean).join(' · ');
		row.title = label;
		row.setAttribute('aria-label', `${index + 1}. ${step.title} (${label})`);
		const glyph = append(row, $('span.knox-task-plan-glyph'));
		glyph.className = `knox-task-plan-glyph ${knoxGuiIconClass(statusIcon(step.status))}`;
		const title = append(row, $('span.knox-task-plan-step-title'));
		append(title, $('span.knox-task-plan-index')).textContent = `${index + 1}.`;
		append(title, $('span')).textContent = ` ${step.title}`;
	}
}
