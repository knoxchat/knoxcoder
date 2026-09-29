/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { appendKnoxGuiSvg, KnoxGuiSvgIcon } from '../../knoxGuiIcons.js';
import { renderLoadingState } from '../panels.js';
import { IKnoxGuiHistoryItem, IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import {
	activityAnchorId,
	activityKindLabelKey,
	activitySummaryLine,
	buildAgentActivitySteps,
	IKnoxGuiActivityStep,
	itemCreatedAtMs,
	KnoxGuiActivityKind,
	visibleActivitySteps,
} from '../../../../common/knoxGuiTranscript.js';

/** `HistoryItemRow.tsx` chat/edit turn: `LoadingState` with the user message time as the timer origin. */
export function renderTurnLoading(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item?: IKnoxGuiHistoryItem): void {
	const row = DOM.append(parent, DOM.$('.knox-gui-turn-loading'));
	row.setAttribute('data-testid', 'knox-gui-turn-loading');
	row.style.fontSize = `${state.fontSize - 2}px`;
	renderLoadingState(widget, row, {
		label: t(state, 'activityLoading'),
		variant: 'drive',
		startedAt: itemCreatedAtMs(item),
		testId: 'sent-message-loading-state',
		ownClock: true,
	});
}

export function renderActivityTimeline(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, userIndex: number): void {
	const steps = buildAgentActivitySteps(state.history, userIndex);
	if (!steps.length) {
		return;
	}
	const expanded = widget.activityExpanded.has(userIndex);
	const { visible, hiddenCount } = visibleActivitySteps(steps, expanded);
	const wrap = DOM.append(parent, DOM.$('.knox-gui-activity'));
	wrap.setAttribute('data-testid', 'agent-activity-timeline');
	wrap.style.fontSize = `${state.fontSize - 2}px`;
	const toggle = DOM.append(wrap, DOM.$('button.knox-gui-activity-summary')) as HTMLButtonElement;
	toggle.type = 'button';
	widget.hover(toggle, t(state, 'activityTimeline'));
	DOM.append(toggle, DOM.$('span.knox-gui-activity-summary-text', undefined, activitySummaryLine((key, vars) => t(state, key, vars), steps)));
	DOM.append(toggle, DOM.$('span.knox-gui-muted', undefined, t(state, steps.length === 1 ? 'activityRowCount' : 'activityRowCount_plural', { count: steps.length })));
	widget.renderStore.add(DOM.addDisposableListener(toggle, 'click', () => {
		if (expanded) {
			widget.activityExpanded.delete(userIndex);
		} else {
			widget.activityExpanded.add(userIndex);
		}
		widget.render();
	}));
	if (hiddenCount > 0) {
		widget.chromeButton(wrap, {
			label: t(state, 'activityShowEarlier', { count: hiddenCount }),
			extraClass: 'knox-gui-activity-earlier knox-gui-text-action',
			onClick: () => {
				widget.activityExpanded.add(userIndex);
				widget.render();
			},
		});
	}
	widget.renderActivitySteps(wrap, state, visible);
}

export function renderActivitySteps(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, steps: IKnoxGuiActivityStep[]): void {
	const list = DOM.append(parent, DOM.$('ol.knox-gui-activity-steps'));
	list.setAttribute('data-testid', 'agent-activity-step-list');
	for (const step of steps) {
		const li = DOM.append(list, DOM.$('li.knox-gui-activity-step'));
		const row = DOM.append(li, DOM.$('button.knox-gui-activity-step-btn')) as HTMLButtonElement;
		row.type = 'button';
		widget.hover(row, t(state, activityKindLabelKey(step.kind)));
		const glyph = DOM.append(row, DOM.$('span.knox-gui-activity-status'));
		if (step.status === 'running') {
			widget.appendSpinner(glyph, 12);
		} else if (step.status === 'done') {
			appendKnoxGuiSvg(glyph, 'check', 12).classList.add('knox-gui-activity-done');
		} else if (step.status === 'canceled') {
			appendKnoxGuiSvg(glyph, 'x', 12).classList.add('knox-gui-activity-canceled');
		} else {
			DOM.append(glyph, DOM.$('span.knox-gui-activity-pending'));
		}
		const kind = DOM.append(row, DOM.$('span.knox-gui-activity-kind'));
		appendKnoxGuiSvg(kind, activityKindSvg(step.kind), 12);
		DOM.append(row, DOM.$('span.knox-gui-activity-label', undefined, t(state, activityKindLabelKey(step.kind))));
		if (step.detail) {
			DOM.append(row, DOM.$('code.knox-gui-muted', undefined, step.detail));
		}
		widget.renderStore.add(DOM.addDisposableListener(row, 'click', () => {
			widget.scrollToHistoryIndex(step.historyIndex);
			requestAnimationFrame(() => {
				widget.root.ownerDocument.getElementById(activityAnchorId(step.id))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			});
		}));
		if (step.workspaceCheckpointId) {
			const restore = DOM.append(li, DOM.$('button.knox-gui-activity-cp')) as HTMLButtonElement;
			restore.type = 'button';
			restore.textContent = `cp ${step.workspaceCheckpointId.slice(0, 8)}`;
			widget.hover(restore, t(state, 'activityCheckpointRestore', { id: step.workspaceCheckpointId }));
			widget.renderStore.add(DOM.addDisposableListener(restore, 'click', (event: MouseEvent) => {
				event.stopPropagation();
				widget.controller.restoreCheckpoint(step.workspaceCheckpointId!, event.shiftKey);
			}));
		}
	}
}

function activityKindSvg(kind: KnoxGuiActivityKind): KnoxGuiSvgIcon {
	switch (kind) {
		case 'thinking': return 'sparkles';
		case 'read': return 'file-text';
		case 'search': return 'search';
		case 'edit': return 'file-pen-line';
		case 'test': return 'test-tube';
		case 'shell': return 'terminal';
		case 'git': return 'git-branch';
		case 'task': return 'bot';
		case 'ask': return 'message-circle-question';
		case 'reply': return 'message-square';
		default: return 'wrench';
	}
}
