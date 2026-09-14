/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass, KnoxGuiIconName } from '../knoxGuiIcons.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IKnoxGuiBridge, knoxProtocolObject, knoxProtocolSuccess } from '../../common/knoxGuiProtocol.js';
import {
	IKnoxMemoryItem,
	KNOX_MEMORY_BROWSER_PAGE_SIZE,
	KNOX_MEMORY_PROTOCOL,
	KNOX_MEMORY_TIER_COLORS,
	KnoxMemoryPinnedFilter,
	KnoxMemorySortBy,
	knoxDateSectionLabel,
	knoxFilterAndSortMemories,
	knoxGroupMemoriesByDate,
	knoxMemoriesToExportJson,
	knoxMemoriesToExportMarkdown,
	knoxMemoryDateLabel,
	knoxMemorySearchPayload,
	knoxMemorySnippet,
	knoxParseMemoryList,
	knoxRangeSelectIds,
} from '../../common/knoxMemory.js';

export class KnoxMemoryBrowser extends Disposable {

	readonly element: HTMLElement;

	private readonly _search: HTMLInputElement;
	private readonly _filters: HTMLElement;
	private readonly _toolbar: HTMLElement;
	private readonly _list: HTMLElement;
	private readonly _notice: HTMLElement;
	private readonly _itemStore = this._register(new DisposableStore());

