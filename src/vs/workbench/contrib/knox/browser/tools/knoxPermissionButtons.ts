/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { knoxNls } from '../../common/knoxI18n.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { findCurrentToolCall } from '../../common/knoxChatHistory.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import {
	knoxGetToolPermissionDisplay,
	knoxResolvePermissionToolName,
	knoxShouldShowPermissionButtons,
} from '../../common/knoxToolPermissions.js';

export interface IKnoxPermissionButtonsOptions {
	toolCallId: string;
	toolName: string;
	compact?: boolean;
}

export function knoxPendingPermissionTarget(
	chat: IKnoxChatService,
	toolName?: string,
): { toolCallId: string; toolName: string } | undefined {
	const pending = findCurrentToolCall(chat.history);
	const name = knoxResolvePermissionToolName(toolName) || knoxResolvePermissionToolName(pending?.toolCall.function.name);
	if (!knoxShouldShowPermissionButtons({
		pending,
		targetName: toolName,
		toolSettings: chat.toolSettings,
		permissionMode: chat.permissionMode,
		sessionAllowlist: chat.sessionToolAllowlist,
	}) || !pending) {
		return undefined;
	}
	return { toolCallId: pending.toolCallId, toolName: name };
}

export function renderKnoxPermissionActionButtons(
	parent: HTMLElement,
	options: IKnoxPermissionButtonsOptions,
	chat: IKnoxChatService,
	store: DisposableStore,
	hover?: IHoverService,
): void {
	const display = knoxGetToolPermissionDisplay({
		toolName: options.toolName,
		toolSettings: chat.toolSettings,
		sessionAllowlist: chat.sessionToolAllowlist,
	});
	const alwaysActive = display === 'sessionAlways' || display === 'autoApprove';
	const compact = options.compact === true;

	const root = append(parent, $('.knox-permission-buttons'));
	root.classList.toggle('compact', compact);
	root.setAttribute('data-testid', 'permission-action-buttons');
	root.setAttribute('data-tool-name', options.toolName);

	const deny = append(root, $<HTMLButtonElement>('button.knox-permission-btn'));
	deny.type = 'button';
	deny.textContent = knoxNls('deny');
	store.add(addDisposableListener(deny, 'click', () => void chat.cancelTool({ toolCallId: options.toolCallId })));

	const always = append(root, $<HTMLButtonElement>('button.knox-permission-btn'));
	always.type = 'button';
	always.classList.toggle('always-active', alwaysActive);
	always.textContent = knoxNls('alwaysThisSession');
	const hint = knoxNls('alwaysThisSessionHint');
	always.setAttribute('aria-label', hint);
	always.setAttribute('aria-pressed', String(alwaysActive));
	if (hover) {
		store.add(hover.setupManagedHover(getDefaultHoverDelegate('mouse'), always, hint));
	} else {
		always.title = hint;
	}
	store.add(addDisposableListener(always, 'click', () => {
		chat.addSessionToolAllowlist(options.toolName);
		chat.approveTool(options.toolCallId, true);
	}));

	const approve = append(root, $<HTMLButtonElement>('button.knox-permission-btn.primary'));
	approve.type = 'button';
	approve.setAttribute('data-testid', 'accept-tool-call-button');
	approve.textContent = knoxNls('approveOnce');
	store.add(addDisposableListener(approve, 'click', () => chat.approveTool(options.toolCallId)));
}
