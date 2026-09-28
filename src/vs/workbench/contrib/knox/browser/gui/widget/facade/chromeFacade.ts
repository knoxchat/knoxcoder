/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { KnoxGuiWidgetState } from './widgetState.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import * as knoxGuiChromeView from '../chrome.js';

/** Toolbar, tabs, find bar, routing, menus, scrolling and root event handlers (`widget/chrome.ts`). */
export abstract class KnoxGuiChromeFacade extends KnoxGuiWidgetState {
	renderFatalBanner(this: KnoxGuiWidget, state: IKnoxGuiState): void {
		knoxGuiChromeView.renderFatalBanner(this, state);
	}

	shouldShowComposer(this: KnoxGuiWidget, state: IKnoxGuiState): boolean {
		return knoxGuiChromeView.shouldShowComposer(this, state);
	}

	renderToolbar(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiChromeView.renderToolbar(this, parent, state);
	}

	renderMode(this: KnoxGuiWidget, bar: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiChromeView.renderMode(this, bar, state);
	}

	renderAgentMenu(this: KnoxGuiWidget, anchor: HTMLElement, state: IKnoxGuiState, running: number): void {
		knoxGuiChromeView.renderAgentMenu(this, anchor, state, running);
	}

	renderFind(this: KnoxGuiWidget, state: IKnoxGuiState): void {
		knoxGuiChromeView.renderFind(this, state);
	}

	renderTabs(this: KnoxGuiWidget, state: IKnoxGuiState): void {
		knoxGuiChromeView.renderTabs(this, state);
	}

	renderRoute(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiChromeView.renderRoute(this, body, state);
	}

	renderErrorFallback(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, error: unknown): void {
		knoxGuiChromeView.renderErrorFallback(this, body, state, error);
	}

	renderScrollButtons(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiChromeView.renderScrollButtons(this, parent, state);
	}

	onRootKeyDown(this: KnoxGuiWidget, e: KeyboardEvent): void {
		knoxGuiChromeView.onRootKeyDown(this, e);
	}

	onRootMouseDown(this: KnoxGuiWidget, e: MouseEvent): void {
		knoxGuiChromeView.onRootMouseDown(this, e);
	}

	onRootContextMenu(this: KnoxGuiWidget, e: MouseEvent): void {
		knoxGuiChromeView.onRootContextMenu(this, e);
	}

	hideOsrMenu(this: KnoxGuiWidget): void {
		knoxGuiChromeView.hideOsrMenu(this);
	}

	toggleMenu(this: KnoxGuiWidget, menu: 'agent' | 'model' | 'effort', source = 'main'): void {
		knoxGuiChromeView.toggleMenu(this, menu, source);
	}

	anchorPopover(this: KnoxGuiWidget, menu: HTMLElement, trigger: HTMLElement, options?: { minWidth?: number; align?: 'start' | 'end' }): void {
		knoxGuiChromeView.anchorPopover(this, menu, trigger, options);
	}

	closeMenus(this: KnoxGuiWidget): void {
		knoxGuiChromeView.closeMenus(this);
	}

	onEscape(this: KnoxGuiWidget, e: KeyboardEvent, state: IKnoxGuiState): void {
		knoxGuiChromeView.onEscape(this, e, state);
	}

	loadEarlier(this: KnoxGuiWidget): void {
		knoxGuiChromeView.loadEarlier(this);
	}

	restoreTranscriptScroll(this: KnoxGuiWidget, state: IKnoxGuiState): void {
		knoxGuiChromeView.restoreTranscriptScroll(this, state);
	}

	attachTranscriptScroll(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiChromeView.attachTranscriptScroll(this, body, state);
	}

	scrollToHistoryIndex(this: KnoxGuiWidget, index: number): void {
		knoxGuiChromeView.scrollToHistoryIndex(this, index);
	}

	scrollTranscript(this: KnoxGuiWidget, to: 'top' | 'bottom'): void {
		knoxGuiChromeView.scrollTranscript(this, to);
	}

	syncScrollButtons(this: KnoxGuiWidget): void {
		knoxGuiChromeView.syncScrollButtons(this);
	}

	onPaneResize(this: KnoxGuiWidget): void {
		knoxGuiChromeView.onPaneResize(this);
	}
}
