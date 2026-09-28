/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../knoxGuiWidget.js';
import { t } from './t.js';
import * as DOM from '../../../../../../base/browser/dom.js';
import { isMacintosh } from '../../../../../../base/common/platform.js';
import { knoxGuiShortcutKeys } from '../../../common/knoxGuiChrome.js';
import { appendKnoxGuiSvg, KnoxGuiSvgIcon } from '../knoxGuiIcons.js';
import { IKnoxGuiState } from '../../../common/knoxGuiState.js';

export function back(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, title?: string, extraClass?: string): void {
	const header = DOM.append(body, DOM.$('.knox-gui-page-header'));
	header.classList.add('knox-gui-page-header-back');
	for (const token of extraClass?.split(/\s+/).filter(Boolean) ?? []) {
		header.classList.add(token);
	}
	const largeArrow = header.classList.contains('knox-gui-page-header-lg-arrow');
	widget.chromeButton(header, {
		svg: 'arrow-left',
		svgSize: largeArrow ? 16 : 12,
		title: t(state, 'backToChat'),
		extraClass: 'knox-gui-page-back',
		onClick: () => widget.controller.store.navigate('/'),
	});
	DOM.append(header, DOM.$('span.knox-gui-page-title', undefined, title ?? t(state, 'backToChat')));
	widget.renderStore.add(DOM.addDisposableListener(header, 'click', e => {
		if (!(e.target as HTMLElement).closest('.knox-gui-page-back')) {
			widget.controller.store.navigate('/');
		}
	}));
}

export function section(widget: KnoxGuiWidget, body: HTMLElement, title: string, text: string): void {
	DOM.append(body, DOM.$('h3', undefined, title));
	DOM.append(body, DOM.$('div', undefined, text));
}

export function toggle(widget: KnoxGuiWidget, body: HTMLElement, label: string, value: boolean, onChange: (value: boolean) => void): void {
	const row = DOM.append(body, DOM.$('.knox-gui-row'));
	if (label) {
		DOM.append(row, DOM.$('span', undefined, label));
	}
	widget.customSwitch(row, value, () => onChange(!value), 16);
}

export function numberField(widget: KnoxGuiWidget, body: HTMLElement, label: string, value: number, min: number, max: number, onChange: (value: number) => void, step?: number, suffix?: string): void {
	const row = DOM.append(body, DOM.$('label.knox-gui-row'));
	if (label) {
		DOM.append(row, DOM.$('span', undefined, label));
	}
	const field = DOM.append(row, DOM.$('.knox-gui-number-field'));
	const current = Number.isFinite(value) ? value : min;
	const delta = step ?? 1;
	const emit = (next: number) => onChange(Math.min(max, Math.max(min, next)));
	const dec = DOM.append(field, DOM.$('button.knox-gui-number-step')) as HTMLButtonElement;
	dec.type = 'button';
	dec.setAttribute('aria-label', t(widget.controller.store.state, 'decreaseValue'));
	dec.disabled = current <= min;
	dec.textContent = '−';
	widget.listenerStore.add(DOM.addDisposableListener(dec, 'click', e => {
		e.preventDefault();
		e.stopPropagation();
		emit(current - delta);
	}));
	const input = DOM.append(field, DOM.$('input')) as HTMLInputElement;
	input.type = 'text';
	input.inputMode = 'numeric';
	input.value = String(current);
	input.setAttribute('aria-label', t(widget.controller.store.state, 'numberInput'));
	if (step != null) {
		input.step = String(step);
	}
	const inc = DOM.append(field, DOM.$('button.knox-gui-number-step')) as HTMLButtonElement;
	inc.type = 'button';
	inc.setAttribute('aria-label', t(widget.controller.store.state, 'increaseValue'));
	inc.disabled = current >= max;
	inc.textContent = '+';
	widget.listenerStore.add(DOM.addDisposableListener(inc, 'click', e => {
		e.preventDefault();
		e.stopPropagation();
		emit(current + delta);
	}));
	if (suffix) {
		DOM.append(field, DOM.$('span.knox-gui-field-suffix', undefined, suffix));
	}
	widget.listenerStore.add(DOM.addDisposableListener(input, 'change', () => {
		const parsed = Number(input.value);
		emit(Number.isFinite(parsed) ? parsed : current);
	}));
	widget.listenerStore.add(DOM.addDisposableListener(input, 'keydown', (e: KeyboardEvent) => {
		if (e.key === 'ArrowUp') {
			e.preventDefault();
			emit(current + delta);
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			emit(current - delta);
		}
	}));
}

