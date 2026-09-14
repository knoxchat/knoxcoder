/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { Delayer } from '../../../../../base/common/async.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass, KnoxGuiIconName } from '../knoxGuiIcons.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import {
	CHECKPOINT_LIST_PAGE_SIZE,
	chronologicalCheckpointPair,
	IKnoxCheckpointCatalogItem,
	IKnoxCheckpointDiff,
	IKnoxCheckpointMetadata,
	IKnoxCheckpointWorkspaceFolder,
	IKnoxRestorePreview,
	knoxFilterCheckpoints,
	parseKnoxCheckpointDiff,
	parseKnoxCheckpointList,
	parseKnoxRestorePreview,
	selectCheckpointIdRange,
} from '../../common/knoxCheckpoints.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { IKnoxGuiBridge, knoxProtocolSuccess } from '../../common/knoxGuiProtocol.js';
import {
	formatKnoxSessionDate,
	knoxGroupByDate,
	parseKnoxSessionDate,
} from '../../common/knoxHistory.js';
import { knoxOpenCheckpointFileDiff } from './knoxCheckpointDiff.js';

/**
 * Checkpoint list tab (T7.3) with restore preview (T7.4) and compare (T7.5).
 */
export class KnoxCheckpointList extends Disposable {

	readonly element: HTMLElement;

	private readonly _search: HTMLInputElement;
	private readonly _sessionFilter: HTMLInputElement;
	private readonly _workspace: HTMLSelectElement;
	private readonly _toolbar: HTMLElement;
	private readonly _list: HTMLElement;
	private readonly _empty: HTMLElement;
	private readonly _status: HTMLElement;
	private readonly _modal: HTMLElement;
	private readonly _itemStore = this._register(new DisposableStore());
	private readonly _modalStore = this._register(new DisposableStore());
	private readonly _searchDelayer: Delayer<void>;

