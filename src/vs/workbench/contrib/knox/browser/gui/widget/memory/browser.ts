/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Memories tab: search, filters, selection mode, toolbar, date-grouped rows and the delete confirmation. */

import * as DOM from '../../../../../../../base/browser/dom.js';
import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import { KnoxGuiSvgIcon } from '../../knoxGuiIcons.js';
import {
	filterAndSortMemories,
	formatMemoryDate,
	groupMemoriesByDate,
	memoriesToExportJson,
	memoriesToExportMarkdown,
	MEMORY_BROWSER_CATEGORY_ICONS,
	MEMORY_TIER_COLORS,
	memoryBrowserEmptyKey,
	memorySnippet,
	rangeSelectMemoryIds,
	uniqueMemoryCategories,
} from '../../../../common/knoxGuiMemory.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import {
	memoryClasses,
	mk,
	svg,
	spinner,
	memoryButton,
	memoryConfirmDialog,
} from './kit.js';
import { applyMemoryBrowserFilter } from './filters.js';

export function renderMemoryBrowser(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void { // KN-376 KN-311
	body.classList.add(...memoryClasses('py-4 sy-3').split(' '));
	renderMemoryDeleteDialog(widget, body, state);
	const resetSelection = () => {
		widget.memorySelectedIds.clear();
		widget.memoryLastClickedId = null;
	};
	const reload = () => {
		resetSelection();
		void widget.controller.loadMemories(false);
	};
	if (state.memoryBrowserError) {
		const banner = mk(body, 'div', 'banner is-error');
		banner.setAttribute('data-testid', 'memory-browser-error');
		svg(banner, 'x', 14);
		mk(banner, 'span', 'flex-1', t(state, state.memoryBrowserError.key, { count: state.memoryBrowserError.count ?? 0 }));
		memoryButton(widget, banner, { tokens: 'banner-close', icon: 'x', ariaLabel: t(state, 'close'), onClick: () => widget.controller.showMemoryBanner('error', undefined) });
	}
	if (state.memoryBrowserNotice) {
		const banner = mk(body, 'div', 'banner is-notice');
		banner.setAttribute('data-testid', 'memory-browser-notice');
		svg(banner, 'check', 14);
		mk(banner, 'span', 'flex-1', t(state, state.memoryBrowserNotice.key, { count: state.memoryBrowserNotice.count ?? 0 }));
	}
	const searchWrap = mk(body, 'div', 'search knox-gui-memory-search');
	const input = mk(searchWrap, 'input', 'field search-input');
	input.type = 'text';
	input.placeholder = t(state, 'memorySearchPlaceholder');
	input.value = widget.memorySearchDraft || state.memoryQuery;
	svg(searchWrap, 'search', 14, 'search-icon o-50');
	widget.renderStore.add(DOM.addDisposableListener(input, 'input', () => {
		widget.memorySearchDraft = input.value;
		clear.hidden = !input.value;
		applyMemoryBrowserFilter(widget, widget.controller.store.state);
		if (widget.memorySearchTimer) {
			clearTimeout(widget.memorySearchTimer);
		}
		widget.memorySearchTimer = setTimeout(() => {
			widget.controller.store.patch({ memoryQuery: widget.memorySearchDraft });
			reload();
		}, 300);
	}));
	const clear = memoryButton(widget, searchWrap, {
		tokens: 'search-clear',
		icon: 'x',
		ariaLabel: t(state, 'clearSearch'),
		onClick: () => {
			widget.memorySearchDraft = '';
			input.value = '';
			clear.hidden = true;
			if (widget.memorySearchTimer) {
				clearTimeout(widget.memorySearchTimer);
				widget.memorySearchTimer = undefined;
			}
			applyMemoryBrowserFilter(widget, widget.controller.store.state);
			widget.controller.store.patch({ memoryQuery: '' });
			reload();
			input.focus();
		},
	});
	clear.hidden = !(widget.memorySearchDraft || state.memoryQuery);

	const filters = mk(body, 'div', 'flex flex-wrap items-center gap-2 xs');
	const filterSelect = (options: ReadonlyArray<readonly [string, string]>, current: string, onChange: (value: string) => void): HTMLSelectElement => {
		const select = mk(filters, 'select', 'dropdown');
		for (const [value, label] of options) {
			const el = mk(select, 'option', '', label);
			el.value = value;
			el.selected = value === current;
		}
		widget.renderStore.add(DOM.addDisposableListener(select, 'change', () => onChange(select.value)));
		return select;
	};
	filterSelect([['all', t(state, 'memoryAllCategories')], ...uniqueMemoryCategories(state.memories).map(cat => [cat, cat] as const)], state.memoryFilterCategory, value => {
		widget.controller.store.patch({ memoryFilterCategory: value });
		reload();
	});
	filterSelect([['all', t(state, 'memoryAllTiers')], ['hot', t(state, 'memoryTierHot')], ['warm', t(state, 'memoryTierWarm')], ['cold', t(state, 'memoryTierCold')]], state.memoryFilterTier, value => {
		widget.controller.store.patch({ memoryFilterTier: value });
		reload();
	}).setAttribute('data-testid', 'memory-filter-tier');
	filterSelect([['all', t(state, 'memoryAllPins')], ['pinned', t(state, 'memoryPinnedOnly')], ['unpinned', t(state, 'memoryUnpinnedOnly')]], state.memoryFilterPinned, value => {
		widget.controller.store.patch({ memoryFilterPinned: value as IKnoxGuiState['memoryFilterPinned'] });
		reload();
	}).setAttribute('aria-label', t(state, 'memoryAllPins'));
	filterSelect([['recent', t(state, 'memorySortRecent')], ['importance', t(state, 'memorySortImportance')], ['accessed', t(state, 'memorySortAccessed')]], state.memorySortBy, value => {
		widget.controller.store.patch({ memorySortBy: value as IKnoxGuiState['memorySortBy'] });
	});

	const memories = filterAndSortMemories(state.memories, {
		category: state.memoryFilterCategory,
		tier: state.memoryFilterTier,
		pinned: state.memoryFilterPinned,
		sortBy: state.memorySortBy,
	});
	const orderedIds = memories.map(memory => memory.id);
	const selectAll = () => {
		widget.memorySelectedIds = new Set(orderedIds);
		widget.memorySelectionMode = true;
		widget.render();
	};
	const exitSelection = () => {
		widget.memorySelectionMode = false;
		resetSelection();
		widget.render();
	};
	if (widget.memorySelectionMode) {
		widget.renderStore.add(DOM.addDisposableListener(DOM.getWindow(body), 'keydown', (e: KeyboardEvent) => {
			if (widget.memoryConfirmDeleteIds) {
				return;
			}
			if (e.key === 'Escape') {
				exitSelection();
				return;
			}
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
				const target = e.target as HTMLElement | null;
				if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
					return;
				}
				e.preventDefault();
				selectAll();
			}
		}));
	}

	const toolbar = mk(body, 'div', 'browser-toolbar');
	const counts = mk(toolbar, 'div', 'flex items-center gap-2 xs o-70');
	if (widget.memorySelectedIds.size) {
		const badge = mk(counts, 'span', 'selected-badge');
		badge.setAttribute('data-testid', 'memory-selected-count');
		svg(badge, 'check', 10);
		mk(badge, 'span', '', t(state, 'selectedCount', { count: widget.memorySelectedIds.size }));
	}
	const found = mk(counts, 'span', '', `${memories.length} ${t(state, 'memoryMemoriesFound')}`);
	found.setAttribute('data-memory-found-count', '1');
	const tools = mk(toolbar, 'div', 'flex flex-wrap items-center gap-1');
	const selected = [...widget.memorySelectedIds];
	const busy = state.memoryBrowserBusy;
	const toolButton = (icon: KnoxGuiSvgIcon, label: string, title: string, onClick: () => void, options?: { disabled?: boolean; danger?: boolean; smInline?: boolean }) => memoryButton(widget, tools, {
		tokens: options?.danger ? 'toolbar-btn is-danger' : 'toolbar-btn btn-secondary',
		icon,
		label,
		labelTokens: options?.smInline ? 'sm-inline' : '',
		title,
		disabled: options?.disabled,
		onClick,
	});
	if (!widget.memorySelectionMode) {
		toolButton('check-square', t(state, 'select'), t(state, 'memorySelectMultiple'), () => { widget.memorySelectionMode = true; widget.render(); });
	} else {
		toolButton('check-square', t(state, 'selectAll'), t(state, 'memorySelectAllMemories'), selectAll);
		toolButton('square', t(state, 'clear'), t(state, 'clearAllSelections'), () => { resetSelection(); widget.render(); });
		toolButton('pin', t(state, 'memoryPin'), t(state, 'memoryPinSelected'), () => void widget.controller.pinMemories(selected, true, true), { disabled: !selected.length || busy, smInline: true });
		toolButton('pin-off', t(state, 'memoryUnpin'), t(state, 'memoryUnpinSelected'), () => void widget.controller.pinMemories(selected, false, true), { disabled: !selected.length || busy, smInline: true });
		const exportSelected = (format: 'json' | 'markdown') => {
			const picked = memories.filter(memory => widget.memorySelectedIds.has(memory.id));
			if (!picked.length) {
				return;
			}
			const text = format === 'json' ? memoriesToExportJson(picked) : memoriesToExportMarkdown(picked);
			void widget.controller.messenger.request('copyText', { text }).then(
				() => widget.controller.showMemoryBanner('notice', { key: 'memoryExportSelectedCopied', count: picked.length }),
				() => widget.controller.showMemoryBanner('error', { key: 'memoryExportSelectedFailed' }),
			);
		};
		toolButton('file-json', 'JSON', t(state, 'memoryExportSelectedJson'), () => exportSelected('json'), { disabled: !selected.length });
		toolButton('copy', 'MD', t(state, 'memoryExportSelectedMarkdown'), () => exportSelected('markdown'), { disabled: !selected.length });
		toolButton('trash-2', t(state, 'deleteCount', { count: selected.length }), t(state, 'memoryDeleteSelected'), () => { widget.memoryConfirmDeleteIds = selected; widget.memoryConfirmDeleteBulk = true; widget.render(); }, { disabled: !selected.length || busy, danger: true });
		toolButton('x', t(state, 'exit'), t(state, 'exitSelectionMode'), exitSelection);
	}

	if (widget.memorySelectionMode && memories.length) {
		const all = orderedIds.every(id => widget.memorySelectedIds.has(id));
		const some = orderedIds.some(id => widget.memorySelectedIds.has(id));
		const header = mk(body, 'button', 'select-all');
		header.type = 'button';
		header.setAttribute('data-testid', 'memory-select-all-header');
		const box = mk(header, 'span', 'check');
		box.setAttribute('role', 'checkbox');
		box.setAttribute('aria-checked', all ? 'true' : some ? 'mixed' : 'false');
		if (some) {
			box.style.borderColor = '#159994';
		}
		if (all) {
			box.style.backgroundColor = '#159994';
			svg(box, 'check', 10);
		} else if (some) {
			mk(box, 'span', 'check-dot');
		}
		mk(header, 'span', '', all ? t(state, 'clear') : t(state, 'selectAll'));
		widget.renderStore.add(DOM.addDisposableListener(header, 'click', () => {
			if (all) {
				resetSelection();
				widget.render();
			} else {
				selectAll();
			}
		}));
	}

	const list = mk(body, 'div', 'sy-2');
	if (state.memoriesLoading) {
		const loading = mk(list, 'div', 'py-8 text-center');
		loading.setAttribute('data-testid', 'memory-browser-loading');
		spinner(loading, 24).classList.add('knox-gui-memory-mx-auto');
		return;
	}
	if (!memories.length) {
		mk(list, 'div', 'py-8 text-center sm o-50', t(state, memoryBrowserEmptyKey(state.memoryQuery, state.memoryFilterPinned, state.memoryFilterTier)));
		return;
	}
	if (state.memorySortBy === 'recent') {
		for (const group of groupMemoriesByDate(memories)) {
			const section = mk(list, 'div', 'sy-2 knox-gui-memory-date-group');
			const head = mk(section, 'div', 'kv pt-1');
			mk(head, 'h2', 'xs fw-6 o-70', t(state, group.headerKey));
			const groupCount = mk(head, 'span', 't-10 o-50', t(state, 'itemsCount', { count: group.memories.length }));
			groupCount.setAttribute('data-memory-group-count', '1');
			for (const memory of group.memories) {
				renderMemoryRow(widget, section, state, memory, orderedIds);
			}
		}
	} else {
		for (const memory of memories) {
			renderMemoryRow(widget, list, state, memory, orderedIds);
		}
	}
	const empty = mk(list, 'div', 'py-8 text-center sm o-50', t(state, memoryBrowserEmptyKey(widget.memorySearchDraft || state.memoryQuery, state.memoryFilterPinned, state.memoryFilterTier)));
	empty.setAttribute('data-memory-empty', '1');
	applyMemoryBrowserFilter(widget, state);
	if (state.memoryHasMore) {
		const more = mk(body, 'div', 'flex justify-center pt-2');
		const button = memoryButton(widget, more, {
			tokens: 'load-more btn-secondary',
			icon: state.memoriesLoadingMore ? undefined : 'chevron-down',
			iconSize: 14,
			label: t(state, 'memoryLoadMore'),
			disabled: state.memoriesLoadingMore,
			testId: 'memory-load-more',
			onClick: () => void widget.controller.loadMemories(true),
		});
		if (state.memoriesLoadingMore) {
			button.prepend(spinner(button, 12, 1));
		}
	}
}

