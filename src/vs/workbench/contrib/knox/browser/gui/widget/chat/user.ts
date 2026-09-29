/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { IKnoxGuiHistoryItem, IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import {
	knoxGuiShowsCodeToEditOnHistoryUser,
	shouldShineSentFrame,
	turnHasVisibleProgress,
} from '../../../../common/knoxGuiTranscript.js';

export function renderUserTurn(widget: KnoxGuiWidget,
	body: HTMLElement,
	state: IKnoxGuiState,
	item: IKnoxGuiHistoryItem,
	highlight: boolean,
	currentHit: boolean,
	index: number,
	isLastUser: boolean,
): void {
	const wrap = DOM.append(body, DOM.$('.knox-gui-history-composer'));
	wrap.setAttribute('data-testid', isLastUser ? 'last-user-composer' : 'history-composer');
	wrap.setAttribute('data-history-id', item.id);
	wrap.setAttribute('data-index', String(index));
	if (highlight) {
		wrap.classList.add('knox-gui-msg-hit');
	}
	if (currentHit) {
		wrap.classList.add('knox-gui-msg-hit-current');
	}
	if (knoxGuiShowsCodeToEditOnHistoryUser(state.mode, index)) {
		widget.renderCodeToEditCard(wrap, state);
	}
	const shine = shouldShineSentFrame(isLastUser, state.isStreaming, turnHasVisibleProgress(state.history, index));
	const frame = DOM.append(wrap, DOM.$(shine ? '.knox-sent-frame.knox-sent-frame--live' : '.knox-sent-frame'));
	frame.setAttribute('data-testid', 'knox-sent-frame');
	frame.setAttribute('data-live', shine ? 'true' : 'false');
	if (shine) {
		DOM.append(frame, DOM.$('span.knox-sent-frame-ring'));
	}
	const inner = DOM.append(frame, DOM.$('.knox-sent-frame-inner'));
	widget.renderHistoricalEditor(inner, state, item, index);
	widget.renderHistoryContextPeek(wrap, state, item);
}
