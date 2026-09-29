/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';

/** `StreamErrorDialog` inside the Layout `TextDialog`: status title, capped message box, Close. */
export function renderStreamError(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	if (!state.streamError) {
		return;
	}
	const close = () => widget.controller.clearStreamError();
	const overlay = DOM.append(parent, DOM.$('.knox-gui-text-dialog'));
	overlay.setAttribute('role', 'presentation');
	widget.renderStore.add(DOM.addDisposableListener(overlay, 'click', close));
	const panel = DOM.append(overlay, DOM.$('.knox-gui-text-dialog-panel'));
	widget.renderStore.add(DOM.addDisposableListener(panel, 'click', e => e.stopPropagation()));
	const box = DOM.append(panel, DOM.$('.knox-gui-text-dialog-body'));
	box.setAttribute('role', 'alertdialog');
	box.setAttribute('aria-modal', 'true');
	widget.chromeButton(box, { svg: 'x', svgSize: 20, title: t(state, 'close'), extraClass: 'knox-gui-text-dialog-close', onClick: close });
	const card = DOM.append(box, DOM.$('.knox-gui-stream-error'));
	card.setAttribute('data-testid', 'knox-gui-stream-error');
	const code = state.streamError.statusCode ? `${state.streamError.statusCode} ` : '';
	DOM.append(card, DOM.$('p.knox-gui-stream-error-title', undefined, `${code}${t(state, 'error')}`));
	if (state.streamError.message) {
		const messageBox = DOM.append(card, DOM.$('.knox-gui-stream-error-message'));
		DOM.append(messageBox, DOM.$('code', undefined, state.streamError.message));
	}
	const actions = DOM.append(card, DOM.$('.knox-gui-stream-error-actions'));
	widget.chromeButton(actions, { label: t(state, 'close'), extraClass: 'knox-gui-primary', onClick: close });
}