export function hintedNumber(widget: KnoxGuiWidget, body: HTMLElement, label: string, hint: string, value: number, min: number, max: number, onChange: (value: number) => void): void {
	const row = DOM.append(body, DOM.$('.knox-gui-row.knox-gui-settings-stack'));
	const labels = DOM.append(row, DOM.$('div'));
	DOM.append(labels, DOM.$('div', undefined, label));
	DOM.append(labels, DOM.$('span.knox-gui-muted', undefined, hint));
	widget.numberField(row, '', value, min, max, onChange);
}

export function labeledInput(widget: KnoxGuiWidget, body: HTMLElement, label: string, value: string, placeholder: string): HTMLInputElement {
	DOM.append(body, DOM.$('label', undefined, label));
	const input = DOM.append(body, DOM.$('input')) as HTMLInputElement;
	input.value = value;
	input.placeholder = placeholder;
	return input;
}

export function selectField(widget: KnoxGuiWidget, parent: HTMLElement, values: string[], current: string, allLabel: string, onChange: (value: string) => void): HTMLSelectElement {
	const select = DOM.append(parent, DOM.$('select.knox-gui-select')) as HTMLSelectElement;
	const all = DOM.append(select, DOM.$('option')) as HTMLOptionElement;
	all.value = 'all';
	all.textContent = allLabel;
	for (const value of values) {
		const option = DOM.append(select, DOM.$('option')) as HTMLOptionElement;
		option.value = value;
		option.textContent = value;
		if (value === current) {
			option.selected = true;
		}
	}
	if (current === 'all') {
		all.selected = true;
	}
	widget.listenerStore.add(DOM.addDisposableListener(select, 'change', () => onChange(select.value)));
	return select;
}

export function textAreaSetting(widget: KnoxGuiWidget, body: HTMLElement, label: string, value: string, onChange: (value: string) => void): void {
	DOM.append(body, DOM.$('label', undefined, label));
	const area = DOM.append(body, DOM.$('textarea.knox-gui-input')) as HTMLTextAreaElement;
	area.value = value;
	area.rows = 3;
	widget.listenerStore.add(DOM.addDisposableListener(area, 'change', () => onChange(area.value)));
}

/** `gui/Shortcut.tsx`: one `kbd` per key, `+` between keys and `,` between combos. */
export function appendShortcut(parent: HTMLElement, shortcut: string): HTMLElement {
	const wrap = DOM.append(parent, DOM.$('span.knox-gui-shortcut-keys'));
	const combos = knoxGuiShortcutKeys(shortcut, isMacintosh);
	combos.forEach((combo, comboIndex) => {
		combo.forEach((key, keyIndex) => {
			const special = !/^[a-zA-Z0-9]$/.test(key) || key === '⌫';
			DOM.append(wrap, DOM.$(`kbd.knox-gui-shortcut${special ? '.knox-gui-shortcut-special' : ''}`, undefined, key));
			if (keyIndex < combo.length - 1) {
				DOM.append(wrap, DOM.$('span.knox-gui-shortcut-separator', undefined, '+'));
			}
		});
		if (comboIndex < combos.length - 1) {
			DOM.append(wrap, DOM.$('span.knox-gui-shortcut-separator', undefined, ','));
		}
	});
	return wrap;
}

export function iconButton(widget: KnoxGuiWidget, parent: HTMLElement, label: string, onClick: () => void, icon?: string): HTMLElement {
	return widget.chromeButton(parent, { label, icon, onClick });
}