	private _query = '';
	private _category = 'all';
	private _tier = 'all';
	private _pinned: KnoxMemoryPinnedFilter = 'all';
	private _sortBy: KnoxMemorySortBy = 'recent';
	private _memories: IKnoxMemoryItem[] = [];
	private _hasMore = false;
	private _loading = false;
	private _selectionMode = false;
	private _selected = new Set<number>();
	private _expandedId: number | undefined;
	private _lastClickedId: number | null = null;
	private _searchTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		parent: HTMLElement,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
		@IDialogService private readonly _dialogService: IDialogService,
		@INotificationService private readonly _notification: INotificationService,
		@IClipboardService private readonly _clipboard: IClipboardService,
	) {
		super();
		this.element = append(parent, $('.knox-memory-tab.knox-memory-browser'));
		this.element.setAttribute('role', 'region');
		this.element.setAttribute('aria-label', localize('knox.memoryBrowser', "Browser"));

		const searchWrap = append(this.element, $('.knox-history-search'));
		append(searchWrap, $('span')).className = knoxGuiIconClass('lucide-search');
		this._search = append(searchWrap, $<HTMLInputElement>('input.knox-history-search-input'));
		this._search.type = 'search';
		this._search.placeholder = localize('knox.memorySearchPlaceholder', "Search memories");
		this._search.setAttribute('aria-label', this._search.placeholder);

		this._filters = append(this.element, $('.knox-memory-filters'));
		this._toolbar = append(this.element, $('.knox-history-toolbar'));
		this._notice = append(this.element, $('.knox-memory-notice.hidden'));
		this._list = append(this.element, $('.knox-memory-list'));
		this._list.setAttribute('role', 'list');

		this._register(addDisposableListener(this._search, 'input', () => {
			this._query = this._search.value;
			if (this._searchTimer) {
				clearTimeout(this._searchTimer);
			}
			this._searchTimer = setTimeout(() => void this.refresh(), 300);
		}));
		this._register(addDisposableListener(this.element, 'keydown', e => this._onKey(e)));
		this._renderFilters();
		void this.refresh();
	}

	override dispose(): void {
		if (this._searchTimer) {
			clearTimeout(this._searchTimer);
		}
		super.dispose();
	}

	async refresh(): Promise<void> {
		await this._load(false);
	}

	private _filtered(): IKnoxMemoryItem[] {
		return knoxFilterAndSortMemories(this._memories, {
			category: this._category,
			tier: this._tier,
			pinned: this._pinned,
			sortBy: this._sortBy,
		});
	}

	private async _load(appendMore: boolean): Promise<void> {
		if (this._loading) {
			return;
		}
		this._loading = true;
		try {
			const offset = appendMore ? this._memories.length : 0;
			const searching = !!this._query.trim();
			const payload = knoxMemorySearchPayload({
				query: this._query,
				category: this._category,
				tier: this._tier,
				pinned: this._pinned,
				limit: searching ? offset + KNOX_MEMORY_BROWSER_PAGE_SIZE + 1 : KNOX_MEMORY_BROWSER_PAGE_SIZE + 1,
				offset: searching ? 0 : offset,
			});
			const items = knoxParseMemoryList(await this._bridge.request(KNOX_MEMORY_PROTOCOL.searchMemories, payload));
			if (searching) {
				const page = items.slice(offset, offset + KNOX_MEMORY_BROWSER_PAGE_SIZE);
				this._hasMore = items.length > offset + KNOX_MEMORY_BROWSER_PAGE_SIZE;
				this._memories = appendMore ? [...this._memories, ...page] : page;
			} else {
				this._hasMore = items.length > KNOX_MEMORY_BROWSER_PAGE_SIZE;
				const page = items.slice(0, KNOX_MEMORY_BROWSER_PAGE_SIZE);
				this._memories = appendMore ? [...this._memories, ...page] : page;
			}
			if (!appendMore) {
				this._selected = new Set();
				this._lastClickedId = null;
			}
		} catch (error) {
			this._notification.error(localize('knox.memoryLoadError', "Could not load memories."));
		} finally {
			this._loading = false;
			this._render();
		}
	}

	private _renderFilters(): void {
		clearNode(this._filters);
		this._select(this._filters, [
			['all', localize('knox.memoryAllCategories', "All categories")],
			...[...new Set(this._memories.map(item => item.category).filter(Boolean))].map(cat => [cat, cat] as const),
		], this._category, value => {
			this._category = value;
			void this.refresh();
		});
		this._select(this._filters, [
			['all', localize('knox.memoryAllTiers', "All tiers")],
			['hot', localize('knox.memoryTierHot', "Hot")],
			['warm', localize('knox.memoryTierWarm', "Warm")],
			['cold', localize('knox.memoryTierCold', "Cold")],
		], this._tier, value => {
			this._tier = value;
			void this.refresh();
		});
		this._select(this._filters, [
			['all', localize('knox.memoryAllPins', "All pins")],
			['pinned', localize('knox.memoryPinnedOnly', "Pinned")],
			['unpinned', localize('knox.memoryUnpinnedOnly', "Unpinned")],
		], this._pinned, value => {
			this._pinned = value as KnoxMemoryPinnedFilter;
			void this.refresh();
		});
		this._select(this._filters, [
			['recent', localize('knox.memorySortRecent', "Recent")],
			['importance', localize('knox.memorySortImportance', "Importance")],
			['accessed', localize('knox.memorySortAccessed', "Most used")],
		], this._sortBy, value => {
			this._sortBy = value as KnoxMemorySortBy;
			this._render();
		});
	}

	private _render(): void {
		this._itemStore.clear();
		clearNode(this._toolbar);
		clearNode(this._list);
		this._renderFilters();
		const filtered = this._filtered();
		const count = append(this._toolbar, $('span.knox-history-count'));
		count.textContent = localize('knox.memoryMemoriesFound', "{0} memories", filtered.length);
		if (this._selected.size) {
			const badge = append(this._toolbar, $('span.knox-history-count'));
			badge.textContent = localize('knox.selectedCount', "{0} selected", this._selected.size);
		}
		const actions = append(this._toolbar, $('.knox-history-toolbar-actions'));
		if (!this._selectionMode) {
			this._tool(actions, 'check-square', localize('knox.select', "Select"), () => {
				this._selectionMode = true;
				this._render();
			});
		} else {
			this._tool(actions, 'check-square', localize('knox.selectAll', "Select all"), () => {
				this._selected = new Set(filtered.map(item => item.id));
				this._render();
			});
			this._tool(actions, 'circle-slash', localize('knox.clear', "Clear"), () => {
				this._selected = new Set();
				this._lastClickedId = null;
				this._render();
			});
			const pin = this._tool(actions, 'pin', localize('knox.memoryPin', "Pin"), () => void this._bulkPin(true));
			pin.disabled = this._selected.size === 0;
			const unpin = this._tool(actions, 'pin-off', localize('knox.memoryUnpin', "Unpin"), () => void this._bulkPin(false));
			unpin.disabled = this._selected.size === 0;
			const json = this._tool(actions, 'file-json', 'JSON', () => void this._export('json'));
			json.disabled = this._selected.size === 0;
			const md = this._tool(actions, 'copy', 'MD', () => void this._export('markdown'));
			md.disabled = this._selected.size === 0;
			const del = this._tool(actions, 'trash-2', localize('knox.deleteCount', "Delete ({0})", this._selected.size), () => void this._confirmDelete(undefined));
			del.disabled = this._selected.size === 0;
			this._tool(actions, 'x', localize('knox.exit', "Exit"), () => {
				this._selectionMode = false;
				this._selected = new Set();
				this._render();
			});
		}

		if (!filtered.length) {
			const empty = append(this._list, $('.knox-history-empty'));
			empty.textContent = this._query || this._pinned !== 'all' || this._tier !== 'all'
				? localize('knox.memoryNoResults', "No matching memories.")
				: localize('knox.memoryNoMemoriesStored', "No memories stored yet.");
			return;
		}

		const renderRow = (parent: HTMLElement, memory: IKnoxMemoryItem) => this._renderRow(parent, memory, filtered);
		if (this._sortBy === 'recent') {
			for (const group of knoxGroupMemoriesByDate(filtered)) {
				const section = append(this._list, $('.knox-history-section'));
				const heading = append(section, $('.knox-history-section-header'));
				append(heading, $('h3')).textContent = knoxDateSectionLabel(group.headerKey);
				append(heading, $('span.knox-history-count')).textContent = String(group.memories.length);
				for (const memory of group.memories) {
					renderRow(section, memory);
				}
			}
		} else {
			for (const memory of filtered) {
				renderRow(this._list, memory);
			}
		}

		if (this._hasMore) {
			const more = append(this._list, $<HTMLButtonElement>('button.knox-history-tool'));
			more.type = 'button';
			more.textContent = localize('knox.memoryLoadMore', "Load more");
			this._itemStore.add(addDisposableListener(more, 'click', () => void this._load(true)));
		}
	}

	private _renderRow(parent: HTMLElement, memory: IKnoxMemoryItem, filtered: IKnoxMemoryItem[]): void {
		const selected = this._selected.has(memory.id);
		const row = append(parent, $('.knox-history-row.knox-memory-row'));
		row.setAttribute('role', 'listitem');
		row.classList.toggle('selected', selected);
		row.tabIndex = 0;
		if (this._selectionMode) {
			const check = append(row, $<HTMLButtonElement>('button.knox-history-check'));
			check.type = 'button';
			check.setAttribute('aria-pressed', String(selected));
			append(check, $('span')).className = knoxGuiIconClass(selected ? 'check' : 'square');
			this._itemStore.add(addDisposableListener(check, 'click', e => {
				e.stopPropagation();
				this._toggle(memory.id, e.shiftKey, filtered);
			}));
		}
		const body = append(row, $('.knox-history-row-body'));
		const title = append(body, $('.knox-history-row-title'));
		if (memory.pinned) {
			const pin = append(title, $('span'));
			pin.className = knoxGuiIconClass('pin');
		}
		append(title, $('span')).textContent = memory.title || localize('knox.untitled', "(untitled)");
		const meta = append(body, $('.knox-history-row-meta'));
		badge(meta, memory.category);
		if (memory.tier) {
			const chip = badge(meta, memory.tier);
			chip.style.color = KNOX_MEMORY_TIER_COLORS[memory.tier] ?? '';
		}
		if (this._expandedId !== memory.id) {
			append(body, $('div.knox-muted')).textContent = knoxMemorySnippet(memory.content || memory.title);
		} else {
			const detail = append(body, $('.knox-memory-detail'));
			append(detail, $('pre')).textContent = memory.content;
			append(detail, $('div.knox-muted')).textContent = [
				localize('knox.memoryDetailImportance', "Importance: {0}", (memory.importance_score ?? 0).toFixed(2)),
				localize('knox.memoryDetailUsedTimes', "Used {0}×", memory.retrieval_count ?? 0),
				localize('knox.memoryDetailCreated', "Created: {0}", knoxMemoryDateLabel(memory.created_at)),
			].join(' · ');
			if (memory.keywords) {
				const chips = append(detail, $('.knox-memory-chips'));
				for (const keyword of memory.keywords.split(',')) {
					badge(chips, keyword.trim());
				}
			}
		}
		if (!this._selectionMode) {
			const actions = append(row, $('.knox-history-actions'));
			this._icon(actions, memory.pinned ? 'pin-off' : 'pin', memory.pinned ? localize('knox.memoryUnpin', "Unpin") : localize('knox.memoryPin', "Pin"), () => void this._togglePin(memory));
			this._icon(actions, 'x', localize('knox.memoryForget', "Forget"), () => void this._confirmDelete(memory.id));
		}
		this._itemStore.add(addDisposableListener(row, 'click', e => {
			if (this._selectionMode) {
				this._toggle(memory.id, e.shiftKey, filtered);
			} else {
				this._expandedId = this._expandedId === memory.id ? undefined : memory.id;
				this._render();
			}
		}));
	}

	private _toggle(id: number, shift: boolean, filtered: IKnoxMemoryItem[]): void {
		this._selected = knoxRangeSelectIds(filtered.map(item => item.id), shift ? this._lastClickedId : null, id, this._selected);
		this._lastClickedId = id;
		this._selectionMode = true;
		this._render();
	}

	private async _togglePin(memory: IKnoxMemoryItem): Promise<void> {
		const result = await this._bridge.request(memory.pinned ? KNOX_MEMORY_PROTOCOL.unpinMemory : KNOX_MEMORY_PROTOCOL.pinMemory, { id: memory.id });
		if (knoxProtocolSuccess(result)) {
			memory.pinned = !memory.pinned;
			this._render();
		} else {
			this._notification.error(localize('knox.memoryPinFailed', "Could not update pin."));
		}
	}

	private async _bulkPin(pin: boolean): Promise<void> {
		const ids = [...this._selected];
		if (!ids.length) {
			return;
		}
		const result = await this._bridge.request(pin ? KNOX_MEMORY_PROTOCOL.pinMemories : KNOX_MEMORY_PROTOCOL.unpinMemories, { ids });
		if (knoxProtocolSuccess(result)) {
			const failed = Number(knoxProtocolObject(result)?.failed ?? 0);
			this._memories = this._memories.map(item => this._selected.has(item.id) ? { ...item, pinned: pin } : item);
			if (failed > 0) {
				this._notification.error(localize('knox.memoryBulkPinPartialFail', "{0} memories failed to update.", failed));
			} else {
				this._flash(pin ? localize('knox.memoryBulkPinned', "Pinned selected memories.") : localize('knox.memoryBulkUnpinned', "Unpinned selected memories."));
			}
			this._render();
		} else {
			this._notification.error(localize('knox.memoryPinFailed', "Could not update pin."));
		}
	}

	private async _export(format: 'json' | 'markdown'): Promise<void> {
		const selected = this._filtered().filter(item => this._selected.has(item.id));
		if (!selected.length) {
			return;
		}
		const text = format === 'json' ? knoxMemoriesToExportJson(selected) : knoxMemoriesToExportMarkdown(selected);
		try {
			await this._clipboard.writeText(text);
			this._flash(localize('knox.memoryExportSelectedCopied', "Copied {0} memories.", selected.length));
		} catch {
			this._notification.error(localize('knox.memoryExportSelectedFailed', "Could not copy export."));
		}
	}

	private async _confirmDelete(id: number | undefined): Promise<void> {
		const bulk = id === undefined;
		const confirmed = await this._dialogService.confirm({
			type: 'warning',
			message: localize('knox.memoryConfirmDelete', "Forget memories"),
			detail: bulk
				? localize('knox.memoryConfirmBulkDelete', "Delete {0} memories? This cannot be undone.", this._selected.size)
				: localize('knox.memoryConfirmDeleteSingle', "Forget this memory? This cannot be undone."),
			primaryButton: localize('knox.delete', "Delete"),
		});
		if (!confirmed.confirmed) {
			return;
		}
		if (bulk) {
			const ids = [...this._selected];
			const result = await this._bridge.request(KNOX_MEMORY_PROTOCOL.deleteMemories, { ids });
			const deleted = Number(knoxProtocolObject(result)?.deleted ?? 0);
			const failed = Number(knoxProtocolObject(result)?.failed ?? Math.max(0, ids.length - deleted));
			this._memories = this._memories.filter(item => !this._selected.has(item.id));
			this._selected = new Set();
			this._selectionMode = false;
			if (failed > 0) {
				this._notification.error(localize('knox.memoryBulkDeletePartialFail', "{0} memories failed to delete.", failed));
			}
			this._render();
			return;
		}
		const result = await this._bridge.request(KNOX_MEMORY_PROTOCOL.deleteMemory, { id });
		if (knoxProtocolSuccess(result)) {
			this._memories = this._memories.filter(item => item.id !== id);
			this._selected.delete(id);
			this._render();
		} else {
			this._notification.error(localize('knox.memoryDeleteFailed', "Could not forget memory."));
		}
	}

	private _onKey(e: KeyboardEvent): void {
		if (!this._selectionMode) {
			return;
		}
		if (e.key === 'Escape') {
			this._selectionMode = false;
			this._selected = new Set();
			this._render();
			return;
		}
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
			const target = e.target as HTMLElement | null;
			if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
				return;
			}
			e.preventDefault();
			this._selected = new Set(this._filtered().map(item => item.id));
			this._render();
		}
	}

	private _flash(message: string): void {
		this._notice.classList.remove('hidden');
		this._notice.textContent = message;
		setTimeout(() => this._notice.classList.add('hidden'), 4000);
	}

	private _select(parent: HTMLElement, options: ReadonlyArray<readonly [string, string]>, value: string, onChange: (value: string) => void): void {
		const select = append(parent, $<HTMLSelectElement>('select.knox-memory-select'));
		for (const [id, label] of options) {
			const option = append(select, $<HTMLOptionElement>('option'));
			option.value = id;
			option.textContent = label;
		}
		select.value = value;
		this._itemStore.add(addDisposableListener(select, 'change', () => onChange(select.value)));
	}

	private _tool(parent: HTMLElement, icon: KnoxGuiIconName, label: string, run: () => void): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button.knox-history-tool'));
		button.type = 'button';
		append(button, $('span')).className = knoxGuiIconClass(icon);
		append(button, $('span')).textContent = label;
		this._itemStore.add(addDisposableListener(button, 'click', run));
		return button;
	}

	private _icon(parent: HTMLElement, icon: KnoxGuiIconName, title: string, run: () => void): void {
		const button = append(parent, $<HTMLButtonElement>('button.knox-history-tool'));
		button.type = 'button';
		button.title = title;
		append(button, $('span')).className = knoxGuiIconClass(icon);
		this._itemStore.add(addDisposableListener(button, 'click', e => {
			e.stopPropagation();
			run();
		}));
	}
}

function badge(parent: HTMLElement, text: string): HTMLElement {
	const chip = append(parent, $('span.knox-memory-chip'));
	chip.textContent = text;
	return chip;
}
