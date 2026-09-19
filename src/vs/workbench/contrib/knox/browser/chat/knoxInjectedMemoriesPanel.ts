/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass, KnoxGuiIconName } from '../knoxGuiIcons.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { IKnoxInjectedMemoryItem } from '../../common/knoxChatTypes.js';
import { IKnoxGuiBridge } from '../../common/knoxGuiProtocol.js';
import {
	knoxInjectedMemoryIsActionable,
	knoxInjectedMemoryIsTimeout,
	knoxParseMemoryMode,
	knoxPartitionInjectedMemories,
} from '../../common/knoxInjectedMemories.js';
import { KnoxAttachedPanel } from './knoxAttachedPanel.js';

function unwrapContent(result: unknown): unknown {
	if (result && typeof result === 'object') {
		const record = result as { status?: string; content?: unknown };
		if (record.status === 'success') {
			return record.content;
		}
		if ('content' in record) {
			return record.content;
		}
	}
	return result;
}

/**
 * Provenance UI for memories injected into the latest turn (T5.12).
 */
export class KnoxInjectedMemoriesPanel extends Disposable {

	private readonly _panel: KnoxAttachedPanel;
	private readonly _dismiss: HTMLButtonElement;
	private readonly _restoreBanner: HTMLElement;
	private readonly _contentStore = this._register(new DisposableStore());
	private readonly _hoverStore = this._register(new DisposableStore());
	private _memoryMode = 'summarized';
	private _showLowScoring = false;
	private _busyId: number | null = null;
	private _lastCount = 0;

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
		@IHoverService private readonly _hoverService: IHoverService,
	) {
		super();
		this._panel = this._register(new KnoxAttachedPanel(parent, 'injected-memories-panel'));
		this._panel.setIcon('lucide-brain');
		this._restoreBanner = append(this._panel.body, $('.knox-restore-notice.hidden'));
		this._restoreBanner.setAttribute('role', 'status');
		this._dismiss = append(this._panel.extra, $<HTMLButtonElement>('button.knox-attached-dismiss'));
		this._dismiss.type = 'button';
		this._dismiss.setAttribute('aria-label', localize('knox.memoryInjectDismiss', "Dismiss"));
		const glyph = append(this._dismiss, $('span'));
		glyph.className = knoxGuiIconClass('x');
		this._register(addDisposableListener(this._dismiss, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			this._chatService.setLastInjectedMemories([]);
		}));
		this._register(this._panel.onDidChangeHeight(() => this._onDidChangeHeight.fire()));
		this._register(this._chatService.onDidChange(() => {
			if (this._chatService.injectedMemories.length !== this._lastCount) {
				void this._loadMemoryMode();
			}
			this._render();
		}));
		this._render();
	}

	private _clearBody(): void {
		for (const child of Array.from(this._panel.body.children)) {
			if (child !== this._restoreBanner) {
				child.remove();
			}
		}
	}

	/** Render the pending workspace-restore notice (T2.1). */
	private _renderRestoreNotice(): void {
		const notice = this._chatService.restoreNotice;
		if (!notice) {
			this._restoreBanner.classList.add('hidden');
			this._restoreBanner.textContent = '';
			return;
		}
		this._restoreBanner.classList.remove('hidden');
		this._restoreBanner.textContent = localize(
			'knox.workspaceRestoreNotice',
			"Workspace restored — the model will be reminded to re-read files before editing.",
		);
	}

	private async _loadMemoryMode(): Promise<void> {
		try {
			const content = unwrapContent(await this._bridge.request('brain/getConfig', undefined));
			this._memoryMode = knoxParseMemoryMode(content);
			this._render();
		} catch {
			// Config is best-effort.
		}
	}

	private _render(): void {
		this._contentStore.clear();
		this._hoverStore.clear();
		const items = this._chatService.injectedMemories;
		const restoreNotice = this._chatService.restoreNotice;
		this._lastCount = items.length;
		if (!items.length && !restoreNotice) {
			this._panel.setVisible(false);
			return;
		}
		this._panel.setVisible(true);
		this._renderRestoreNotice();
		if (!items.length) {
			// Restore banner only; nothing else to list.
			this._panel.title.textContent = localize('knox.workspaceRestoredTitle', "Workspace restored");
			this._clearBody();
			return;
		}
		this._panel.setVisible(true);
		const timeout = knoxInjectedMemoryIsTimeout(items);
		this._panel.title.textContent = timeout
			? localize('knox.memoryInjectUnavailable', "Memory context unavailable")
			: localize('knox.memoryInjectedTitle', "Memories used ({0})", items.length);

		const { visible, collapsed } = knoxPartitionInjectedMemories(items, this._memoryMode);
		const rendered = this._showLowScoring ? [...visible, ...collapsed] : visible;

		this._clearBody();
		for (const item of rendered) {
			this._renderItem(item);
		}
		if (collapsed.length > 0) {
			const more = append(this._panel.body, $<HTMLButtonElement>('button.knox-memory-more'));
			more.type = 'button';
			more.textContent = this._showLowScoring
				? localize('knox.memoryHideLowerScoring', "Hide lower-scoring items")
				: localize('knox.memoryShowLowerScoring', "Show {0} lower-scoring items", collapsed.length);
			this._contentStore.add(addDisposableListener(more, 'click', () => {
				this._showLowScoring = !this._showLowScoring;
				this._render();
			}));
		}
		const actionable = items.filter(knoxInjectedMemoryIsActionable);
		if (actionable.length === 0 && !timeout) {
			append(this._panel.body, $('div.knox-attached-empty')).textContent = localize(
				'knox.memoryInjectNoActions',
				"No pin/forget/demote actions for these items",
			);
		}
	}

	private _renderItem(item: IKnoxInjectedMemoryItem): void {
		const row = append(this._panel.body, $('.knox-memory-item'));
		const body = append(row, $('.knox-memory-item-body'));
		const title = append(body, $('.knox-memory-item-title'));
		if (item.kind === 'goal') {
			const icon = append(title, $('span.knox-memory-kind'));
			icon.className = `knox-memory-kind ${knoxGuiIconClass('target')}`;
		} else if (item.pinned) {
			const icon = append(title, $('span.knox-memory-kind'));
			icon.className = `knox-memory-kind ${knoxGuiIconClass('pin')}`;
		}
		append(title, $('span.knox-memory-name')).textContent = item.kind === 'timeout'
			? localize('knox.memoryInjectUnavailable', "Memory context unavailable")
			: item.title;
		if (item.category) {
			append(title, $('span.knox-memory-tag')).textContent = `[${item.category}]`;
		} else if (item.kind === 'goal') {
			append(title, $('span.knox-memory-tag')).textContent = '[C_goal]';
		}
		if (typeof item.score === 'number' && Number.isFinite(item.score)) {
			append(title, $('span.knox-memory-score')).textContent = item.score.toFixed(2);
		}
		append(body, $('div.knox-attached-muted')).textContent = item.kind === 'timeout'
			? localize('knox.memoryContextTimeoutReason', "Context build timed out — chat continued without memory")
			: item.reason;
		if (item.kind !== 'timeout' && item.evidence?.length) {
			const chips = append(body, $('.knox-memory-evidence'));
			for (const token of item.evidence) {
				append(chips, $('span.knox-memory-chip')).textContent = token;
			}
		}
		if (item.id != null && knoxInjectedMemoryIsActionable(item)) {
			const id = item.id;
			const actions = append(row, $('.knox-memory-actions'));
			this._actionButton(
				actions,
				item.pinned ? 'pin-off' : 'pin',
				item.pinned ? localize('knox.memoryUnpin', "Unpin") : localize('knox.memoryPin', "Pin"),
				this._busyId === id,
				() => void this._run(id, () => this._chatService.pinInjectedMemory(id, !!item.pinned)),
			);
			this._actionButton(
				actions,
				'thumbs-down',
				localize('knox.memoryNotRelevant', "Not relevant"),
				this._busyId === id,
				() => void this._run(id, () => this._chatService.mismatchInjectedMemory(id)),
			);
			this._actionButton(
				actions,
				'trash-2',
				localize('knox.memoryForget', "Forget"),
				this._busyId === id,
				() => void this._run(id, () => this._chatService.forgetInjectedMemory(id)),
			);
		}
	}

	private _actionButton(
		parent: HTMLElement,
		icon: KnoxGuiIconName,
		title: string,
		disabled: boolean,
		run: () => void,
	): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button.knox-memory-action'));
		button.type = 'button';
		button.setAttribute('aria-label', title);
		button.disabled = disabled;
		const glyph = append(button, $('span'));
		glyph.className = knoxGuiIconClass(icon);
		this._hoverStore.add(this._hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), button, title));
		this._contentStore.add(addDisposableListener(button, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			run();
		}));
		return button;
	}

	private async _run(id: number, action: () => Promise<void>): Promise<void> {
		this._busyId = id;
		this._render();
		try {
			await action();
		} finally {
			this._busyId = null;
			this._render();
		}
	}
}