	private _query = '';
	private _debouncedQuery = '';
	private _thisSessionOnly = true;
	private _selectionMode = false;
	private _selected = new Set<string>();
	private _focusedId: string | undefined;
	private _selectionAnchorId: string | undefined;
	private _checkpoints: IKnoxCheckpointMetadata[] = [];
	private _compareCatalog: IKnoxCheckpointCatalogItem[] = [];
	private _workspaceFolders: IKnoxCheckpointWorkspaceFolder[] = [];
	private _activeWorkspacePath: string | undefined;
	private _total = 0;
	private _hasMore = false;
	private _loading = false;
	private _loadingMore = false;
	private _restoreId: string | undefined;
	private _restoreRewind = false;
	private _compare: { leftId: string; rightId: string } | undefined;

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
		@IDialogService private readonly _dialogService: IDialogService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IHoverService private readonly _hoverService: IHoverService,
		@IClipboardService private readonly _clipboardService: IClipboardService,
		@IEditorService private readonly _editorService: IEditorService,
	) {
		super();
		this._searchDelayer = this._register(new Delayer<void>(250));
		this.element = append(parent, $('.knox-checkpoint-list'));
		this.element.tabIndex = 0;
		this.element.setAttribute('data-testid', 'checkpoint-list');
		this.element.setAttribute('role', 'region');
		this.element.setAttribute('aria-label', localize('knox.checkpoints', "Checkpoints"));

		const header = append(this.element, $('.knox-history-header'));
		const titleRow = append(header, $('.knox-history-title-row'));
		append(titleRow, $('h2.knox-history-title')).textContent = localize('knox.checkpoints', "Checkpoints");
		this._status = append(titleRow, $('span.knox-history-count'));

		const sessionRow = append(header, $('.knox-checkpoint-filters'));
		const sessionLabel = append(sessionRow, $('label.knox-checkpoint-filter'));
		this._sessionFilter = append(sessionLabel, $<HTMLInputElement>('input'));
		this._sessionFilter.type = 'checkbox';
		this._sessionFilter.checked = true;
		append(sessionLabel, $('span')).textContent = localize('knox.thisSessionOnly', "This session");

		this._workspace = append(sessionRow, $<HTMLSelectElement>('select.knox-checkpoint-workspace'));
		this._workspace.setAttribute('aria-label', localize('knox.workspace', "Workspace"));

		const searchWrap = append(header, $('.knox-history-search'));
		append(searchWrap, $('span')).className = knoxGuiIconClass('lucide-search');
		this._search = append(searchWrap, $<HTMLInputElement>('input.knox-history-search-input'));
		this._search.type = 'search';
		this._search.placeholder = localize('knox.searchCheckpoints', "Search checkpoints");

		this._toolbar = append(this.element, $('.knox-history-toolbar'));
		this._empty = append(this.element, $('.knox-history-empty.hidden'));
		this._list = append(this.element, $('.knox-history-list'));
		this._modal = append(this.element, $('.knox-modal.hidden'));

		this._register(addDisposableListener(this._search, 'input', () => {
			this._query = this._search.value;
			this._searchDelayer.trigger(() => {
				this._debouncedQuery = this._query;
				void this.refresh();
			});
			this._render();
		}));
		this._register(addDisposableListener(this._sessionFilter, 'change', () => {
			this._thisSessionOnly = this._sessionFilter.checked;
			void this.refresh();
		}));
		this._register(addDisposableListener(this._workspace, 'change', () => void this._switchWorkspace(this._workspace.value)));
		this._register(addDisposableListener(this.element, 'keydown', e => this._onKeyDown(e)));
		this._register(addDisposableListener(this.element, 'scroll', () => this._maybeLoadMore()));
		this._register(this._bridge.onDidReceivePush(message => {
			if (message.messageType === 'checkpointListUpdated') {
				void this.refresh();
			}
		}));
		void this.refresh();
	}

	async refresh(): Promise<void> {
		await this._load({ append: false });
	}

	private async _load(options: { append: boolean }): Promise<void> {
		if (this._loading || (options.append && this._loadingMore)) {
			return;
		}
		if (options.append) {
			this._loadingMore = true;
		} else {
			this._loading = true;
		}
		try {
			const result = await this._bridge.request('listCheckpoints', {
				query: this._debouncedQuery.trim() || undefined,
				offset: options.append ? this._checkpoints.length : 0,
				limit: CHECKPOINT_LIST_PAGE_SIZE,
				sessionId: this._thisSessionOnly ? this._chatService.sessionId : undefined,
				thisSessionOnly: this._thisSessionOnly,
			});
			const listed = parseKnoxCheckpointList(result);
			if (options.append) {
				const seen = new Set(this._checkpoints.map(item => item.id));
				this._checkpoints = [...this._checkpoints, ...listed.checkpoints.filter(item => !seen.has(item.id))];
			} else {
				this._checkpoints = listed.checkpoints;
				this._compareCatalog = listed.compareCatalog;
			}
			this._total = listed.total;
			this._hasMore = listed.hasMore;
			this._workspaceFolders = listed.workspaceFolders;
			this._activeWorkspacePath = listed.activeWorkspacePath;
		} catch (error) {
			if (!options.append) {
				this._checkpoints = [];
				this._total = 0;
				this._hasMore = false;
			}
			this._notificationService.error(error instanceof Error ? error.message : String(error));
		} finally {
			this._loading = false;
			this._loadingMore = false;
			this._render();
		}
	}

	private _filtered(): IKnoxCheckpointMetadata[] {
		return knoxFilterCheckpoints(this._checkpoints, this._query);
	}

	private _render(): void {
		this._itemStore.clear();
		clearNode(this._toolbar);
		clearNode(this._list);
		clearNode(this._empty);
		this._syncWorkspaceSelect();

		const items = this._filtered();
		this._status.textContent = localize('knox.showingCheckpoints', "Showing {0} of {1}", items.length, this._total || items.length);
		this._renderToolbar(items);

		if (this._loading && !this._checkpoints.length) {
			this._empty.classList.remove('hidden');
			this._empty.textContent = localize('knox.loadingCheckpoints', "Loading checkpoints…");
			this._list.classList.add('hidden');
			this._onDidChangeHeight.fire();
			return;
		}

		if (!items.length) {
			this._empty.classList.remove('hidden');
			this._empty.textContent = localize('knox.noCheckpointsFound', "No checkpoints found");
			this._list.classList.add('hidden');
			this._onDidChangeHeight.fire();
			return;
		}

		this._empty.classList.add('hidden');
		this._list.classList.remove('hidden');
		const groups = knoxGroupByDate(items, item => parseKnoxSessionDate(item.dateCreated));
		for (const group of groups) {
			const section = append(this._list, $('.knox-history-section'));
			const heading = append(section, $('.knox-history-section-header'));
			append(heading, $('h3')).textContent = group.header;
			append(heading, $('span.knox-history-count')).textContent = String(group.items.length);
			for (const checkpoint of group.items) {
				this._renderRow(section, checkpoint);
			}
		}
		if (this._hasMore) {
			const more = append(this._list, $<HTMLButtonElement>('button.knox-history-tool'));
			more.type = 'button';
			more.textContent = this._loadingMore
				? localize('knox.loadingCheckpoints', "Loading checkpoints…")
				: localize('knox.loadMoreCheckpoints', "Load more");
			this._itemStore.add(addDisposableListener(more, 'click', () => void this._load({ append: true })));
		}
		this._renderModal();
		this._onDidChangeHeight.fire();
	}

	private _syncWorkspaceSelect(): void {
		const current = this._workspace.value;
		clearNode(this._workspace);
		if (!this._workspaceFolders.length) {
			this._workspace.classList.add('hidden');
			return;
		}
		this._workspace.classList.remove('hidden');
		for (const folder of this._workspaceFolders) {
			const option = append(this._workspace, $<HTMLOptionElement>('option'));
			option.value = folder.path;
			option.textContent = folder.name;
		}
		this._workspace.value = this._activeWorkspacePath || current || this._workspaceFolders[0].path;
	}

	private _renderToolbar(items: readonly IKnoxCheckpointMetadata[]): void {
		if (this._selected.size) {
			append(this._toolbar, $('span.knox-history-count')).textContent = String(this._selected.size);
		}
		const actions = append(this._toolbar, $('.knox-history-toolbar-actions'));
		if (!this._selectionMode) {
			this._toolButton(actions, 'check-square', localize('knox.select', "Select"), () => {
				this._selectionMode = true;
				this._render();
			});
			return;
		}
		this._toolButton(actions, 'check-square', localize('knox.selectAll', "Select all"), () => {
			this._selected = new Set(items.map(item => item.id));
			this._render();
		});
		this._toolButton(actions, 'circle-slash', localize('knox.clear', "Clear"), () => {
			this._selected = new Set();
			this._render();
		});
		const compare = this._toolButton(actions, 'git-compare', localize('knox.compare', "Compare"), () => this._openCompareForSelection());
		compare.disabled = this._selected.size !== 2;
		const del = this._toolButton(actions, 'trash-2', localize('knox.delete', "Delete"), () => void this._confirmDeleteSelected());
		del.disabled = this._selected.size === 0;
		this._toolButton(actions, 'x', localize('knox.exit', "Exit"), () => {
			this._selectionMode = false;
			this._selected = new Set();
			this._render();
		});
	}

	private _renderRow(parent: HTMLElement, checkpoint: IKnoxCheckpointMetadata): void {
		const selected = this._selected.has(checkpoint.id);
		const focused = this._focusedId === checkpoint.id;
		const row = append(parent, $('.knox-history-row.knox-checkpoint-row'));
		row.setAttribute('data-testid', 'checkpoint-row');
		row.setAttribute('data-checkpoint-id', checkpoint.id);
		row.classList.toggle('selected', selected);
		row.classList.toggle('focused', focused);
		row.tabIndex = 0;

		if (this._selectionMode) {
			const check = append(row, $<HTMLButtonElement>('button.knox-history-check'));
			check.type = 'button';
			append(check, $('span')).className = knoxGuiIconClass(selected ? 'check' : 'square');
			this._itemStore.add(addDisposableListener(check, 'click', e => {
				e.stopPropagation();
				this._select(checkpoint.id, !selected, e.shiftKey);
			}));
		}

		const body = append(row, $('.knox-history-row-body'));
		const title = append(body, $('span.knox-history-row-title'));
		title.textContent = checkpoint.description || checkpoint.id;
		if (checkpoint.pinned) {
			const pin = append(title, $('span.knox-checkpoint-pin'));
			pin.className = knoxGuiIconClass('pin');
			pin.title = localize('knox.pinned', "Pinned");
		}
		const meta = append(body, $('.knox-history-row-meta'));
		const date = parseKnoxSessionDate(checkpoint.dateCreated);
		append(meta, $('time')).textContent = formatKnoxSessionDate(date);
		if (checkpoint.fileStats) {
			append(meta, $('span')).textContent = localize('knox.checkpointFiles', "{0} files", checkpoint.fileStats.total);
		}

		const actions = append(row, $('.knox-history-actions'));
		this._icon(actions, checkpoint.pinned ? 'pin-off' : 'pin', checkpoint.pinned ? localize('knox.unpinCheckpoint', "Unpin") : localize('knox.pinCheckpoint', "Pin"), () => void this._pin(checkpoint));
		this._icon(actions, 'rotate-ccw', localize('knox.restore', "Restore"), () => this._openRestore(checkpoint.id, false));
		this._icon(actions, 'copy', localize('knox.copyId', "Copy id"), () => void this._clipboardService.writeText(checkpoint.id));
		this._icon(actions, 'trash-2', localize('knox.delete', "Delete"), () => void this._deleteIds([checkpoint.id]));

		this._itemStore.add(addDisposableListener(row, 'click', e => {
			if (this._selectionMode) {
				this._select(checkpoint.id, !selected, e.shiftKey);
				return;
			}
			this._focusedId = checkpoint.id;
			this._openRestore(checkpoint.id, e.shiftKey);
		}));
	}

	private _renderModal(): void {
		this._modalStore.clear();
		clearNode(this._modal);
		if (this._restoreId) {
			this._modal.classList.remove('hidden');
			void this._renderRestoreModal(this._restoreId);
			return;
		}
		if (this._compare) {
			this._modal.classList.remove('hidden');
			void this._renderCompareModal(this._compare.leftId, this._compare.rightId);
			return;
		}
		this._modal.classList.add('hidden');
	}

	private async _renderRestoreModal(checkpointId: string): Promise<void> {
		const card = append(this._modal, $('.knox-modal-card'));
		append(card, $('h3')).textContent = localize('knox.restorePreview', "Restore preview");
		const checkpoint = this._checkpoints.find(item => item.id === checkpointId);
		if (checkpoint) {
			append(card, $('p.knox-muted')).textContent = checkpoint.description;
		}
		if (this._restoreRewind) {
			append(card, $('p.knox-muted')).textContent = localize('knox.restoreCheckpointMemory', "Workspace files and Memory Brain will rewind to this checkpoint.");
		}
		const body = append(card, $('.knox-modal-body'));
		body.textContent = localize('knox.loading', "Loading…");
		try {
			const result = await this._bridge.request('previewRestore', { checkpointId });
			const preview = parseKnoxRestorePreview(result);
			clearNode(body);
			if (!preview) {
				body.textContent = localize('knox.restorePreviewFailed', "Could not load restore preview.");
			} else {
				this._fillRestorePreview(body, preview);
			}
		} catch (error) {
			clearNode(body);
			body.textContent = error instanceof Error ? error.message : String(error);
		}
		const footer = append(card, $('.knox-modal-footer'));
		this._modalButton(footer, localize('knox.cancel', "Cancel"), () => {
			this._restoreId = undefined;
			this._render();
		});
	}

	private _fillRestorePreview(parent: HTMLElement, preview: IKnoxRestorePreview): void {
		const selected = new Set(preview.writePaths);
		append(parent, $('p.knox-muted')).textContent = localize(
			'knox.restorePreviewSummary',
			"{0} modified, {1} added, {2} deleted",
			preview.modified,
			preview.added,
			preview.deleted,
		);
		const all = append(parent, $<HTMLInputElement>('input'));
		all.type = 'checkbox';
		all.checked = selected.size === preview.files.length && preview.files.length > 0;
		const allLabel = append(parent, $('label'));
		allLabel.textContent = localize('knox.selectAll', "Select all");
		this._modalStore.add(addDisposableListener(all, 'change', () => {
			selected.clear();
			if (all.checked) {
				for (const file of preview.files) {
					selected.add(file.relativePath);
				}
			}
		}));

		const list = append(parent, $('.knox-modal-files'));
		for (const file of preview.files) {
			const row = append(list, $('label.knox-modal-file'));
			const box = append(row, $<HTMLInputElement>('input'));
			box.type = 'checkbox';
			box.checked = selected.has(file.relativePath);
			append(row, $('span')).textContent = `${file.relativePath} (${file.action})`;
			this._modalStore.add(addDisposableListener(box, 'change', () => {
				if (box.checked) {
					selected.add(file.relativePath);
				} else {
					selected.delete(file.relativePath);
				}
			}));
		}

		const footer = append(parent, $('.knox-modal-footer'));
		this._modalButton(footer, localize('knox.showDiff', "Show diff"), () => void this._showRestoreDiff(preview.checkpointId));
		this._modalButton(footer, localize('knox.restoreSelected', "Restore selected"), () => void this._restoreSelected(preview.checkpointId, [...selected]), false);
		this._modalButton(footer, localize('knox.restoreAll', "Restore all"), () => void this._restoreAll(preview.checkpointId), true);
	}

	private async _renderCompareModal(leftId: string, rightId: string): Promise<void> {
		const card = append(this._modal, $('.knox-modal-card'));
		append(card, $('h3')).textContent = localize('knox.compareCheckpoints', "Compare checkpoints");
		const body = append(card, $('.knox-modal-body'));
		body.textContent = localize('knox.loading', "Loading…");
		try {
			const result = await this._bridge.request('computeCheckpointDiff', {
				checkpointId: rightId,
				compareToCheckpointId: leftId,
			});
			const diff = parseKnoxCheckpointDiff(result);
			clearNode(body);
			if (!diff?.oldCheckpoint) {
				body.textContent = localize('knox.failedToCompareCheckpoints', "Could not compare checkpoints.");
			} else {
				this._fillCompare(body, diff);
			}
		} catch (error) {
			clearNode(body);
			body.textContent = error instanceof Error ? error.message : String(error);
		}
		const footer = append(card, $('.knox-modal-footer'));
		this._modalButton(footer, localize('knox.close', "Close"), () => {
			this._compare = undefined;
			this._render();
		});
	}

	private _fillCompare(parent: HTMLElement, diff: IKnoxCheckpointDiff): void {
		append(parent, $('p.knox-muted')).textContent = `${diff.oldCheckpoint?.description ?? ''} → ${diff.newCheckpoint.description}`;
		if (!diff.files.length) {
			append(parent, $('p')).textContent = localize('knox.noDiffFiles', "No file differences.");
			return;
		}
		const list = append(parent, $('.knox-modal-files'));
		for (const file of diff.files) {
			const button = append(list, $<HTMLButtonElement>('button.knox-modal-file'));
			button.type = 'button';
			button.textContent = file.relativePath;
			this._modalStore.add(addDisposableListener(button, 'click', () => {
				void knoxOpenCheckpointFileDiff(
					this._editorService,
					file,
					diff.oldCheckpoint?.description ?? '',
					diff.newCheckpoint.description,
				);
			}));
		}
	}

	private async _showRestoreDiff(checkpointId: string): Promise<void> {
		const result = await this._bridge.request('computeCheckpointDiff', {
			checkpointId,
			compareToWorkspace: true,
		});
		const diff = parseKnoxCheckpointDiff(result);
		if (!diff) {
			this._notificationService.error(localize('knox.failedToCompareCheckpoints', "Could not compare checkpoints."));
			return;
		}
		this._fillCompare(this._modal.querySelector('.knox-modal-body') ?? this._modal, diff);
	}

	private async _restoreAll(checkpointId: string): Promise<void> {
		await this._bridge.request('restoreCheckpoint', { checkpointId, rewindMemory: this._restoreRewind });
		this._restoreId = undefined;
		this._render();
	}

	private async _restoreSelected(checkpointId: string, relativePaths: string[]): Promise<void> {
		if (!relativePaths.length) {
			return;
		}
		await this._bridge.request('restoreCheckpointFiles', { checkpointId, relativePaths });
		this._restoreId = undefined;
		this._render();
	}

	private _openRestore(checkpointId: string, rewindMemory: boolean): void {
		this._restoreId = checkpointId;
		this._restoreRewind = rewindMemory;
		this._compare = undefined;
		this._render();
	}

	private _openCompareForSelection(): void {
		const selected = [...this._selected];
		if (selected.length !== 2) {
			return;
		}
		const left = this._compareCatalog.find(item => item.id === selected[0]) ?? this._checkpoints.find(item => item.id === selected[0]);
		const right = this._compareCatalog.find(item => item.id === selected[1]) ?? this._checkpoints.find(item => item.id === selected[1]);
		if (left && right) {
			const [older, newer] = chronologicalCheckpointPair(left, right);
			this._compare = { leftId: older.id, rightId: newer.id };
		} else {
			this._compare = { leftId: selected[0], rightId: selected[1] };
		}
		this._restoreId = undefined;
		this._render();
	}

	openCompare(leftId: string, rightId: string): void {
		this._compare = { leftId, rightId };
		this._restoreId = undefined;
		this._render();
	}

	openRestore(checkpointId: string, rewindMemory = false): void {
		this._openRestore(checkpointId, rewindMemory);
	}

	private _select(checkpointId: string, selected: boolean, shiftKey: boolean): void {
		this._focusedId = checkpointId;
		const orderedIds = this._filtered().map(item => item.id);
		if (shiftKey && this._selectionAnchorId) {
			this._selectionMode = true;
			this._selected = new Set(selectCheckpointIdRange(orderedIds, this._selectionAnchorId, checkpointId));
			this._render();
			return;
		}
		this._selectionAnchorId = checkpointId;
		const next = new Set(this._selected);
		if (selected) {
			next.add(checkpointId);
		} else {
			next.delete(checkpointId);
		}
		this._selected = next;
		this._render();
	}

	private async _pin(checkpoint: IKnoxCheckpointMetadata): Promise<void> {
		const pinned = !checkpoint.pinned;
		const result = await this._bridge.request('pinCheckpoint', { checkpointId: checkpoint.id, pinned });
		if (knoxProtocolSuccess(result)) {
			checkpoint.pinned = pinned;
			this._render();
		}
	}

	private async _deleteIds(ids: string[]): Promise<void> {
		if (!ids.length) {
			return;
		}
		await this._bridge.request('deleteCheckpoints', { checkpointIds: ids });
		this._selected = new Set();
		this._selectionMode = false;
		await this.refresh();
	}

	private async _confirmDeleteSelected(): Promise<void> {
		const ids = [...this._selected];
		if (!ids.length && this._focusedId) {
			ids.push(this._focusedId);
		}
		if (!ids.length) {
			return;
		}
		const confirmed = await this._dialogService.confirm({
			type: 'warning',
			message: localize('knox.deleteCheckpoints', "Delete checkpoints"),
			detail: localize('knox.deleteConfirmation', "Delete {0} checkpoint(s)? This cannot be undone.", ids.length),
			primaryButton: localize('knox.delete', "Delete"),
		});
		if (confirmed.confirmed) {
			await this._deleteIds(ids);
		}
	}

	private async _switchWorkspace(workspacePath: string): Promise<void> {
		if (!workspacePath || workspacePath === this._activeWorkspacePath) {
			return;
		}
		const result = await this._bridge.request('setActiveCheckpointWorkspace', { workspacePath });
		if (knoxProtocolSuccess(result)) {
			this._activeWorkspacePath = workspacePath;
			await this.refresh();
		}
	}

	private _onKeyDown(event: KeyboardEvent): void {
		const target = event.target as HTMLElement | null;
		if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
			return;
		}
		const orderedIds = this._filtered().map(item => item.id);
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			this._moveFocus(event.key === 'ArrowDown' ? 1 : -1, event.shiftKey, orderedIds);
		} else if ((event.key === 'Delete' || event.key === 'Backspace') && (this._selected.size || this._focusedId)) {
			event.preventDefault();
			void this._confirmDeleteSelected();
		} else if (event.key === 'Enter' && this._focusedId) {
			event.preventDefault();
			this._openRestore(this._focusedId, event.shiftKey);
		} else if (event.key === 'Escape') {
			this._selectionMode = false;
			this._selected = new Set();
			this._focusedId = undefined;
			this._restoreId = undefined;
			this._compare = undefined;
			this._render();
		}
	}

	private _moveFocus(delta: number, shiftKey: boolean, orderedIds: string[]): void {
		if (!orderedIds.length) {
			return;
		}
		const currentIndex = this._focusedId ? orderedIds.indexOf(this._focusedId) : -1;
		const nextIndex = currentIndex < 0
			? (delta >= 0 ? 0 : orderedIds.length - 1)
			: Math.max(0, Math.min(orderedIds.length - 1, currentIndex + delta));
		const nextId = orderedIds[nextIndex];
		this._focusedId = nextId;
		if (shiftKey) {
			this._selectionMode = true;
			const anchor = this._selectionAnchorId ?? nextId;
			this._selectionAnchorId = anchor;
			this._selected = new Set(selectCheckpointIdRange(orderedIds, anchor, nextId));
		}
		this._render();
		const row = this.element.querySelector(`[data-checkpoint-id="${nextId}"]`);
		if (row instanceof HTMLElement) {
			row.scrollIntoView({ block: 'nearest' });
		}
	}

	private _maybeLoadMore(): void {
		if (!this._hasMore || this._loadingMore || this._loading) {
			return;
		}
		const el = this.element;
		if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
			void this._load({ append: true });
		}
	}

	private _toolButton(parent: HTMLElement, icon: KnoxGuiIconName, label: string, onClick: () => void): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button.knox-history-tool'));
		button.type = 'button';
		button.title = label;
		append(button, $('span')).className = knoxGuiIconClass(icon);
		append(button, $('span')).textContent = label;
		this._itemStore.add(addDisposableListener(button, 'click', onClick));
		return button;
	}

	private _icon(parent: HTMLElement, icon: KnoxGuiIconName, label: string, onClick: () => void): void {
		const button = append(parent, $<HTMLButtonElement>('button.knox-icon-button'));
		button.type = 'button';
		button.setAttribute('aria-label', label);
		append(button, $('span')).className = knoxGuiIconClass(icon);
		this._itemStore.add(this._hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), button, label));
		this._itemStore.add(addDisposableListener(button, 'click', e => {
			e.stopPropagation();
			onClick();
		}));
	}

	private _modalButton(parent: HTMLElement, label: string, onClick: () => void, primary = false): void {
		const button = append(parent, $<HTMLButtonElement>('button.knox-history-tool'));
		button.type = 'button';
		button.textContent = label;
		button.classList.toggle('primary', primary);
		this._modalStore.add(addDisposableListener(button, 'click', onClick));
	}
}

