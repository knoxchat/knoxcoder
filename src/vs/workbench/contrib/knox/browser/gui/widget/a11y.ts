/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../../base/browser/dom.js';
import type { KnoxGuiWidget } from '../knoxGuiWidget.js';

/**
 * Make a non-button element that already handles `click` operable from the keyboard:
 * focusable, announced as a button, and Enter / Space activate it (the same handler the
 * mouse uses, via a synthetic click). Use a real `<button>` where you can; this is for rows,
 * cards and headers that carry nested content.
 *
 * `expanded` adds `aria-expanded` for disclosure headers; call `setKnoxGuiExpanded` when it changes.
 */
export function makeKnoxGuiActivatable(widget: KnoxGuiWidget, el: HTMLElement, options: { label?: string; expanded?: boolean } = {}): void {
	el.tabIndex = 0;
	el.setAttribute('role', 'button');
	if (options.label) {
		el.setAttribute('aria-label', options.label);
	}
	if (options.expanded !== undefined) {
		el.setAttribute('aria-expanded', String(options.expanded));
	}
	widget.renderStore.add(DOM.addDisposableListener(el, 'keydown', (e: KeyboardEvent) => {
		// Keys typed inside a nested control (button, input, link) belong to that control.
		if (e.target !== el || (e.key !== 'Enter' && e.key !== ' ')) {
			return;
		}
		e.preventDefault();
		el.click();
	}));
}

export function setKnoxGuiExpanded(el: HTMLElement, expanded: boolean): void {
	el.setAttribute('aria-expanded', String(expanded));
}
