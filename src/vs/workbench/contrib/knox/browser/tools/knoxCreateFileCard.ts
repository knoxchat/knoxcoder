/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IKnoxToolCallState } from '../../common/knoxChatTypes.js';
import { knoxCreateFileMarkdown, knoxToolIsStreaming } from '../../common/knoxToolCard.js';
import { knoxAsArgsRecord, knoxExtractStreamingToolCode } from '../../common/knoxStreamingToolCode.js';
import { renderKnoxClickableFilePath } from '../markdown/knoxClickablePath.js';
import { IKnoxMarkdownServices, renderKnoxAssistantMarkdown } from '../markdown/knoxMarkdownRenderer.js';

export function renderKnoxCreateFileCard(
	parent: HTMLElement,
	state: IKnoxToolCallState,
	historyIndex: number,
	services: IKnoxMarkdownServices,
	expanded: Map<string, boolean>,
	store: DisposableStore,
	onDidChangeHeight: () => void,
): void {
	const args = knoxAsArgsRecord(state.parsedArgs);
	const extracted = knoxExtractStreamingToolCode({
		parsedArgs: state.parsedArgs,
		rawArguments: state.toolCall.function.arguments,
	});
	const filepath = (typeof args?.filepath === 'string' && args.filepath) || extracted.filepath;
	const contents = (typeof args?.contents === 'string' ? args.contents : undefined) ?? extracted.codeContent;
	if (!filepath && !contents && !extracted.started) {
		return;
	}

	const root = append(parent, $('.knox-create-file'));
	if (filepath) {
		const row = append(root, $('.knox-create-file-path'));
		append(row, $('span.knox-create-file-label')).textContent = localize('knox.createdFile', "Created File:");
		renderKnoxClickableFilePath(row, filepath, {}, services.bridge, services.workspace, store);
	}

	const markdown = knoxCreateFileMarkdown(filepath, contents);
	const host = append(root, $('div.knox-create-file-preview'));
	renderKnoxAssistantMarkdown(host, {
		source: markdown.source,
		isStreaming: knoxToolIsStreaming(state.status),
		inStepContainer: true,
		historyIndex,
		history: services.chat.history,
		expanded,
		onDidChangeHeight,
	}, services, store);
}
