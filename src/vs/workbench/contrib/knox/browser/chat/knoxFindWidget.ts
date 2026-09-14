/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { FindInput } from '../../../../../base/browser/ui/findinput/findInput.js';
import { IKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { Delayer } from '../../../../../base/common/async.js';
import { Emitter } from '../../../../../base/common/event.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass, KnoxGuiIconName } from '../knoxGuiIcons.js';
import { IContextKey, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { ContextScopedFindInput } from '../../../../../platform/history/browser/contextScopedHistoryWidget.js';
import { defaultInputBoxStyles, defaultToggleStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { KnoxFindVisibleContext } from '../../common/knoxChat.js';
import {
	compileKnoxSearchPattern,
	findKnoxThreadMatches,
	IKnoxFindHit,
	knoxNextFindIndex,
} from '../../common/knoxFind.js';
import { IKnoxThreadRow } from '../../common/knoxThreadModel.js';

export interface IKnoxFindHost {
	getRows(): readonly IKnoxThreadRow[];
	isStreaming(): boolean;
	revealFindHit(hit: IKnoxFindHit): void;
	clearFindHighlight(): void;
}

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Find-in-thread overlay. Searches the flattened thread model (virtual list
 * rows are not all in the DOM) and reveals the matching WorkbenchList row.
 */
export class KnoxFindWidget extends Disposable {

	readonly element: HTMLElement;

	private readonly _findInput: FindInput;
	private readonly _matchesCount: HTMLElement;
	private readonly _prev: HTMLButtonElement;
	private readonly _next: HTMLButtonElement;
	private readonly _close: HTMLButtonElement;
	private readonly _visibleKey: IContextKey<boolean>;
	private readonly _searchDelayer: Delayer<void>;

	private _hits: IKnoxFindHit[] = [];
	private _current = -1;
	private _visible = false;

	private readonly _onDidChangeVisibility = this._register(new Emitter<boolean>());
	readonly onDidChangeVisibility = this._onDidChangeVisibility.event;

	constructor(
		parent: HTMLElement,
		private readonly _host: IKnoxFindHost,
		@IContextViewService contextViewService: IContextViewService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();

		this._visibleKey = KnoxFindVisibleContext.bindTo(contextKeyService);
		this._searchDelayer = this._register(new Delayer<void>(SEARCH_DEBOUNCE_MS));

		this.element = append(parent, $('.knox-find.hidden'));
		this.element.setAttribute('role', 'search');
		this.element.setAttribute('aria-label', localize('knox.find', "Find in conversation"));

		this._findInput = this._register(new ContextScopedFindInput(this.element, contextViewService, {
			label: localize('knox.find', "Find in conversation"),
			placeholder: localize('knox.search', "Search"),
			showCommonFindToggles: true,
			flexibleWidth: true,
			inputBoxStyles: defaultInputBoxStyles,
			toggleStyles: defaultToggleStyles,
			validation: (value: string) => {
				if (!value || !this._findInput.getRegex()) {
					return null;
				}
				try {
					new RegExp(value);
					return null;
				} catch (e) {
					return { content: e instanceof Error ? e.message : String(e) };
				}
			},
		}, contextKeyService));

		this._matchesCount = append(this.element, $('span.knox-find-count'));
		this._prev = this._iconButton('lucide-arrow-up', localize('knox.previousMatch', "Previous match"));
		this._next = this._iconButton('lucide-arrow-down', localize('knox.nextMatch', "Next match"));
		this._close = this._iconButton('x', localize('knox.close', "Close"));

		this._register(this._findInput.onInput(() => this._scheduleSearch()));
		this._register(this._findInput.onDidOptionChange(() => this._search('closest')));
		this._register(this._findInput.onKeyDown(e => this._onFindKeyDown(e)));
		this._register(addDisposableListener(this._prev, 'click', () => this.findPrevious()));
		this._register(addDisposableListener(this._next, 'click', () => this.findNext()));
		this._register(addDisposableListener(this._close, 'click', () => this.hide()));

		this._renderCount();
	}

	get visible(): boolean {
		return this._visible;
	}

	reveal(): void {
		this.element.classList.remove('hidden');
		this._visible = true;
		this._visibleKey.set(true);
		this._onDidChangeVisibility.fire(true);
		this._findInput.select();
		this._findInput.focus();
		this._search('closest');
	}

	hide(): void {
		if (!this._visible) {
			return;
		}
		this.element.classList.add('hidden');
		this._visible = false;
		this._visibleKey.set(false);
		this._hits = [];
		this._current = -1;
		this._host.clearFindHighlight();
		this._renderCount();
		this._onDidChangeVisibility.fire(false);
	}

	findNext(): void {
		this._move(1);
	}

	findPrevious(): void {
		this._move(-1);
	}

	refresh(): void {
		if (!this._visible) {
			return;
		}
		if (this._host.isStreaming()) {
			this._hits = [];
			this._current = -1;
			this._renderCount();
			return;
		}
		this._search('none');
	}

	private _onFindKeyDown(e: IKeyboardEvent): void {
		if (e.keyCode === KeyCode.Escape) {
			e.preventDefault();
			this.hide();
			return;
		}
		if (e.keyCode === KeyCode.Enter) {
			e.preventDefault();
			if (e.shiftKey) {
				this.findPrevious();
			} else {
				this.findNext();
			}
		}
	}

	private _scheduleSearch(): void {
		void this._searchDelayer.trigger(() => this._search('closest'));
	}

	private _search(scrollTo: 'closest' | 'none'): void {
		const query = this._findInput.getValue();
		const pattern = compileKnoxSearchPattern(query, {
			caseSensitive: this._findInput.getCaseSensitive(),
			useRegex: this._findInput.getRegex(),
			wholeWord: this._findInput.getWholeWords(),
		});
		this._hits = query ? findKnoxThreadMatches(this._host.getRows(), pattern) : [];
		if (!this._hits.length) {
			this._current = -1;
			this._host.clearFindHighlight();
			this._renderCount();
			return;
		}
		if (scrollTo === 'closest' || this._current < 0 || this._current >= this._hits.length) {
			this._current = 0;
			this._host.revealFindHit(this._hits[0]);
		}
		this._renderCount();
	}

	private _move(delta: number): void {
		if (!this._hits.length) {
			return;
		}
		this._current = knoxNextFindIndex(this._current, this._hits.length, delta);
		this._host.revealFindHit(this._hits[this._current]);
		this._renderCount();
	}

	private _renderCount(): void {
		const streaming = this._host.isStreaming();
		this._findInput.setEnabled(!streaming);
		this._prev.disabled = streaming || this._hits.length < 2;
		this._next.disabled = streaming || this._hits.length < 2;
		if (!this._hits.length) {
			this._matchesCount.textContent = localize('knox.noResults', "No results");
			return;
		}
		this._matchesCount.textContent = localize(
			'knox.matchCount',
			"{0} of {1}",
			this._current + 1,
			this._hits.length,
		);
	}

	private _iconButton(icon: KnoxGuiIconName, label: string): HTMLButtonElement {
		const button = append(this.element, $<HTMLButtonElement>('button.knox-icon-button'));
		button.type = 'button';
		button.title = label;
		button.setAttribute('aria-label', label);
		append(button, $('span')).className = knoxGuiIconClass(icon);
		return button;
	}
}
