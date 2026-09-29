/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { isMacintosh } from '../../../../../../../base/common/platform.js';
import {
	knoxGuiShowsChatPermissionBar,
	knoxGuiShowsChatToolButtons,
	knoxGuiShowsComposerAcceptReject,
	knoxGuiShowsBatchDiffEntry,
	knoxGuiAcceptRejectLabelKeys,
	knoxGuiAcceptRejectWidthKeys,
	knoxGuiAcceptRejectShortcut,
} from '../../../../common/knoxGuiChrome.js';
import { findCurrentToolCall, toolDisplayKind } from '../../../../common/knoxGuiChat.js';
import { isSingleRangeEdit } from '../../../../common/knoxGuiInput.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { pendingApplyStates } from '../../../../common/knoxGuiTranscript.js';

export function renderAcceptRejectAll(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, options?: { singleRange?: boolean }): void { // KN-377
	const pending = pendingApplyStates(state.applyStates);
	if (!pending.length) {
		return;
	}
	const singleRange = options?.singleRange ?? isSingleRangeEdit(state);
	if (options === undefined && knoxGuiShowsBatchDiffEntry(pending.length > 0, singleRange)) {
		const bar = DOM.append(parent, DOM.$('.knox-gui-accept-reject-all'));
		bar.setAttribute('data-composer-slot', 'acceptRejectAll');
		bar.setAttribute('data-testid', 'knox-gui-batch-diff-open');
		widget.chromeButton(bar, {
			svg: 'package',
			svgSize: 16,
			label: t(state, 'batchDiff'),
			testId: 'knox-gui-batch-diff-open-button',
			onClick: () => widget.controller.store.navigate('/batch-diff'),
		});
		return;
	}
	if (options === undefined && !knoxGuiShowsComposerAcceptReject(pending.length > 0, singleRange)) {
		return;
	}
	const keys = knoxGuiAcceptRejectLabelKeys(singleRange);
	const widths = knoxGuiAcceptRejectWidthKeys();
	const rejectLabel = singleRange
		? `${t(state, keys.reject)} (${knoxGuiAcceptRejectShortcut(isMacintosh, 'reject')})`
		: undefined;
	const acceptLabel = singleRange
		? `${t(state, keys.accept)} (${knoxGuiAcceptRejectShortcut(isMacintosh, 'accept')})`
		: undefined;
	const bar = DOM.append(parent, DOM.$('.knox-gui-accept-reject-all'));
	bar.setAttribute('data-composer-slot', 'acceptRejectAll');
	bar.setAttribute('data-testid', 'knox-gui-accept-reject-all');
	if (state.isStreaming) {
		bar.classList.add('knox-gui-accept-reject-streaming');
	}
	const reject = widget.chromeButton(bar, {
		svg: 'x',
		svgSize: 16,
		label: rejectLabel,
		testId: 'edit-reject-button',
		extraClass: 'knox-gui-reject',
		disabled: state.isStreaming,
		onClick: () => widget.controller.rejectAllApplies(),
	});
	const accept = widget.chromeButton(bar, {
		svg: 'check',
		svgSize: 16,
		label: acceptLabel,
		testId: 'edit-accept-button',
		extraClass: 'knox-gui-accept',
		disabled: state.isStreaming,
		onClick: () => widget.controller.acceptAllApplies(),
	});
	if (!singleRange) {
		DOM.append(reject, DOM.$('span.knox-gui-ar-short', undefined, t(state, widths.short.reject)));
		DOM.append(reject, DOM.$('span.knox-gui-ar-mid', undefined, t(state, widths.mid.reject)));
		DOM.append(reject, DOM.$('span.knox-gui-ar-long', undefined, t(state, widths.long.reject)));
		DOM.append(accept, DOM.$('span.knox-gui-ar-short', undefined, t(state, widths.short.accept)));
		DOM.append(accept, DOM.$('span.knox-gui-ar-mid', undefined, t(state, widths.mid.accept)));
		DOM.append(accept, DOM.$('span.knox-gui-ar-long', undefined, t(state, widths.long.accept)));
	}
}

export function renderChatPermissionBar(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const call = findCurrentToolCall(state.history);
	if (!knoxGuiShowsChatToolButtons(call)) {
		return;
	}
	if (call.status === 'generated' && !knoxGuiShowsChatPermissionBar(call, { toolSettings: state.toolSettings, sessionAllowlist: state.sessionToolAllowlist })) {
		return;
	}
	const bar = DOM.append(parent, DOM.$('.knox-gui-chat-tool-buttons'));
	bar.setAttribute('data-composer-slot', 'pendingToolBar');
	bar.setAttribute('data-testid', 'knox-gui-chat-tool-buttons');
	widget.renderToolActions(bar, state, call, toolDisplayKind(call.name), { placement: 'chat' });
}

export function renderContextPeek(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	if (!state.contextItems.length && !state.isGatheringContext) {
		return;
	}
	widget.renderContextItemsPeek(parent, state, 'main', state.contextItems, Boolean(state.isGatheringContext));
	const peek = parent.querySelector('.knox-gui-context-peek');
	peek?.setAttribute('data-testid', 'knox-gui-context-peek');
	peek?.setAttribute('data-composer-slot', 'contextPeek');
}
