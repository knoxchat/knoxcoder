/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { KnoxGuiMarkdownFacade } from './markdownFacade.js';
import { toolDisplayKind } from '../../../../common/knoxGuiChat.js';
import { DARK_TERMINAL_PALETTE, treeThemeColors } from '../../../../common/knoxGuiTools.js';
import { IKnoxGuiState, IKnoxGuiToolCall } from '../../../../common/knoxGuiState.js';
import * as knoxGuiToolsView from '../tools.js';

/** Tool-call cards, terminals, trees, ANSI and card expansion state (`widget/tools.ts`). */
export abstract class KnoxGuiToolsFacade extends KnoxGuiMarkdownFacade {
	renderTool(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
		knoxGuiToolsView.renderTool(this, parent, state, tool);
	}

	renderToolBody(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall, kind: ReturnType<typeof toolDisplayKind>): void {
		knoxGuiToolsView.renderToolBody(this, parent, state, tool, kind);
	}

	renderToolActions(
		this: KnoxGuiWidget,
		parent: HTMLElement,
		state: IKnoxGuiState,
		tool: IKnoxGuiToolCall,
		kind: ReturnType<typeof toolDisplayKind>,
		options?: { placement?: 'card' | 'chat' | 'overlay' },
	): void {
		knoxGuiToolsView.renderToolActions(this, parent, state, tool, kind, options);
	}

	renderTerminalTool(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
		knoxGuiToolsView.renderTerminalTool(this, parent, state, tool);
	}

	renderCreateFileTool(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
		knoxGuiToolsView.renderCreateFileTool(this, parent, state, tool);
	}

	renderGenericCodeTool(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
		knoxGuiToolsView.renderGenericCodeTool(this, parent, state, tool);
	}

	renderToolCodePreview(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall, filepath: string, code: string, language: string, collapsedByDefault: boolean): void {
		knoxGuiToolsView.renderToolCodePreview(this, parent, state, tool, filepath, code, language, collapsedByDefault);
	}

	renderSubdirectoryTool(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
		knoxGuiToolsView.renderSubdirectoryTool(this, parent, state, tool);
	}

	renderRepoMapTool(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
		knoxGuiToolsView.renderRepoMapTool(this, parent, state, tool);
	}

	renderTreeCard(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, options: {
		id: string;
		kind?: 'subdirectory' | 'repo-map';
		expanded: boolean;
		theme: ReturnType<typeof treeThemeColors>;
		title: string;
		subtitle?: string;
		stats?: { files: number; folders: number; total: number; size?: string };
		emptyHint?: string;
		preview: string;
		colorized: string;
		toggleTestId: string;
		staticTestId: string;
		cardTestId?: string;
		notice?: string;
		tabs?: { active: string; onStructure: () => void; onSummary: () => void };
	}): HTMLElement {
		return knoxGuiToolsView.renderTreeCard(this, parent, state, options);
	}

	renderExactSearchTool(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
		knoxGuiToolsView.renderExactSearchTool(this, parent, state, tool);
	}

	renderTaskSubagent(this: KnoxGuiWidget, parent: HTMLElement, _state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
		knoxGuiToolsView.renderTaskSubagent(this, parent, _state, tool);
	}

	renderAskUser(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
		knoxGuiToolsView.renderAskUser(this, parent, state, tool);
	}

	appendFileIcon(this: KnoxGuiWidget, parent: HTMLElement, filepath: string, size?: number, folder?: boolean): HTMLElement {
		return knoxGuiToolsView.appendFileIcon(this, parent, filepath, size, folder);
	}

	renderClickablePath(this: KnoxGuiWidget, parent: HTMLElement, filepath: string, options?: { range?: string; startLine?: number; endLine?: number; showIcon?: boolean }): void {
		knoxGuiToolsView.renderClickablePath(this, parent, filepath, options);
	}

	appendAnsi(this: KnoxGuiWidget, parent: HTMLElement, text: string, palette: typeof DARK_TERMINAL_PALETTE): void {
		knoxGuiToolsView.appendAnsi(this, parent, text, palette);
	}

	isLightTheme(this: KnoxGuiWidget): boolean {
		return knoxGuiToolsView.isLightTheme(this);
	}

	cardExpanded(this: KnoxGuiWidget, id: string, defaultExpanded: boolean): boolean {
		return knoxGuiToolsView.cardExpanded(this, id, defaultExpanded);
	}

	toggleCardExpanded(this: KnoxGuiWidget, id: string, defaultExpanded: boolean): void {
		knoxGuiToolsView.toggleCardExpanded(this, id, defaultExpanded);
	}

	setCardTab(this: KnoxGuiWidget, id: string, tab: string): void {
		knoxGuiToolsView.setCardTab(this, id, tab);
	}
}
