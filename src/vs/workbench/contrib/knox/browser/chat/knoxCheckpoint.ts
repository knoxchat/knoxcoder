/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass } from '../knoxGuiIcons.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IKnoxChatHistoryItem } from '../../common/knoxChatTypes.js';
import { IKnoxGuiBridge } from '../../common/knoxGuiProtocol.js';

function checkpointIdFromResult(result: unknown): string | undefined {
	if (!result || typeof result !== 'object') {
		return undefined;
	}
	const record = result as {
		checkpointId?: string | null;
		content?: { checkpointId?: string | null };
	};
	const nested = record.content && typeof record.content === 'object' ? record.content.checkpointId : undefined;
	const id = record.checkpointId ?? nested;
	return id || undefined;
}

async function lookupCheckpoint(
	bridge: IKnoxGuiBridge,
	item: IKnoxChatHistoryItem,
	index: number,
	createIfMissing: boolean,
): Promise<string | undefined> {
	const messageId = item.message.id ?? item.messageId;
	if (!messageId) {
		return undefined;
	}

	const existing = checkpointIdFromResult(await bridge.request('getCheckpointForMessage', { messageId }));
	if (existing) {
		return existing;
	}
	if (!createIfMissing || item.message.role !== 'assistant') {
		return undefined;
	}

	const stableId = `${item.message.role}-${index}-${messageId}`;
	const byStable = checkpointIdFromResult(await bridge.request('getCheckpointForStableId', { stableId }));
	if (byStable) {
		return byStable;
	}

	const messageContent = typeof item.message.content === 'string'
		? item.message.content
		: JSON.stringify(item.message.content);
	return checkpointIdFromResult(await bridge.request('createCheckpointForMessage', {
		messageId,
		description: `Assistant response at index ${index}`,
		stableId,
		conversationContext: {
			messageContent: messageContent.substring(0, 500),
			role: item.message.role,
			timestamp: new Date().toISOString(),
			index,
		},
	}));
}

export function renderKnoxCheckpointButton(
	parent: HTMLElement,
	item: IKnoxChatHistoryItem,
	index: number,
	options: { createIfMissing: boolean },
	bridge: IKnoxGuiBridge,
	dialogService: IDialogService,
	notificationService: INotificationService,
	hoverService: IHoverService,
	store: DisposableStore,
): HTMLButtonElement {
	const button = append(parent, $<HTMLButtonElement>('button.knox-icon-button.hidden'));
	button.type = 'button';
	button.tabIndex = -1;
	const icon = append(button, $('span'));
	icon.className = knoxGuiIconClass('restore');

	void lookupCheckpoint(bridge, item, index, options.createIfMissing).then(checkpointId => {
		if (!checkpointId || store.isDisposed) {
			return;
		}
		button.classList.remove('hidden');
		const shortened = checkpointId.slice(0, 8);
		const tooltip = localize('knox.restoreCheckpointHint', "Restore checkpoint {0} (Shift: files and memory)", shortened);
		button.setAttribute('aria-label', tooltip);
		store.add(hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), button, tooltip));
		store.add(addDisposableListener(button, 'click', async e => {
			e.preventDefault();
			e.stopPropagation();
			const rewindMemory = e.shiftKey;
			const confirmed = await dialogService.confirm({
				message: localize('knox.restoreCheckpoint', "Restore checkpoint {0}?", shortened),
				detail: rewindMemory
					? localize('knox.restoreCheckpointMemory', "Workspace files and Memory Brain will rewind to this checkpoint.")
					: localize('knox.restoreCheckpointFiles', "Workspace files will restore to this checkpoint. Open Checkpoints for a dry-run preview."),
				primaryButton: localize('knox.restore', "Restore"),
			});
			if (!confirmed.confirmed) {
				return;
			}
			try {
				const result = await bridge.request('restoreCheckpoint', { checkpointId, rewindMemory });
				const record = result && typeof result === 'object'
					? result as { success?: boolean; content?: { success?: boolean }; message?: string }
					: {};
				const success = record.success ?? record.content?.success;
				if (success === false) {
					notificationService.error(record.message ?? localize('knox.restoreFailed', "Could not restore the checkpoint."));
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				notificationService.error(localize('knox.restoreFailedDetail', "Could not restore the checkpoint: {0}", message));
			}
		}));
	}).catch(() => { /* lookup is best-effort */ });

	return button;
}