export function chromeButton(widget: KnoxGuiWidget, parent: HTMLElement, options: {
	label?: string;
	icon?: string;
	svg?: KnoxGuiSvgIcon;
	svgSize?: number;
	svgAfter?: boolean;
	title?: string;
	selected?: boolean;
	disabled?: boolean;
	expandLabel?: boolean;
	extraClass?: string;
	testId?: string;
	menuTrigger?: boolean;
	onClick: (button: HTMLElement, event?: MouseEvent) => void;
}): HTMLButtonElement {
	const button = DOM.append(parent, DOM.$('button.knox-gui-icon-btn')) as HTMLButtonElement;
	button.type = 'button';
	if (options.extraClass) {
		button.className = `knox-gui-icon-btn ${options.extraClass}`.trim();
	}
	if (options.selected) {
		button.classList.add('selected');
		button.setAttribute('aria-pressed', 'true');
	} else {
		button.setAttribute('aria-pressed', 'false');
	}
	if (options.disabled) {
		button.classList.add('disabled');
		button.disabled = true;
	}
	if (options.testId) {
		button.setAttribute('data-testid', options.testId);
	}
	if (options.menuTrigger) {
		button.setAttribute('data-menu-trigger', 'true');
	}
	if (options.svg && !options.svgAfter) {
		appendKnoxGuiSvg(button, options.svg, options.svgSize ?? 14);
	} else if (options.icon) {
		DOM.append(button, DOM.$(`span.codicon.${options.icon}`));
	}
	if (options.label) {
		const span = DOM.append(button, DOM.$('span.knox-gui-lump-label', undefined, options.label));
		if (options.expandLabel && !options.selected) {
			span.classList.add('knox-gui-lump-label-hidden');
		}
	}
	if (options.svg && options.svgAfter) {
		appendKnoxGuiSvg(button, options.svg, options.svgSize ?? 14);
	}
	if (options.title) {
		widget.hover(button, options.title);
	}
	widget.listenerStore.add(DOM.addDisposableListener(button, 'click', e => {
		e.stopPropagation();
		options.onClick(button, e);
	}));
	return button;
}

export function collapseChevron(widget: KnoxGuiWidget, parent: HTMLElement, options: {
	expanded: boolean;
	title: string;
	disabled?: boolean;
	testId?: string;
	onClick: () => void;
}): HTMLElement {
	const el = DOM.append(parent, DOM.$('span.knox-gui-collapse-chevron'));
	el.tabIndex = options.disabled ? -1 : 0;
	el.setAttribute('role', 'button');
	el.setAttribute('aria-expanded', String(options.expanded));
	el.setAttribute('aria-label', options.title);
	if (options.disabled) {
		el.classList.add('disabled');
		el.setAttribute('aria-disabled', 'true');
	}
	if (options.testId) {
		el.setAttribute('data-testid', options.testId);
	}
	const svg = appendKnoxGuiSvg(el, 'chevron-down', 14);
	if (!options.expanded) {
		svg.classList.add('collapsed');
	}
	widget.hover(el, options.title);
	widget.listenerStore.add(DOM.addDisposableListener(el, 'click', e => {
		e.stopPropagation();
		if (!options.disabled) {
			options.onClick();
		}
	}));
	widget.listenerStore.add(DOM.addDisposableListener(el, 'keydown', e => {
		if (options.disabled) {
			return;
		}
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			e.stopPropagation();
			options.onClick();
		}
	}));
	return el;
}

export function setCollapseChevronExpanded(el: HTMLElement, expanded: boolean, title?: string): void {
	el.setAttribute('aria-expanded', String(expanded));
	if (title) {
		el.setAttribute('aria-label', title);
	}
	el.querySelector('.knox-gui-svg')?.classList.toggle('collapsed', !expanded);
}

export function appendSpinner(parent: HTMLElement, size = 16): HTMLElement {
	const wrap = DOM.append(parent, DOM.$('span.knox-gui-spinner'));
	wrap.style.width = `${size}px`;
	wrap.style.height = `${size}px`;
	wrap.setAttribute('aria-hidden', 'true');
	DOM.append(wrap, DOM.$('span.knox-gui-spinner-disc'));
	return wrap;
}

export function hover(widget: KnoxGuiWidget, target: HTMLElement, content: string): void {
	widget.listenerStore.add(widget.hoverService.setupDelayedHover(target, { content, appearance: { compact: true } }));
}

export function customSwitch(widget: KnoxGuiWidget, parent: HTMLElement, isOn: boolean, onToggle: () => void, size = 12): HTMLElement {
	const el = DOM.append(parent, DOM.$('div.knox-gui-switch'));
	el.setAttribute('role', 'switch');
	el.setAttribute('aria-checked', String(isOn));
	el.tabIndex = 0;
	el.style.setProperty('--knox-switch-size', `${size}px`);
	if (isOn) {
		el.classList.add('is-on');
	}
	DOM.append(el, DOM.$('span.knox-gui-switch-thumb'));
	widget.listenerStore.add(DOM.addDisposableListener(el, 'click', e => {
		e.preventDefault();
		e.stopPropagation();
		onToggle();
	}));
	widget.listenerStore.add(DOM.addDisposableListener(el, 'keydown', e => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			e.stopPropagation();
			onToggle();
		}
	}));
	return el;
}
