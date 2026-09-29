/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { knoxGuiCanCancel, knoxGuiShowsAgentMeter } from '../../../../common/knoxGuiChrome.js';
import { appendKnoxGuiSvg } from '../../knoxGuiIcons.js';
import { inputDocIsEmpty } from '../../../../common/knoxGuiInput.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { renderLumpOverlay } from './lumpOverlay.js';

export function renderComposer(widget: KnoxGuiWidget, state: IKnoxGuiState): void {
	const composer = DOM.append(widget.root, DOM.$('.knox-gui-composer'));
	composer.setAttribute('data-testid', 'full-composer');
	const collapsed = widget.composerCollapsed;
	composer.classList.toggle('is-collapsed', collapsed);
	const toggle = widget.composerToggle;
	const elapsed = toggle ? Date.now() - toggle.at : Number.POSITIVE_INFINITY;
	const animating = toggle !== undefined && elapsed < KNOX_COMPOSER_TOGGLE_MS;
	if (!animating) {
		widget.composerToggle = undefined;
	}
	if (animating) {
		// A re-render mid-toggle resumes the same animation instead of restarting or snapping.
		composer.style.setProperty('--knox-composer-toggle-delay', `-${Math.round(elapsed)}ms`);
		composer.classList.add(toggle.dir === 'collapse' ? 'is-collapsing' : 'is-expanding');
	}
	// Tool approval must stay reachable even while the rest of the composer is tucked away.
	widget.renderChatPermissionBar(composer, state);
	// Everything from the top toolbar down to the input field folds as one section.
	const collapsible = DOM.append(composer, DOM.$('.knox-gui-composer-collapsible'));
	collapsible.setAttribute('data-testid', 'knox-gui-composer-collapsible');
	collapsible.setAttribute('data-collapsed', String(collapsed));
	collapsible.classList.toggle('is-collapsed', collapsed);
	if (animating) {
		collapsible.classList.add(toggle.dir === 'collapse' ? 'is-collapsing' : 'is-expanding');
	}
	const section = DOM.append(collapsible, DOM.$('.knox-gui-composer-collapsible-inner'));
	// Hidden content must not be reachable by Tab or screen readers; the draft stays painted underneath.
	section.inert = collapsed;
	section.setAttribute('aria-hidden', String(collapsed));
	const lump = DOM.append(section, DOM.$('.knox-gui-lump-shell'));
	widget.renderToolbar(lump, state);
	renderLumpOverlay(widget, lump, state);
	if (knoxGuiShowsAgentMeter(state.mode)) {
		widget.renderAgentMeter(section, state);
	}
	widget.renderPanels(section, state);
	const editorPad = DOM.append(section, DOM.$('.knox-gui-composer-editor-pad'));
	const frame = DOM.append(editorPad, DOM.$('.knox-sent-frame'));
	frame.setAttribute('data-testid', 'knox-gui-main-sent-frame');
	frame.setAttribute('data-live', 'false');
	const inner = DOM.append(frame, DOM.$('.knox-sent-frame-inner'));
	widget.renderInput(inner, state);
	if (collapsed || (animating && toggle.dir === 'expand')) {
		renderComposerDock(widget, composer, state, collapsed, animating ? toggle.dir : undefined);
	}
	widget.renderContextPeek(composer, state);
	widget.renderAcceptRejectAll(composer, state);
	floatCollapsedComposer(widget, composer, collapsed, animating ? KNOX_COMPOSER_TOGGLE_MS - elapsed : 0);
}

/**
 * Once folded, a composer that holds nothing but the round button leaves the layout and floats
 * over the transcript, so no bar (or bar-shaped gap) remains behind the button. Anything else the
 * composer carries (tool approval, accept/reject) keeps it in flow. The switch waits for the fold to
 * finish; the chat body gets equal bottom padding at that moment (see CSS), so nothing shifts.
 */
