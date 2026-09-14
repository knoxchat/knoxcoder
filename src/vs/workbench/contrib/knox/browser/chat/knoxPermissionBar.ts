/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { findCurrentToolCall } from '../../common/knoxChatHistory.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { knoxFindTool } from '../../common/knoxToolCard.js';
import { knoxCategorizedToolName } from '../../common/knoxToolPermissions.js';
import { knoxPendingPermissionTarget, renderKnoxPermissionActionButtons } from '../tools/knoxPermissionButtons.js';

/**
 * Deny / Always this session / Approve once above the native input (T6.14).
 */
export class KnoxPermissionBar extends Disposable {

	readonly element: HTMLElement;

	private readonly _itemStore = this._register(new DisposableStore());
	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@IHoverService private readonly _hoverService: IHoverService,
	) {
		super();
		this.element = append(parent, $('.knox-permission-bar.hidden'));
		this._register(this._chatService.onDidChange(() => this._render()));
		this._render();
	}

	private _render(): void {
		const pending = findCurrentToolCall(this._chatService.history);
		const target = knoxPendingPermissionTarget(this._chatService);
		const visible = !!target && pending?.status === 'generated';
		this.element.classList.toggle('hidden', !visible);
		this._itemStore.clear();
		clearNode(this.element);
		if (!visible || !target || !pending) {
			this._onDidChangeHeight.fire();
			return;
		}

		const tool = knoxFindTool(this._chatService.config?.tools, pending.toolCall.function.name);
		const label = tool
			? knoxCategorizedToolName(tool)
			: knoxCategorizedToolName(pending.toolCall.function.name);
		append(this.element, $('div.knox-permission-label')).textContent = localize(
			'knox.permissionForTool',
			"Permission for {0}",
			label,
		);
		renderKnoxPermissionActionButtons(
			this.element,
			{ toolCallId: target.toolCallId, toolName: target.toolName },
			this._chatService,
			this._itemStore,
			this._hoverService,
		);
		this._onDidChangeHeight.fire();
	}
}
