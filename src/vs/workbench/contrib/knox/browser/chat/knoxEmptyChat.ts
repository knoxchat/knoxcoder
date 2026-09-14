/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import {
	KNOX_BOOKMARKED_SLASH_STORAGE_KEY,
	knoxBookmarkedCommands,
	knoxStarterInsertText,
	knoxVisibleStarters,
} from '../../common/knoxConversationStarters.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { IKnoxSlashCommand } from '../../common/knoxChatTypes.js';
import { appendKnoxGuiIcon, knoxNamedIconOr } from '../knoxGuiIcons.js';

/**
 * Empty-thread conversation starters exist in `knox/gui` as `EmptyChatBody`,
 * but live `Chat.tsx` does not mount them. Keep this widget for the data
 * helpers; native chat leaves a blank thread like the GUI.
 */
export class KnoxEmptyChat extends Disposable {

	readonly element: HTMLElement;

	private readonly _hint: HTMLElement;
	private readonly _cards: HTMLElement;
	private readonly _more: HTMLButtonElement;
	private readonly _itemDisposables = this._register(new DisposableStore());
	private _showAll = false;

	private readonly _onDidSelectStarter = this._register(new Emitter<string>());
	readonly onDidSelectStarter = this._onDidSelectStarter.event;

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
	) {
		super();
		this.element = append(parent, $('.knox-thread-empty.hidden'));
		this._hint = append(this.element, $('div.knox-empty-hint'));
		this._hint.textContent = localize('knox.emptyThread', "Ask Knox to help with this workspace.");
		this._cards = append(this.element, $('.knox-starter-cards'));
		this._more = append(this.element, $<HTMLButtonElement>('button.knox-starter-more.hidden'));
		this._more.type = 'button';
		this._register(addDisposableListener(this._more, 'click', () => {
			this._showAll = !this._showAll;
			this.refresh();
		}));
		this._register(this._chatService.onDidChange(() => {
			if (!this.element.classList.contains('hidden')) {
				this.refresh();
			}
		}));
		this.refresh();
	}

	setVisible(visible: boolean): void {
		this.element.classList.toggle('hidden', !visible);
		if (visible) {
			this.refresh();
		}
	}

	refresh(): void {
		const commands = this._chatService.config?.slashCommands ?? [];
		const bookmarks = this._bookmarks();
		const starters = knoxBookmarkedCommands(commands, bookmarks);
		const { visible, remaining } = knoxVisibleStarters(starters, this._showAll);

		this._itemDisposables.clear();
		clearNode(this._cards);
		for (const command of visible) {
			this._renderCard(command);
		}

		this._cards.classList.toggle('hidden', visible.length === 0);
		const showToggle = remaining > 0 || this._showAll;
		this._more.classList.toggle('hidden', !showToggle);
		if (showToggle) {
			this._more.textContent = this._showAll
				? localize('knox.collapse', "Collapse")
				: localize('knox.showMoreEllipsis', "Show {0} more ...", remaining);
		}
	}

	private _bookmarks(): string[] {
		return this._chatService.slashBookmarks();
	}

	private _renderCard(command: IKnoxSlashCommand): void {
		const card = append(this._cards, $<HTMLButtonElement>('button.knox-starter-card'));
		card.type = 'button';
		appendKnoxGuiIcon(card, knoxNamedIconOr(command.name, 'message-square'));
		const text = append(card, $('div.knox-starter-text'));
		const name = append(text, $('div.knox-starter-name'));
		name.textContent = command.name;
		if (command.description) {
			append(text, $('div.knox-starter-description')).textContent = command.description;
		}
		this._itemDisposables.add(addDisposableListener(card, 'click', () => {
			this._onDidSelectStarter.fire(knoxStarterInsertText(command));
		}));
	}
}

export function storeKnoxBookmarks(storageService: IStorageService, names: readonly string[]): void {
	storageService.store(
		KNOX_BOOKMARKED_SLASH_STORAGE_KEY,
		JSON.stringify(names),
		StorageScope.PROFILE,
		StorageTarget.USER,
	);
}
