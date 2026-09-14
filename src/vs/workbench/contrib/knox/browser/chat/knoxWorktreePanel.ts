/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';

/**
 * Agent worktree status + Apply / Discard (T5.8).
 */
export class KnoxWorktreePanel extends Disposable {

	readonly element: HTMLElement;

	private readonly _label: HTMLElement;
	private readonly _actions: HTMLElement;
	private readonly _apply: HTMLButtonElement;
	private readonly _discard: HTMLButtonElement;
	private readonly _detail: HTMLElement;
	private readonly _hoverStore = this._register(new DisposableStore());
	private _wasStreaming = false;

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@IHoverService private readonly _hoverService: IHoverService,
	) {
		super();
		this.element = append(parent, $('.knox-worktree-panel.hidden'));
		this.element.setAttribute('data-testid', 'agent-worktree-panel');

		const row = append(this.element, $('.knox-worktree-row'));
		this._label = append(row, $('span.knox-worktree-label'));
		this._actions = append(row, $('.knox-worktree-actions'));
		this._apply = append(this._actions, $<HTMLButtonElement>('button.knox-worktree-apply'));
		this._apply.type = 'button';
		this._apply.textContent = localize('knox.worktreeApply', "Apply");
		this._discard = append(this._actions, $<HTMLButtonElement>('button.knox-worktree-discard'));
		this._discard.type = 'button';
		this._discard.textContent = localize('knox.worktreeDiscard', "Discard");
		this._detail = append(this.element, $('code.knox-worktree-detail'));

		this._register(addDisposableListener(this._apply, 'click', () => void this._chatService.runAgentWorktree('apply')));
		this._register(addDisposableListener(this._discard, 'click', () => void this._chatService.runAgentWorktree('discard')));
		this._register(this._chatService.onDidChange(() => this._onSessionChange()));
		this._wasStreaming = this._chatService.isStreaming;
		this._render();
	}

	private _onSessionChange(): void {
		const streaming = this._chatService.isStreaming;
		const worktree = this._chatService.worktree;
		if (worktree.enabled && this._wasStreaming && !streaming) {
			void this._chatService.runAgentWorktree('status');
		}
		this._wasStreaming = streaming;
		this._render();
	}

	private _render(): void {
		this._hoverStore.clear();
		const mode = this._chatService.mode;
		const worktree = this._chatService.worktree;
		const visible = mode === 'agent' && (worktree.enabled || !!worktree.error);
		this.element.classList.toggle('hidden', !visible);
		if (!visible) {
			this._onDidChangeHeight.fire();
			return;
		}

		const fileCount = worktree.files.length;
		const branch = worktree.branch ?? 'knox/agent';
		this._label.textContent = worktree.enabled
			? (fileCount === 1
				? localize('knox.worktreeActiveOne', "{0} · {1} changed file", branch, fileCount)
				: localize('knox.worktreeActiveMany', "{0} · {1} changed files", branch, fileCount))
			: localize('knox.worktreeChip', "Worktree");

		this._actions.classList.toggle('hidden', !worktree.enabled);
		this._apply.disabled = worktree.busy || fileCount === 0;
		this._discard.disabled = worktree.busy;
		const applyHint = localize('knox.worktreeApplyHint', "Copy worktree changes onto the current workspace");
		const discardHint = localize('knox.worktreeDiscardHint', "Remove the isolated worktree without applying");
		this._apply.setAttribute('aria-label', applyHint);
		this._discard.setAttribute('aria-label', discardHint);
		this._hoverStore.add(this._hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), this._apply, applyHint));
		this._hoverStore.add(this._hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), this._discard, discardHint));

		clearNode(this._detail);
		if (worktree.error) {
			this._detail.textContent = worktree.error;
			this._detail.classList.add('error');
			this._detail.classList.remove('hidden');
			this._detail.removeAttribute('title');
		} else if (worktree.path) {
			this._detail.textContent = worktree.path;
			this._detail.title = worktree.path;
			this._detail.classList.remove('error');
			this._detail.classList.remove('hidden');
		} else {
			this._detail.classList.add('hidden');
		}
		this._onDidChangeHeight.fire();
	}
}
