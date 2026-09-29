/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Shared shadcn-style building blocks (button, badge, checkbox, select, dialog chrome, modal) for the checkpoint surfaces. */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import type { KnoxGuiSvgIcon } from '../../knoxGuiIcons.js';
import { appendKnoxGuiSvg } from '../../knoxGuiIcons.js';
import { checkpointRelativeAge } from '../../../../common/knoxGuiCheckpoints.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';

export type KnoxCheckpointButtonVariant = 'default' | 'outline' | 'ghost' | 'secondary' | 'destructive' | 'link';

export type KnoxCheckpointButtonSize = 'default' | 'sm' | 'row' | 'xs' | 'xxs' | 'icon';

/**
 * shadcn `ui/button.tsx` for checkpoint surfaces: `is-<variant>` / `is-size-<size>` map to the cva
 * variants plus the `h-8 px-2` / `h-7 px-2` / `h-6` overrides the reference passes; icons stay 16px.
 */
export function checkpointButton(widget: KnoxGuiWidget, parent: HTMLElement, options: Parameters<KnoxGuiWidget['chromeButton']>[1] & { variant?: KnoxCheckpointButtonVariant; size?: KnoxCheckpointButtonSize; labelClass?: string; ariaLabel?: string }): HTMLButtonElement {
	const { variant = 'outline', size = 'sm', labelClass, ariaLabel, extraClass, ...rest } = options;
	const button = widget.chromeButton(parent, { ...rest, svgSize: 16, extraClass: `knox-gui-cpl-btn is-${variant} is-size-${size}${extraClass ? ` ${extraClass}` : ''}` });
	if (labelClass) {
		button.querySelector('.knox-gui-lump-label')?.classList.add(...labelClass.split(' '));
	}
	if (ariaLabel) {
		button.setAttribute('aria-label', ariaLabel);
	}
	return button;
}

/** shadcn `ui/badge.tsx`; checkpoint badges pass `font-normal` and `size-3` icons. */
export function checkpointBadge(parent: HTMLElement, variant: 'default' | 'secondary' | 'outline', text?: string, icon?: KnoxGuiSvgIcon, extraClass = ''): HTMLElement {
	const badge = DOM.append(parent, DOM.$(`span.knox-gui-cpl-badge.is-${variant}${extraClass}`));
	if (icon) {
		appendKnoxGuiSvg(badge, icon, 12);
	}
	if (text !== undefined) {
		badge.append(text);
	}
	return badge;
}

/** shadcn `ui/checkbox.tsx`. */
export function checkpointCheckbox(parent: HTMLElement, checked: boolean, label?: string, extraClass = ''): HTMLInputElement {
	const box = DOM.append(parent, DOM.$(`input.knox-gui-cpl-checkbox${extraClass}`)) as HTMLInputElement;
	box.type = 'checkbox';
	box.checked = checked;
	if (label) {
		box.setAttribute('aria-label', label);
	}
	return box;
}

/** shadcn `SelectTrigger` look for a native `<select>`, with the trailing 50%-opacity chevron. */
export function checkpointSelect(parent: HTMLElement, extraClass = ''): HTMLSelectElement {
	const wrap = DOM.append(parent, DOM.$(`span.knox-gui-cpl-select${extraClass}`));
	const select = DOM.append(wrap, DOM.$('select')) as HTMLSelectElement;
	appendKnoxGuiSvg(wrap, 'chevron-down', 16).classList.add('knox-gui-cpl-select-chevron');
	return select;
}

export function checkpointSearch(parent: HTMLElement, placeholder: string, value: string, extraClass = '', id?: string): HTMLInputElement {
	const wrap = DOM.append(parent, DOM.$(`.knox-gui-cpl-search${extraClass}`));
	appendKnoxGuiSvg(wrap, 'search', 16).classList.add('knox-gui-cpl-search-icon');
	const input = DOM.append(wrap, DOM.$('input.knox-gui-cpl-input', id ? { id } : undefined)) as HTMLInputElement;
	input.placeholder = placeholder;
	input.value = value;
	return input;
}

/** shadcn `DialogContent` / `AlertDialogContent` inside the checkpoint page overlay. */
export function checkpointDialog(widget: KnoxGuiWidget, parent: HTMLElement, testId: string, onClose: (() => void) | undefined, size: 'md' | 'lg' | '2xl' | '6xl', closeButton?: { title: string; onClick: () => void }): HTMLElement {
	const dialog = modal(widget, parent, testId, onClose);
	dialog.classList.add('knox-gui-cpl-dialog', `is-${size}`);
	dialog.parentElement?.classList.add('knox-gui-cpl-overlay');
	if (closeButton) {
		checkpointDialogClose(widget, dialog, closeButton.title, closeButton.onClick);
	}
	return dialog;
}

export function checkpointDialogClose(widget: KnoxGuiWidget, parent: HTMLElement, title: string, onClick: () => void, extraClass = ''): HTMLButtonElement {
	const close = DOM.append(parent, DOM.$(`button.knox-gui-cpl-dialog-close${extraClass}`, { type: 'button', title, 'aria-label': title })) as HTMLButtonElement;
	appendKnoxGuiSvg(close, 'x', 16);
	widget.renderStore.add(DOM.addDisposableListener(close, 'click', onClick));
	return close;
}

export function checkpointDialogHeader(parent: HTMLElement, title: string, icon?: KnoxGuiSvgIcon, description?: string): HTMLElement {
	const header = DOM.append(parent, DOM.$('.knox-gui-cpl-dialog-header'));
	const heading = DOM.append(header, DOM.$('h2.knox-gui-cpl-dialog-title'));
	if (icon) {
		appendKnoxGuiSvg(heading, icon, 16);
	}
	heading.append(title);
	if (description !== undefined) {
		DOM.append(header, DOM.$('p.knox-gui-cpl-dialog-desc', undefined, description));
	}
	return header;
}

export function checkpointAgeLabel(state: IKnoxGuiState, created: string, yesterday: boolean): string {
	const age = checkpointRelativeAge(created, yesterday);
	if ('date' in age) {
		return yesterday ? age.date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : age.date.toLocaleDateString();
	}
	return t(state, age.key, age.count != null ? { count: age.count } : undefined);
}

/** `RiskBadge` in `CheckpointAnalysisPanel.tsx`. */
export function checkpointRiskIcon(level: string): KnoxGuiSvgIcon {
	return level === 'Low' ? 'shield-check' : level === 'Medium' ? 'shield' : level === 'High' ? 'shield-alert' : 'alert-triangle';
}

export function modal(widget: KnoxGuiWidget, parent: HTMLElement, testId: string, onClose?: () => void): HTMLElement {
	const overlay = DOM.append(parent, DOM.$('.knox-gui-modal'));
	if (onClose) {
		widget.renderStore.add(DOM.addDisposableListener(overlay, 'mousedown', e => {
			if (e.target === overlay) {
				onClose();
			}
		}));
	}
	const dialog = DOM.append(overlay, DOM.$('.knox-gui-dialog.knox-gui-modal-dialog'));
	dialog.setAttribute('role', 'dialog');
	dialog.setAttribute('data-testid', testId);
	return dialog;
}
