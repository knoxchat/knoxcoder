/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass } from '../knoxGuiIcons.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import {
	IKnoxSessionTab,
	knoxHandleSessionChange,
	knoxParseTabs,
	knoxRemoveTab,
	knoxSerializeTabs,
	knoxSetActiveTab,
	knoxShowSessionTabs,
} from '../../common/knoxTabs.js';

const TABS_STORAGE_KEY = 'knox.sessionTabs';

/**
 * Session tabs, shown when `config.ui.showSessionTabs` is true and more than
 * one tab is open — same visibility rule as `knox/gui` TabBar.
 */
export class KnoxTabBar extends Disposable {

	readonly element: HTMLElement;

	private _tabs: IKnoxSessionTab[] = [];
	private _syncing = false;
	private _lastSessionId = '';
	private _lastTitle = '';
	private _lastShowTabs = false;
	private readonly _itemDisposables = this._register(new DisposableStore());

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@IStorageService private readonly _storageService: IStorageService,
	) {
		super();
		this.element = append(parent, $('.knox-tab-bar.hidden'));
		this.element.setAttribute('role', 'tablist');
		this.element.setAttribute('aria-label', localize('knox.sessionTabs', "Session tabs"));

		this._tabs = knoxParseTabs(this._storageService.get(TABS_STORAGE_KEY, StorageScope.WORKSPACE))
			?? [{
				id: generateUuid(),
				title: this._chatService.title,
				isActive: true,
				sessionId: this._chatService.sessionId,
			}];

		this._register(this._chatService.onDidChange(() => this._onSessionChange()));
		this._onSessionChange();
	}

	get height(): number {
		return this.element.classList.contains('hidden') || this.element.classList.contains('knox-tab-bar-suppressed')
			? 0
			: this.element.offsetHeight;
	}

	private _onSessionChange(): void {
		if (this._syncing) {
			return;
		}
		const showFlag = knoxShowSessionTabs(this._chatService.config?.ui);
		const sessionChanged = this._lastSessionId !== this._chatService.sessionId || this._lastTitle !== this._chatService.title;
		if (!sessionChanged && showFlag === this._lastShowTabs) {
			return;
		}
		if (sessionChanged) {
			this._tabs = knoxHandleSessionChange(this._tabs, {
				currentSessionId: this._chatService.sessionId,
				currentSessionTitle: this._chatService.title,
				newTabId: generateUuid(),
			});
			this._lastSessionId = this._chatService.sessionId;
			this._lastTitle = this._chatService.title;
			this._persist();
		}
		this._lastShowTabs = showFlag;
		this._render();
	}

	private _render(): void {
		const show = knoxShowSessionTabs(this._chatService.config?.ui) && this._tabs.length > 1;
		const wasHidden = this.element.classList.contains('hidden');
		this.element.classList.toggle('hidden', !show);
		this._itemDisposables.clear();
		clearNode(this.element);
		if (!show) {
			if (!wasHidden) {
				this._onDidChangeHeight.fire();
			}
			return;
		}
		for (const tab of this._tabs) {
			this._renderTab(tab);
		}
		append(this.element, $('.knox-tab-filler'));
		this._onDidChangeHeight.fire();
	}

	private _renderTab(tab: IKnoxSessionTab): void {
		const el = append(this.element, $<HTMLButtonElement>('button.knox-tab'));
		el.type = 'button';
		el.setAttribute('role', 'tab');
		el.setAttribute('aria-selected', tab.isActive ? 'true' : 'false');
		el.classList.toggle('active', tab.isActive);
		const label = append(el, $('span.knox-tab-label'));
		label.textContent = tab.title;
		const close = append(el, $<HTMLButtonElement>('button.knox-tab-close'));
		close.type = 'button';
		close.title = localize('knox.close', "Close");
		close.setAttribute('aria-label', localize('knox.closeTab', "Close {0}", tab.title));
		append(close, $('span')).className = knoxGuiIconClass('x');
		this._itemDisposables.add(addDisposableListener(el, 'click', () => void this._activate(tab.id)));
		this._itemDisposables.add(addDisposableListener(close, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			void this._close(tab.id);
		}));
	}

	private async _activate(id: string): Promise<void> {
		const target = this._tabs.find(tab => tab.id === id);
		if (!target) {
			return;
		}
		this._syncing = true;
		try {
			if (target.sessionId) {
				await this._chatService.loadSession(target.sessionId, this._chatService.history.length > 0);
			}
			this._tabs = knoxSetActiveTab(this._tabs, id);
			this._persist();
			this._render();
		} finally {
			this._rememberSession();
			this._syncing = false;
		}
	}

	private async _close(id: string): Promise<void> {
		const closingActive = this._tabs.find(tab => tab.id === id)?.isActive === true;
		const remaining = knoxRemoveTab(this._tabs, id);
		this._syncing = true;
		try {
			if (!remaining.length) {
				this._chatService.newSession();
				this._tabs = [{
					id: generateUuid(),
					title: knoxNewTabTitle(1),
					isActive: true,
				}];
				this._persist();
				this._render();
				return;
			}
			if (closingActive) {
				const last = remaining[remaining.length - 1];
				this._tabs = knoxSetActiveTab(remaining, last.id);
				if (last.sessionId) {
					await this._chatService.loadSession(last.sessionId, this._chatService.history.length > 0);
				} else {
					this._chatService.newSession();
				}
			} else {
				this._tabs = remaining;
			}
			this._persist();
			this._render();
		} finally {
			this._rememberSession();
			this._syncing = false;
		}
	}

	private _rememberSession(): void {
		this._lastSessionId = this._chatService.sessionId;
		this._lastTitle = this._chatService.title;
	}

	private _persist(): void {
		this._storageService.store(
			TABS_STORAGE_KEY,
			knoxSerializeTabs(this._tabs),
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE,
		);
	}
}

/** Used when the native New Conversation action should also mint a tab. */
export function knoxNewTabTitle(count: number): string {
	return localize('knox.chatTab', "Chat {0}", count);
}

