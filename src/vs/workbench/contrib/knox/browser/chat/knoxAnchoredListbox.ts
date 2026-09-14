/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, getActiveWindow } from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { appendKnoxGuiIcon } from '../knoxGuiIcons.js';

export interface IKnoxAnchoredListboxItem {
	id: string;
	label: string;
	disabled?: boolean;
	selected?: boolean;
	description?: string;
	kind?: 'item' | 'add';
}

export interface IKnoxAnchoredListboxHandlers {
	onSelect(id: string): void;
	onDelete?(id: string): void;
	onConfigure?(id: string): void;
	deleteTitle?: string;
	configureTitle?: string;
}

/**
 * In-pane listbox anchored to a trigger (GUI Headless UI Listbox replacement).
 * Opens above the control when there is no room below — toolbar model select.
 */
export class KnoxAnchoredListbox extends Disposable {

	private readonly _menu: HTMLElement;
	private readonly _itemStore = this._register(new DisposableStore());
	private readonly _dismissStore = this._register(new DisposableStore());
	private _anchor: HTMLElement | undefined;
	private _open = false;

	constructor() {
		super();
		this._menu = $('.knox-anchored-listbox.hidden');
		this._menu.setAttribute('role', 'listbox');
		this._register({
			dispose: () => this._menu.remove(),
		});
	}

	get isOpen(): boolean {
		return this._open;
	}

	toggle(anchor: HTMLElement, items: readonly IKnoxAnchoredListboxItem[], handlers: IKnoxAnchoredListboxHandlers): void {
		if (this._open && this._anchor === anchor) {
			this.hide();
			return;
		}
		this.show(anchor, items, handlers);
	}

	show(anchor: HTMLElement, items: readonly IKnoxAnchoredListboxItem[], handlers: IKnoxAnchoredListboxHandlers): void {
		this._anchor = anchor;
		const host = anchor.closest('.knox-chat') ?? anchor.closest('.knox-native-view') ?? anchor.ownerDocument.body;
		if (this._menu.parentElement !== host) {
			host.appendChild(this._menu);
		}
		this._syncHostTokens(host instanceof HTMLElement ? host : anchor);
		this._render(items, handlers);
		this._menu.classList.remove('hidden');
		this._open = true;
		anchor.setAttribute('aria-expanded', 'true');
		this._position(anchor);
		this._bindDismiss(anchor);
	}

	hide(): void {
		if (!this._open) {
			return;
		}
		this._open = false;
		this._dismissStore.clear();
		this._itemStore.clear();
		this._menu.classList.add('hidden');
		this._anchor?.setAttribute('aria-expanded', 'false');
		this._anchor = undefined;
		clearNode(this._menu);
	}

	override dispose(): void {
		this.hide();
		super.dispose();
	}

	private _syncHostTokens(host: HTMLElement): void {
		const style = getActiveWindow().getComputedStyle(host);
		this._menu.style.setProperty('--knox-cyan', style.getPropertyValue('--knox-cyan').trim() || '#159994');
		const size = style.fontSize;
		if (size) {
			this._menu.style.fontSize = size;
		}
		this._menu.style.fontFamily = style.fontFamily || 'inherit';
	}

