/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { IMarkdownRendererService } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { IKnoxChatHistoryItem, IKnoxToolCallState } from '../../common/knoxChatTypes.js';
import { IKnoxGuiBridge } from '../../common/knoxGuiProtocol.js';
import { knoxMarkdownCodeWrap } from '../../common/knoxMarkdown.js';
import { knoxFindTool, knoxToolCardKind, knoxToolOutputItems } from '../../common/knoxToolCard.js';
import { ITerminalService } from '../../../terminal/browser/terminal.js';
import { IKnoxMarkdownServices } from '../markdown/knoxMarkdownRenderer.js';
import { renderKnoxAskUserCard } from './knoxAskUserCard.js';
import { renderKnoxCreateFileCard } from './knoxCreateFileCard.js';
import { renderKnoxExactSearchCard } from './knoxExactSearchCard.js';
import { renderKnoxGenericCodePreview } from './knoxGenericCodePreview.js';
import { renderKnoxRepoTreeCard } from './knoxRepoTreeCard.js';
import { renderKnoxTaskCard } from './knoxTaskCard.js';
import { IKnoxToolUiState, renderKnoxToolWrapper } from './knoxToolCard.js';
import { renderKnoxTerminalCard } from './knoxTerminalCard.js';

export interface IKnoxToolCardServices {
	markdown: IMarkdownRendererService;
	language: ILanguageService;
	clipboard: IClipboardService;
	hover: IHoverService;
	chat: IKnoxChatService;
	bridge: IKnoxGuiBridge;
	workspace: IWorkspaceContextService;
	terminal: ITerminalService;
}

export interface IKnoxToolCardRenderOptions {
	state: IKnoxToolCallState;
	item: IKnoxChatHistoryItem;
	historyIndex: number;
	ui: IKnoxToolUiState;
	codeBlockExpanded: Map<string, boolean>;
	onDidChangeHeight: () => void;
	onDidToggleUi?: () => void;
}

export function renderKnoxToolCard(
	parent: HTMLElement,
	options: IKnoxToolCardRenderOptions,
	services: IKnoxToolCardServices,
	store: DisposableStore,
): void {
	const { state } = options;
	const tool = knoxFindTool(services.chat.config?.tools, state.toolCall.function.name);
	const output = knoxToolOutputItems(services.chat.history, options.historyIndex, state);
	const markdownServices: IKnoxMarkdownServices = {
		markdown: services.markdown,
		language: services.language,
		clipboard: services.clipboard,
		hover: services.hover,
		chat: services.chat,
		bridge: services.bridge,
		workspace: services.workspace,
	};

	renderKnoxToolWrapper(
		parent,
		state,
		tool,
		options.ui,
		services.hover,
		store,
		options.onDidToggleUi ?? options.onDidChangeHeight,
		body => {
			const kind = knoxToolCardKind(state.toolCall.function.name);
			const toolId = state.toolCallId || state.toolCall.id;
			const toggle = options.onDidToggleUi ?? options.onDidChangeHeight;
			switch (kind) {
				case 'createFile':
					renderKnoxCreateFileCard(
						body,
						state,
						options.historyIndex,
						markdownServices,
						options.codeBlockExpanded,
						store,
						toggle,
					);
					return;
				case 'terminal':
					renderKnoxTerminalCard(body, state, output, {
						bridge: services.bridge,
						clipboard: services.clipboard,
						hover: services.hover,
						terminal: services.terminal,
						workspace: services.workspace,
						codeWrap: knoxMarkdownCodeWrap(services.chat.config?.ui),
					}, store, options.ui, toolId);
					return;
				case 'viewSubdirectory':
				case 'viewRepoMap':
					renderKnoxRepoTreeCard(
						body,
						kind,
						state.parsedArgs,
						output,
						toolId,
						options.ui,
						{
							bridge: services.bridge,
							workspace: services.workspace,
							hover: services.hover,
						},
						store,
						toggle,
					);
					return;
				case 'askUser':
					renderKnoxAskUserCard(body, state, options.ui, services.chat, store, toggle);
					return;
				case 'task':
					renderKnoxTaskCard(body, state, output);
					return;
				case 'exactSearch':
					renderKnoxExactSearchCard(
						body,
						state,
						output,
						toolId,
						options.ui,
						{
							language: services.language,
							hover: services.hover,
							bridge: services.bridge,
							workspace: services.workspace,
						},
						store,
						toggle,
					);
					return;
				default:
					renderKnoxGenericCodePreview(
						body,
						state,
						options.historyIndex,
						markdownServices,
						options.codeBlockExpanded,
						store,
						toggle,
					);
			}
		},
	);
}