function renderMemoryRow(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, memory: IKnoxGuiState['memories'][number], orderedIds: string[]): void {
	const selected = widget.memorySelectedIds.has(memory.id);
	const row = mk(body, 'div', selected ? 'memory-row selected' : 'memory-row');
	row.setAttribute('data-testid', `memory-row-${memory.id}`);
	row.setAttribute('data-memory-id', memory.id);
	if (widget.memorySelectionMode) {
		row.classList.add('is-selecting');
	}
	widget.renderStore.add(DOM.addDisposableListener(row, 'click', e => {
		if (widget.memorySelectionMode) {
			widget.memorySelectedIds = rangeSelectMemoryIds(orderedIds, e.shiftKey ? widget.memoryLastClickedId : null, memory.id, widget.memorySelectedIds);
			widget.memoryLastClickedId = memory.id;
		} else if (!(e.target as HTMLElement).closest('button')) {
			widget.memoryExpandedId = widget.memoryExpandedId === memory.id ? null : memory.id;
		}
		widget.render();
	}));
	const head = mk(row, 'div', 'flex items-center gap-2');
	if (widget.memorySelectionMode) {
		const box = mk(head, 'span', 'check xs');
		box.setAttribute('role', 'checkbox');
		box.setAttribute('aria-checked', String(selected));
		box.setAttribute('aria-label', t(state, 'memorySelectRow', { title: memory.title }));
		if (selected) {
			box.style.borderColor = '#159994';
			box.style.backgroundColor = '#159994';
			svg(box, 'check', 10);
		}
	}
	svg(mk(head, 'span', 'sm'), (MEMORY_BROWSER_CATEGORY_ICONS[memory.category ?? ''] as KnoxGuiSvgIcon) || 'file', 14);
	if (memory.category) {
		mk(head, 'span', 'row-badge badge-colors', memory.category);
	}
	if (memory.tier) {
		const color = MEMORY_TIER_COLORS[memory.tier];
		if (color) {
			const badge = mk(head, 'span', 'row-badge knox-gui-tier', memory.tier);
			badge.style.backgroundColor = color.bg;
			badge.style.color = color.text;
		}
	}
	const title = mk(head, 'span', 'flex-1 truncate sm fw-5');
	if (memory.pinned) {
		svg(title, 'pin', 11, 'row-pin teal');
	}
	title.append(memory.title);
	if (!widget.memorySelectionMode) {
		const hover = mk(head, 'div', 'row-actions');
		memoryButton(widget, hover, {
			tokens: 'row-action',
			icon: memory.pinned ? 'pin-off' : 'pin',
			iconTokens: memory.pinned ? 'teal' : undefined,
			title: memory.pinned ? t(state, 'memoryUnpin') : t(state, 'memoryPin'),
			onClick: () => void widget.controller.pinMemories([memory.id], !memory.pinned, false),
		});
		memoryButton(widget, hover, {
			tokens: 'row-action is-forget',
			icon: 'x',
			title: t(state, 'memoryForget'),
			onClick: () => { widget.memoryConfirmDeleteIds = [memory.id]; widget.memoryConfirmDeleteBulk = false; widget.render(); },
		});
	}
	if (widget.memoryExpandedId !== memory.id) {
		mk(row, 'div', 'mt-1 truncate pl-6 xs o-55', memorySnippet(memory.content ?? memory.title));
	} else if (!widget.memorySelectionMode) {
		const detail = mk(row, 'div', 'divided mt-2 pt-2 sy-2');
		mk(detail, 'pre', 'raw-md xs o-80 knox-gui-raw-md', memory.content ?? '');
		const meta = mk(detail, 'div', 'flex flex-wrap gap-3 xs o-50');
		mk(meta, 'span', '', `${t(state, 'memoryDetailImportance')}: ${(memory.importance ?? 0).toFixed(2)}`);
		mk(meta, 'span', '', `${t(state, 'memoryDetailUsed')}: ${t(state, 'memoryDetailUsedTimes', { count: memory.retrievalCount ?? 0 })}`);
		if (memory.createdAt) {
			mk(meta, 'span', '', `${t(state, 'memoryDetailCreated')}: ${formatMemoryDate(memory.createdAt)}`);
		}
		if (memory.lastAccessedAt) {
			mk(meta, 'span', '', `${t(state, 'memoryDetailLastAccessed')}: ${formatMemoryDate(memory.lastAccessedAt)}`);
		}
		if (memory.sourceSessionId) {
			mk(meta, 'span', '', `${t(state, 'memoryDetailSession')}: ${memory.sourceSessionId.slice(0, 8)}…`);
		}
		if (memory.keywords) {
			const chips = mk(detail, 'div', 'flex flex-wrap gap-1');
			for (const kw of memory.keywords.split(',')) {
				mk(chips, 'span', 'tag-chip badge-colors xs', kw.trim());
			}
		}
	}
}

