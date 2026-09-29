/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Compact `cp*` helpers shared by the configuration, dashboard, analysis and share tabs. */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import type { KnoxGuiSvgIcon } from '../../knoxGuiIcons.js';
import { appendKnoxGuiSvg } from '../../knoxGuiIcons.js';

export function cpButton(widget: KnoxGuiWidget, parent: HTMLElement, options: { variant: 'default' | 'outline'; label: string; svg?: KnoxGuiSvgIcon; spinner?: boolean; disabled?: boolean; testId?: string; small?: boolean; onClick: () => void }): HTMLButtonElement {
	const button = DOM.append(parent, DOM.$(`button.knox-gui-cp-btn.is-${options.variant}${options.small ? '.is-sm' : ''}`)) as HTMLButtonElement;
	button.type = 'button';
	button.disabled = Boolean(options.disabled);
	if (options.testId) {
		button.setAttribute('data-testid', options.testId);
	}
	if (options.spinner) {
		DOM.append(button, DOM.$('span.knox-gui-cp-spinner'));
	} else if (options.svg) {
		appendKnoxGuiSvg(button, options.svg, 16);
	}
	DOM.append(button, DOM.$('span', undefined, options.label));
	widget.renderStore.add(DOM.addDisposableListener(button, 'click', e => {
		e.stopPropagation();
		options.onClick();
	}));
	return button;
}

/** shadcn `Badge` variants. */
export function cpBadge(parent: HTMLElement, variant: 'default' | 'secondary' | 'destructive', text: string, extraClass?: string): HTMLElement {
	return DOM.append(parent, DOM.$(`span.knox-gui-cp-badge.is-${variant}${extraClass ? `.${extraClass}` : ''}`, undefined, text));
}

/** shadcn `SelectTrigger`: bordered box with a trailing 16px chevron at 50% opacity. */
export function cpSelect(parent: HTMLElement, id: string): HTMLSelectElement {
	const wrap = DOM.append(parent, DOM.$('.knox-gui-cp-select'));
	const select = DOM.append(wrap, DOM.$('select', { id })) as HTMLSelectElement;
	appendKnoxGuiSvg(wrap, 'chevron-down', 16);
	return select;
}

export function cpTabs(widget: KnoxGuiWidget, parent: HTMLElement, extraClass: string, tabs: Array<{ id: string; label: string; selected: boolean; svg?: KnoxGuiSvgIcon; testId: string; onClick: () => void }>): HTMLElement[] {
	const list = DOM.append(parent, DOM.$(`.knox-gui-cp-tabs.${extraClass}`, { role: 'tablist' }));
	return tabs.map(tab => {
		const button = DOM.append(list, DOM.$(`button.knox-gui-cp-tab${tab.selected ? '.is-active' : ''}`, { role: 'tab', 'data-testid': tab.testId })) as HTMLButtonElement;
		button.type = 'button';
		button.setAttribute('aria-selected', String(tab.selected));
		if (tab.svg) {
			appendKnoxGuiSvg(button, tab.svg, 16);
		}
		DOM.append(button, DOM.$('span', undefined, tab.label));
		widget.renderStore.add(DOM.addDisposableListener(button, 'click', e => {
			e.stopPropagation();
			tab.onClick();
		}));
		return button;
	});
}

export function cpLoading(body: HTMLElement, text: string, testId?: string): void {
	const loading = DOM.append(body, DOM.$('.knox-gui-cp-loading'));
	if (testId) {
		loading.setAttribute('data-testid', testId);
	}
	appendKnoxGuiSvg(loading, 'loader-2', 16).classList.add('knox-gui-cp-spin');
	DOM.append(loading, DOM.$('span', undefined, text));
}

export function cpEmptyCard(parent: HTMLElement, icon: KnoxGuiSvgIcon, title: string, hint: string | undefined, testId: string): void {
	const empty = DOM.append(parent, DOM.$('.knox-gui-cp-card.knox-gui-cp-empty', { 'data-testid': testId }));
	appendKnoxGuiSvg(empty, icon, 32);
	DOM.append(empty, DOM.$('p', undefined, title));
	if (hint) {
		DOM.append(empty, DOM.$('p.knox-gui-cp-empty-hint', undefined, hint));
	}
}
