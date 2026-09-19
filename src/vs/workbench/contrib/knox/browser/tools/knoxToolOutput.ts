/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass } from '../knoxGuiIcons.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IKnoxChatHistoryItem, IKnoxContextItem } from '../../common/knoxChatTypes.js';
import { IKnoxGuiBridge } from '../../common/knoxGuiProtocol.js';
import {
	knoxContextItemBasename,
	knoxContextItemRange,
	knoxVisibleToolOutputItems,
} from '../../common/knoxToolOutput.js';
import { knoxShowFile } from '../markdown/knoxClickablePath.js';
import { IKnoxToolUiState } from './knoxToolCard.js';

export function renderKnoxToolOutput(
	parent: HTMLElement,
	item: IKnoxChatHistoryItem,
	ui: IKnoxToolUiState,
	bridge: IKnoxGuiBridge,
	workspace: IWorkspaceContextService,
	store: DisposableStore,
	onDidChangeHeight: () => void,
	options?: { gathering?: boolean; peekKey?: string },
): void {
	const items = knoxVisibleToolOutputItems(item.contextItems);
	const gathering = options?.gathering === true;
	if (!items.length && !gathering) {
		return;
	}
	const key = options?.peekKey ?? item.message.toolCallId ?? item.message.id ?? 'tool-output';
	const open = ui.peekExpanded.has(key);
	const root = append(parent, $('.knox-tool-output'));
	const toggle = append(root, $<HTMLButtonElement>('button.knox-tool-output-toggle'));
	toggle.type = 'button';
	toggle.setAttribute('data-testid', 'context-items-peek');
	toggle.setAttribute('aria-expanded', String(open));
	const chevron = append(toggle, $('span.knox-tool-output-chevron'));
	chevron.className = knoxGuiIconClass(open ? 'lucide-chevron-down' : 'lucide-chevron-right');
	append(toggle, $('span.knox-tool-output-label')).textContent = gathering && !items.length
		? localize('knox.gatheringContext', "Gathering context")
		: localize('knox.relatedContextItems', "{0} related context items", items.length);
	store.add(addDisposableListener(toggle, 'click', e => {
		e.preventDefault();
		e.stopPropagation();
		if (ui.peekExpanded.has(key)) {
			ui.peekExpanded.delete(key);
		} else {
			ui.peekExpanded.add(key);
		}
		onDidChangeHeight();
	}));

	if (!open) {
		return;
	}

	const list = append(root, $('.knox-tool-output-list'));
	for (const contextItem of items) {
		renderPeekItem(list, contextItem, bridge, workspace, store);
	}
}

function renderPeekItem(
	parent: HTMLElement,
	item: IKnoxContextItem,
	bridge: IKnoxGuiBridge,
	workspace: IWorkspaceContextService,
	store: DisposableStore,
): void {
	const isUrl = item.uri?.type === 'url';
	const row = append(parent, $<HTMLButtonElement>('button.knox-tool-output-item'));
	row.type = 'button';
	row.setAttribute('data-testid', 'context-items-peek-item');
	append(row, $('span.knox-tool-output-name')).textContent = item.name;
	const description = append(row, $('span.knox-tool-output-desc'));
	description.textContent = item.uri?.type === 'file'
		? knoxContextItemBasename(item.description)
		: item.description;
	if (isUrl) {
		const ext = append(row, $('span.knox-tool-output-ext'));
		ext.className = knoxGuiIconClass('arrow-up-right');
		ext.setAttribute('aria-hidden', 'true');
	}
	store.add(addDisposableListener(row, 'click', e => {
		e.preventDefault();
		e.stopPropagation();
		openContextItem(item, bridge, workspace);
	}));
}

function openContextItem(
	item: IKnoxContextItem,
	bridge: IKnoxGuiBridge,
	workspace: IWorkspaceContextService,
): void {
	if (item.uri?.type === 'url' && item.uri.value) {
		void bridge.post('openUrl', item.uri.value).catch(() => { });
		return;
	}
	if (item.uri?.value) {
		knoxShowFile(bridge, workspace, item.uri.value, knoxContextItemRange(item.name));
		return;
	}
	void bridge.post('showVirtualFile', { name: item.name, content: item.content }).catch(() => { });
}