function renderMemoryDeleteDialog(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	if (!widget.memoryConfirmDeleteIds) {
		return;
	}
	const busy = state.memoryBrowserBusy;
	const close = () => {
		if (!busy) {
			widget.memoryConfirmDeleteIds = null;
			widget.render();
		}
	};
	const overlay = memoryConfirmDialog(widget, body, {
		title: t(state, 'memoryConfirmDelete'),
		lines: [
			{ text: widget.memoryConfirmDeleteBulk ? t(state, 'memoryConfirmBulkDelete', { count: widget.memoryConfirmDeleteIds.length }) : t(state, 'memoryConfirmDeleteSingle'), tokens: 'mb-2 xs o-70' },
			{ text: t(state, 'cannotBeUndone'), tokens: 'mb-4 xs o-50' },
		],
		cancelLabel: t(state, 'cancel'),
		confirmLabel: t(state, 'deleteAction'),
		busy,
		confirmTestId: 'memory-confirm-delete',
		onCancel: close,
		onConfirm: () => {
			const ids = widget.memoryConfirmDeleteIds ?? [];
			const bulk = widget.memoryConfirmDeleteBulk;
			void widget.controller.deleteMemories(ids, bulk).then(() => {
				widget.memoryConfirmDeleteIds = null;
				widget.memoryConfirmDeleteBulk = false;
				if (bulk) {
					widget.memorySelectedIds.clear();
					widget.memoryLastClickedId = null;
					widget.memorySelectionMode = false;
				} else {
					widget.memorySelectedIds.delete(ids[0]);
				}
				widget.render();
			});
		},
	});
	widget.renderStore.add(DOM.addDisposableListener(overlay, 'click', e => {
		if (e.target === overlay) {
			close();
		}
	}));
}
