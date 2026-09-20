/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IMarkdownRendererService } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IKnoxChatHistoryItem } from '../../common/knoxChatTypes.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { IKnoxGuiBridge } from '../../common/knoxGuiProtocol.js';
import {
	isSymbolNotRif,
	knoxFileUrisNeedingSymbols,
	knoxMarkdownCodeWrap,
	knoxMarkdownDisplayRaw,
	knoxParseMarkdownBlocks,
	knoxRifsFromHistory,
	knoxSymbolsForContext,
	matchCodeToSymbolOrFile,
} from '../../common/knoxMarkdown.js';
import { renderKnoxCodeBlock } from './knoxCodeBlock.js';
import { renderKnoxFilenameLink, renderKnoxSymbolLink } from './knoxClickablePath.js';

export interface IKnoxAssistantMarkdownOptions {
	source: string;
	isStreaming: boolean;
	inStepContainer: boolean;
	historyIndex: number;
	history: readonly IKnoxChatHistoryItem[];
	expanded: Map<string, boolean>;
	onDidChangeHeight: () => void;
	onDidToggleExpand?: () => void;
}

export interface IKnoxMarkdownServices {
	markdown: IMarkdownRendererService;
	language: ILanguageService;
	clipboard: IClipboardService;
	hover: IHoverService;
	chat: IKnoxChatService;
	bridge: IKnoxGuiBridge;
	workspace: IWorkspaceContextService;
}

export function renderKnoxAssistantMarkdown(
	container: HTMLElement,
	options: IKnoxAssistantMarkdownOptions,
	services: IKnoxMarkdownServices,
	store: DisposableStore,
): void {
	clearNode(container);
	container.classList.add('knox-markdown', 'knox-assistant-markdown');

	if (knoxMarkdownDisplayRaw(services.chat.config?.ui)) {
		const pre = append(container, $('pre.knox-raw-markdown'));
		pre.textContent = options.source;
		return;
	}

	const rifs = knoxRifsFromHistory(options.history, options.historyIndex);
	const symbols = knoxSymbolsForContext(services.chat.symbols, rifs);
	const missing = knoxFileUrisNeedingSymbols(options.history, services.chat.symbols, options.historyIndex);
	if (missing.length) {
		void services.chat.ensureFileSymbols(missing);
	}

	const blocks = knoxParseMarkdownBlocks(options.source, options.isStreaming);
	const codeWrap = knoxMarkdownCodeWrap(services.chat.config?.ui);
	for (const block of blocks) {
		if (block.kind === 'markdown') {
			const host = append(container, $('div.knox-markdown-block'));
			const rendered = services.markdown.render(new MarkdownString(block.source, { supportThemeIcons: false }), {
				fillInIncompleteTokens: options.isStreaming,
				markedOptions: { gfm: true, breaks: true },
				asyncRenderCallback: () => options.onDidChangeHeight(),
			});
			host.appendChild(rendered.element);
			store.add(rendered);
			wireInlineLinks(host, symbols, rifs, services, store);
			continue;
		}
		renderKnoxCodeBlock(container, block, {
			inStepContainer: options.inStepContainer,
			isStreaming: options.isStreaming,
			historyIndex: options.historyIndex,
			codeWrap,
			expanded: options.expanded,
			onDidChangeHeight: options.onDidChangeHeight,
			onDidToggleExpand: options.onDidToggleExpand,
		}, services, store);
	}
}

function wireInlineLinks(
	host: HTMLElement,
	symbols: ReturnType<typeof knoxSymbolsForContext>,
	rifs: ReturnType<typeof knoxRifsFromHistory>,
	services: IKnoxMarkdownServices,
	store: DisposableStore,
): void {
	for (const code of host.querySelectorAll('code')) {
		if (code.closest('pre')) {
			continue;
		}
		const content = code.textContent ?? '';
		if (!content) {
			continue;
		}
		const matched = matchCodeToSymbolOrFile(content, symbols, rifs);
		if (!matched) {
			continue;
		}
		const replacement = document.createElement('span');
		code.replaceWith(replacement);
		if (isSymbolNotRif(matched)) {
			renderKnoxSymbolLink(replacement, matched, content, services.bridge, services.hover, store);
		} else {
			renderKnoxFilenameLink(replacement, matched, services.bridge, services.workspace, services.hover, store);
		}
	}
}
