/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** DOM builders shared by every Memory page: class-token mapping, `mk`/`svg`/`spinner`, buttons and the confirm dialog. */

import * as DOM from '../../../../../../../base/browser/dom.js';
import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { appendKnoxGuiSvg, KnoxGuiSvgIcon } from '../../knoxGuiIcons.js';

/** Tokens map to `knox-gui-memory-<token>` (Tailwind-equivalent classes in knoxGuiMemory.css); `knox-gui-*`, `is-*` and `selected` pass through. */
export function memoryClasses(tokens: string): string {
	return tokens.split(' ').filter(Boolean).map(token => token.startsWith('knox-gui-') || token.startsWith('is-') || token === 'selected' ? token : `knox-gui-memory-${token}`).join(' ');
}

export function mk<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, tokens: string, text?: string): HTMLElementTagNameMap[K] {
	const el = DOM.append(parent, DOM.$(tag)) as HTMLElementTagNameMap[K];
	if (tokens) {
		el.className = memoryClasses(tokens);
	}
	if (text !== undefined) {
		el.textContent = text;
	}
	return el;
}

export function svg(parent: HTMLElement, icon: KnoxGuiSvgIcon, size: number, tokens?: string): SVGSVGElement {
	const el = appendKnoxGuiSvg(parent, icon, size);
	if (tokens) {
		el.classList.add(...memoryClasses(tokens).split(' '));
	}
	return el;
}

export function spinner(parent: HTMLElement, size: number, border = 2): HTMLElement {
	const el = mk(parent, 'div', 'spinner');
	el.style.width = `${size}px`;
	el.style.height = `${size}px`;
	el.style.borderWidth = `${border}px`;
	el.setAttribute('aria-hidden', 'true');
	return el;
}

export function memoryButton(widget: KnoxGuiWidget, parent: HTMLElement, options: {
	tokens: string;
	icon?: KnoxGuiSvgIcon;
	iconSize?: number;
	iconTokens?: string;
	spinning?: boolean;
	label?: string;
	labelTokens?: string;
	title?: string;
	ariaLabel?: string;
	disabled?: boolean;
	testId?: string;
	onClick: (e: MouseEvent) => void;
}): HTMLButtonElement {
	const button = mk(parent, 'button', options.tokens);
	button.type = 'button';
	if (options.testId) {
		button.setAttribute('data-testid', options.testId);
	}
	if (options.title) {
		button.title = options.title;
	}
	if (options.ariaLabel) {
		button.setAttribute('aria-label', options.ariaLabel);
	}
	button.disabled = !!options.disabled;
	if (options.spinning) {
		svg(button, 'loader-2', options.iconSize ?? 12, 'spin');
	} else if (options.icon) {
		svg(button, options.icon, options.iconSize ?? 12, options.iconTokens);
	}
	if (options.label !== undefined) {
		mk(button, 'span', options.labelTokens ?? '', options.label);
	}
	widget.renderStore.add(DOM.addDisposableListener(button, 'click', (e: MouseEvent) => {
		e.stopPropagation();
		options.onClick(e);
	}));
	return button;
}

function modalHost(body: HTMLElement): HTMLElement {
	return body.closest<HTMLElement>('.knox-gui-memory-page') ?? body;
}

/** Confirmation dialog shared by `MemorySettings.tsx` and `MemoryBrowser.tsx`. */
export function memoryConfirmDialog(widget: KnoxGuiWidget, body: HTMLElement, options: {
	title: string;
	lines: Array<{ text: string; tokens: string }>;
	cancelLabel: string;
	confirmLabel: string;
	busy?: boolean;
	testId?: string;
	confirmTestId: string;
	onCancel: () => void;
	onConfirm: () => void;
}): HTMLElement {
	const overlay = mk(modalHost(body), 'div', 'modal');
	overlay.setAttribute('role', 'dialog');
	if (options.testId) {
		overlay.setAttribute('data-testid', options.testId);
	}
	const dialog = mk(overlay, 'div', 'dialog');
	const head = mk(dialog, 'div', 'mb-3 flex items-center gap-2');
	svg(head, 'alert-triangle', 16, 'text-amber');
	mk(head, 'h3', 'sm fw-6', options.title);
	for (const line of options.lines) {
		mk(dialog, 'p', line.tokens, line.text);
	}
	const actions = mk(dialog, 'div', 'flex justify-end gap-2');
	memoryButton(widget, actions, { tokens: 'dialog-btn is-cancel', label: options.cancelLabel, disabled: options.busy, onClick: options.onCancel });
	memoryButton(widget, actions, { tokens: 'dialog-btn is-confirm', label: options.confirmLabel, disabled: options.busy, testId: options.confirmTestId, onClick: options.onConfirm });
	return overlay;
}
