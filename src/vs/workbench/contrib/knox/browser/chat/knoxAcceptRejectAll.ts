/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../../base/common/platform.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass } from '../knoxGuiIcons.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';

function metaKeyLabel(): string {
	return isMacintosh ? '⌘' : 'Ctrl';
}

/**
 * Accept / reject all pending applies (T5.14).
 */
export class KnoxAcceptRejectAll extends Disposable {

	readonly element: HTMLElement;

	private readonly _reject: HTMLButtonElement;
	private readonly _accept: HTMLButtonElement;
	private readonly _rejectLabel: HTMLElement;
	private readonly _acceptLabel: HTMLElement;

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
	) {
		super();
		this.element = append(parent, $('.knox-accept-reject.hidden'));

		this._reject = append(this.element, $<HTMLButtonElement>('button.knox-accept-reject-btn reject'));
		this._reject.type = 'button';
		this._reject.setAttribute('data-testid', 'edit-reject-button');
		const rejectIcon = append(this._reject, $('span'));
		rejectIcon.className = knoxGuiIconClass('x-mark');
		this._rejectLabel = append(this._reject, $('span'));

		this._accept = append(this.element, $<HTMLButtonElement>('button.knox-accept-reject-btn accept'));
		this._accept.type = 'button';
		this._accept.setAttribute('data-testid', 'edit-accept-button');
		const acceptIcon = append(this._accept, $('span'));
		acceptIcon.className = knoxGuiIconClass('check');
		this._acceptLabel = append(this._accept, $('span'));

		this._register(addDisposableListener(this._reject, 'click', () => void this._chatService.acceptOrRejectAllPending('rejectDiff')));
		this._register(addDisposableListener(this._accept, 'click', () => void this._chatService.acceptOrRejectAllPending('acceptDiff')));
		this._register(this._chatService.onDidChange(() => this._render()));
		this._render();
	}

	private _render(): void {
		const pending = this._chatService.pendingApplyStates;
		const visible = pending.length > 0 && !this._chatService.isStreaming;
		this.element.classList.toggle('hidden', !visible);
		if (!visible) {
			this._onDidChangeHeight.fire();
			return;
		}
		const single = this._chatService.isSingleRangeEditOrInsertion;
		const meta = metaKeyLabel();
		this._rejectLabel.textContent = single
			? localize('knox.rejectShortcut', "Reject ({0}⇧⌫)", meta)
			: localize('knox.rejectAllChanges', "Reject All Changes");
		this._acceptLabel.textContent = single
			? localize('knox.acceptShortcut', "Accept ({0}⇧⏎)", meta)
			: localize('knox.acceptAllChanges', "Accept All Changes");
		this._onDidChangeHeight.fire();
	}
}
