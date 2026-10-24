/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Theme and ANSI: light/dark detection plus colored terminal/tree spans. */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { DARK_TERMINAL_PALETTE, luminanceIsLight, parseAnsiSpans } from '../../../../common/knoxGuiTools.js';
import { knoxGuiStateThemeIsLight } from '../../../../common/knoxGuiTheme.js';

export function appendAnsi(widget: KnoxGuiWidget, parent: HTMLElement, text: string, palette: typeof DARK_TERMINAL_PALETTE): void {
	parent.replaceChildren();
	for (const span of parseAnsiSpans(text, palette)) {
		if (!span.color && !span.bold && !span.dim) {
			parent.append(span.text);
			continue;
		}
		const el = DOM.append(parent, DOM.$('span', undefined, span.text));
		if (span.color) {
			el.style.color = span.color;
		}
		if (span.bold) {
			el.style.fontWeight = 'bold';
		}
		if (span.dim) {
			el.style.opacity = '0.6';
		}
	}
}

export function isLightTheme(widget: KnoxGuiWidget): boolean {
	const stored = knoxGuiStateThemeIsLight(widget.controller.store.state);
	if (stored !== undefined) {
		return stored;
	}
	return luminanceIsLight(getComputedStyle(widget.root).getPropertyValue('--vscode-editor-background').trim());
}