function floatCollapsedComposer(widget: KnoxGuiWidget, composer: HTMLElement, collapsed: boolean, remainingMs: number): void {
	clearTimeout(widget.composerFloatTimer);
	widget.composerFloatTimer = undefined;
	const dockOnly = Array.from(composer.children).every(child => child.classList.contains('knox-gui-composer-collapsible') || child.classList.contains('knox-gui-composer-dock-shell'));
	if (!collapsed || !dockOnly) {
		return;
	}
	if (remainingMs <= 0) {
		composer.classList.add('is-floating');
		return;
	}
	widget.composerFloatTimer = setTimeout(() => {
		widget.composerFloatTimer = undefined;
		if (composer.isConnected && widget.composerCollapsed) {
			composer.classList.add('is-floating');
		}
	}, remainingMs);
}

/** Total length of the composer hide/show animation (keep in sync with `knoxGuiComposer.css`). */
export const KNOX_COMPOSER_TOGGLE_MS = 360;

/**
 * Hide or show the whole composer section (toolbar, activity, task plan, editor). The draft, images and caret stay in state, so
 * collapsing never loses input; the section animates out and a slim dock takes its place.
 */
export function setComposerCollapsed(widget: KnoxGuiWidget, collapsed: boolean): void {
	if (widget.composerCollapsed === collapsed) {
		return;
	}
	if (collapsed) {
		widget.controller.composerCaret = widget.editorEl ? widget.caretDocPosition(widget.editorEl) ?? widget.controller.composerCaret : widget.controller.composerCaret;
	}
	widget.composerCollapsed = collapsed;
	widget.composerToggle = { dir: collapsed ? 'collapse' : 'expand', at: Date.now() };
	widget.controller.setComposerCollapsed(collapsed);
	widget.closeMenus();
	// Collapsing releases focus so the hidden editor cannot steal it back; expanding hands focus to the editor
	// unless a settings section is what asked for the reveal.
	widget.controller.store.patch({ inputFocused: !collapsed && !widget.controller.store.state.overlay });
	if (!collapsed && widget.controller.composerCaret) {
		widget.controller.pendingComposerCaret = widget.controller.composerCaret;
	}
	widget.render();
}

/** Round icon button left behind while the section is hidden (and while it spins away on expand). */
function renderComposerDock(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, collapsed: boolean, animation: 'collapse' | 'expand' | undefined): void {
	const shell = DOM.append(parent, DOM.$('.knox-gui-composer-dock-shell'));
	shell.setAttribute('data-composer-slot', 'dock');
	shell.classList.toggle('is-open', collapsed);
	if (animation) {
		shell.classList.add(animation === 'collapse' ? 'is-opening' : 'is-closing');
	}
	shell.inert = !collapsed;
	const dock = DOM.append(shell, DOM.$('.knox-gui-composer-dock'));
	dock.setAttribute('data-testid', 'knox-gui-composer-dock');
	const hasDraft = !inputDocIsEmpty(state.inputDoc) || state.images.length > 0;
	if (knoxGuiCanCancel(state)) {
		widget.chromeButton(dock, {
			svg: 'cancel',
			svgSize: 12,
			title: t(state, 'cancelGeneration'),
			testId: 'knox-gui-dock-cancel',
			extraClass: 'knox-gui-cancel knox-gui-composer-dock-cancel',
			onClick: () => widget.controller.cancel(),
		});
	}
	const showButton = DOM.append(dock, DOM.$('button.knox-gui-composer-orb.knox-gui-composer-dock-toggle')) as HTMLButtonElement;
	showButton.type = 'button';
	showButton.setAttribute('data-testid', 'knox-gui-composer-expand');
	showButton.setAttribute('aria-expanded', 'false');
	const label = hasDraft ? `${t(state, 'showInput')} · ${t(state, 'draftKept')}` : t(state, 'showInput');
	showButton.setAttribute('aria-label', label);
	widget.hover(showButton, label);
	const icon = DOM.append(showButton, DOM.$('span.knox-gui-composer-toggle-icon'));
	appendKnoxGuiSvg(icon, 'list-chevrons-up-down', 12);
	if (hasDraft) {
		DOM.append(showButton, DOM.$('span.knox-gui-composer-dock-badge'));
	}
	widget.renderStore.add(DOM.addDisposableListener(showButton, 'click', () => setComposerCollapsed(widget, false)));
}
