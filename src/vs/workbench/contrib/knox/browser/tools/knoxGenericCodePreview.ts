/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IKnoxToolCallState } from '../../common/knoxChatTypes.js';
import { knoxGenericCodePreview } from '../../common/knoxGenericCodePreview.js';
import { knoxToolIsStreaming } from '../../common/knoxToolCard.js';
import { IKnoxMarkdownServices, renderKnoxAssistantMarkdown } from '../markdown/knoxMarkdownRenderer.js';

export function renderKnoxGenericCodePreview(
	parent: HTMLElement,
	state: IKnoxToolCallState,
	historyIndex: number,
	services: IKnoxMarkdownServices,
	expanded: Map<string, boolean>,
	store: DisposableStore,
	onDidChangeHeight: () => void,
): void {
	const preview = knoxGenericCodePreview(state);
	if (!preview) {
		return;
	}
	if (preview.collapse && !expanded.has(`${historyIndex}:0`)) {
		expanded.set(`${historyIndex}:0`, false);
	}
	const host = append(parent, $('div.knox-generic-preview'));
	renderKnoxAssistantMarkdown(host, {
		source: preview.source,
		isStreaming: knoxToolIsStreaming(state.status),
		inStepContainer: true,
		historyIndex,
		history: services.chat.history,
		expanded,
		onDidChangeHeight,
		onDidToggleExpand: onDidChangeHeight,
	}, services, store);
}
