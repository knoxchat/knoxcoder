/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { knoxGuiShowsLumpOverlay, KNOX_LUMP_FADE_MS } from '../../../../common/knoxGuiChrome.js';
import type { KnoxGuiOverlay } from '../../../../common/knoxGuiProtocol.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';

/**
 * `Lump/index.tsx`: the section fades in when one opens and fades out for 300ms after
 * it closes; switching sections does not fade. Re-renders during a fade resume it.
 */
export function renderLumpOverlay(widget: KnoxGuiWidget, lump: HTMLElement, state: IKnoxGuiState): void {
	const now = Date.now();
	const fade = widget.lumpFade;
	if (knoxGuiShowsLumpOverlay(state)) {
		clearTimeout(fade.timer);
		fade.timer = undefined;
		if (!fade.shown) {
			fade.phase = 'enter';
			fade.at = now;
		} else if (fade.phase === 'leave') {
			fade.phase = 'idle';
		}
		fade.shown = state.overlay;
		appendLumpOverlay(widget, lump, state, state.overlay!, fade.phase === 'enter' ? now - fade.at : undefined, false);
		return;
	}
	if (!fade.shown) {
		return;
	}
	if (state.overlay !== null) {
		fade.shown = null;
		fade.phase = 'idle';
		return;
	}
	if (fade.phase !== 'leave') {
		fade.phase = 'leave';
		fade.at = now;
		fade.timer = setTimeout(() => {
			fade.timer = undefined;
			fade.shown = null;
			fade.phase = 'idle';
			widget.render();
		}, KNOX_LUMP_FADE_MS);
	}
	appendLumpOverlay(widget, lump, state, fade.shown as Exclude<KnoxGuiOverlay, null>, now - fade.at, true);
}

function appendLumpOverlay(widget: KnoxGuiWidget, lump: HTMLElement, state: IKnoxGuiState, section: Exclude<KnoxGuiOverlay, null>, elapsed: number | undefined, leaving: boolean): void {
	const overlay = DOM.append(lump, DOM.$('.knox-gui-overlay'));
	overlay.setAttribute('data-testid', leaving ? 'knox-gui-overlay-leaving' : `knox-gui-overlay-${section}`);
	overlay.setAttribute('data-composer-slot', leaving ? 'overlay-leaving' : 'overlay');
	overlay.inert = leaving;
	if (elapsed !== undefined && elapsed < KNOX_LUMP_FADE_MS) {
		overlay.classList.add(leaving ? 'knox-gui-overlay-leave' : 'knox-gui-overlay-enter');
		overlay.style.animationDelay = `-${elapsed}ms`;
	}
	widget.renderOverlay(overlay, state, section);
}