	private _render(items: readonly IKnoxAnchoredListboxItem[], handlers: IKnoxAnchoredListboxHandlers): void {
		this._itemStore.clear();
		clearNode(this._menu);
		for (const item of items) {
			const row = append(this._menu, $('div.knox-anchored-listbox-item'));
			row.setAttribute('role', 'option');
			row.setAttribute('aria-selected', String(!!item.selected));
			row.tabIndex = item.disabled ? -1 : 0;
			row.classList.toggle('add', item.kind === 'add');
			row.classList.toggle('selected', !!item.selected);
			row.classList.toggle('disabled', !!item.disabled);

			if (item.kind === 'add') {
				appendKnoxGuiIcon(row, 'add');
				append(row, $('span.knox-anchored-listbox-label')).textContent = item.label;
			} else {
				appendKnoxGuiIcon(row, 'chip-ai');
				const label = append(row, $('span.knox-anchored-listbox-label'));
				label.textContent = item.label;
				if (item.description) {
					append(row, $('span.knox-anchored-listbox-muted')).textContent = `(${item.description})`;
				}
				if (item.selected) {
					appendKnoxGuiIcon(row, 'check');
				}
				if (handlers.onDelete || handlers.onConfigure) {
					const actions = append(row, $('.knox-anchored-listbox-actions'));
					if (handlers.onDelete) {
						const del = append(actions, $('div.knox-anchored-listbox-action.delete'));
						del.title = handlers.deleteTitle ?? item.label;
						del.setAttribute('role', 'button');
						appendKnoxGuiIcon(del, 'delete');
						this._itemStore.add(addDisposableListener(del, 'mousedown', e => e.preventDefault()));
						this._itemStore.add(addDisposableListener(del, 'click', e => {
							e.preventDefault();
							e.stopPropagation();
							handlers.onDelete!(item.id);
							this.hide();
						}));
					}
					if (handlers.onConfigure) {
						const gear = append(actions, $('div.knox-anchored-listbox-action'));
						gear.title = handlers.configureTitle ?? item.label;
						gear.setAttribute('role', 'button');
						appendKnoxGuiIcon(gear, 'settings');
						this._itemStore.add(addDisposableListener(gear, 'mousedown', e => e.preventDefault()));
						this._itemStore.add(addDisposableListener(gear, 'click', e => {
							e.preventDefault();
							e.stopPropagation();
							handlers.onConfigure!(item.id);
							this.hide();
						}));
					}
				}
			}

			this._itemStore.add(addDisposableListener(row, 'click', e => {
				e.preventDefault();
				e.stopPropagation();
				if (item.disabled) {
					return;
				}
				handlers.onSelect(item.id);
				this.hide();
			}));
		}
	}

	private _position(anchor: HTMLElement): void {
		const win = anchor.ownerDocument.defaultView ?? getActiveWindow();
		const rect = anchor.getBoundingClientRect();
		const host = this._menu.offsetParent instanceof HTMLElement ? this._menu.offsetParent : this._menu.parentElement;
		const hostRect = host?.getBoundingClientRect();
		const margin = 6;
		this._menu.style.minWidth = `${Math.max(180, Math.ceil(rect.width) + 24)}px`;
		this._menu.style.maxHeight = '300px';
		this._menu.style.visibility = 'hidden';
		const height = this._menu.offsetHeight;
		const width = this._menu.offsetWidth;
		const spaceBelow = (hostRect?.bottom ?? win.innerHeight) - rect.bottom - 4;
		const spaceAbove = rect.top - (hostRect?.top ?? 0) - 4;
		const openAbove = spaceBelow < height && spaceAbove >= Math.min(height, 72);
		let left = rect.left - (hostRect?.left ?? 0);
		const hostWidth = hostRect?.width ?? win.innerWidth;
		if (left + width > hostWidth - margin) {
			left = Math.max(margin, hostWidth - width - margin);
		}
		const top = openAbove
			? rect.top - (hostRect?.top ?? 0) - height - 2
			: rect.bottom - (hostRect?.top ?? 0) + 2;
		this._menu.style.left = `${Math.max(margin, left)}px`;
		this._menu.style.top = `${Math.max(margin, top)}px`;
		this._menu.style.visibility = 'visible';
	}

	private _bindDismiss(anchor: HTMLElement): void {
		this._dismissStore.clear();
		const win = anchor.ownerDocument.defaultView ?? getActiveWindow();
		this._dismissStore.add(addDisposableListener(win, 'mousedown', e => {
			const target = e.target;
			if (!(target instanceof Node)) {
				return;
			}
			if (this._menu.contains(target) || anchor.contains(target)) {
				return;
			}
			this.hide();
		}, true));
		this._dismissStore.add(addDisposableListener(win, 'keydown', e => {
			if (e.key === 'Escape') {
				e.preventDefault();
				this.hide();
			}
		}, true));
		this._dismissStore.add(addDisposableListener(win, 'resize', () => this.hide()));
	}
}
