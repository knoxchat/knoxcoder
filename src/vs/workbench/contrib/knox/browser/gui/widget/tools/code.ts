/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** File / create-file / generic code previews, including live fence patches and diffs. */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { toolDisplayKind } from '../../../../common/knoxGuiChat.js';
import {
	collapseFileToolCodePreview,
	displayLanguageForFile,
	extractStreamingToolCode,
} from '../../../../common/knoxGuiTools.js';
import { IKnoxGuiState, IKnoxGuiToolCall } from '../../../../common/knoxGuiState.js';
import { IKnoxGuiMarkdownFenceBlock } from '../../../../common/knoxGuiTranscript.js';
import { codeDiffPreviewsForTool, IKnoxGuiCodeDiffFile } from '../../../../common/knoxGuiCodeDiff.js';
import { patchLiveCodeFence } from '../markdown.js';

export function renderCreateFileTool(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
	const extracted = extractStreamingToolCode({ parsedArgs: tool.parsedArgs, rawArguments: tool.arguments });
	const filepath = String(tool.parsedArgs?.filepath ?? extracted.filepath ?? '');
	const contents = String(tool.parsedArgs?.contents ?? extracted.codeContent ?? '');
	if (!filepath && !contents && !extracted.started) {
		return;
	}
	const box = DOM.append(parent, DOM.$('.knox-gui-create-file'));
	box.setAttribute('data-testid', 'knox-gui-create-file');
	if (filepath) {
		const row = DOM.append(box, DOM.$('.knox-gui-tool-file-row.knox-gui-tool-kind-title'));
		DOM.append(row, DOM.$('span.knox-gui-cyan', undefined, t(state, 'createdFile')));
		widget.renderClickablePath(row, filepath);
	}
	const additions = contents ? contents.split('\n').length : 0;
	widget.renderToolCodePreview(box, state, tool, filepath, contents, displayLanguageForFile(filepath), false, { additions });
}

export function renderGenericCodeTool(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
	const extracted = extractStreamingToolCode({ parsedArgs: tool.parsedArgs, rawArguments: tool.arguments });
	const streaming = tool.status === 'generating' || tool.status === 'calling';
	if ((!extracted.started && !extracted.codeContent && !extracted.filepath) || (!extracted.codeContent && !extracted.filepath && !streaming)) {
		return;
	}
	const previews = toolCodeDiffPreviews(tool, extracted);
	if (previews.length) {
		for (let i = 0; i < previews.length; i++) {
			renderToolDiffPreview(widget, parent, state, tool, previews[i], i, previews.length);
		}
		return;
	}
	const collapsePreview = collapseFileToolCodePreview(tool.name);
	const language = displayLanguageForFile(extracted.filepath, extracted.contentKey);
	const label = extracted.filepath || (extracted.contentKey === 'patch' || extracted.contentKey === 'diff' ? 'patch' : '');
	widget.renderToolCodePreview(parent, state, tool, label, extracted.codeContent, language, collapsePreview);
}

/** `GenericCodePreview` / `CreateFile`: the tool code is a step-container fence with the same toolbars as a reply. */
export function renderToolCodePreview(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall, filepath: string, code: string, language: string, collapsedByDefault: boolean, extras?: { additions?: number; deletions?: number; range?: string; index?: number; total?: number }): void {
	const index = extras?.index ?? 0;
	const total = extras?.total ?? 1;
	widget.renderCodeFenceBlock(parent, state, {
		streamId: toolCodeStreamId(tool.id, index, total),
		fence: { language, filepath: filepath || undefined, range: extras?.range, code },
		generating: tool.status === 'generating' || tool.status === 'calling',
		anchor: collapsedByDefault ? 'start' : 'end',
		expanded: collapsedByDefault ? false : undefined,
		additions: extras?.additions,
		deletions: extras?.deletions,
	});
}

function toolCodeStreamId(toolId: string, index: number, total: number): string {
	return total > 1 ? `tool:${toolId}:code:${index}` : `tool:${toolId}:code`;
}

export function toolCodeDiffPreviews(tool: IKnoxGuiToolCall, extracted: ReturnType<typeof extractStreamingToolCode>, kind?: ReturnType<typeof toolDisplayKind>): IKnoxGuiCodeDiffFile[] {
	if (kind === 'create-file') {
		const filepath = String(tool.parsedArgs?.filepath ?? extracted.filepath ?? '');
		const contents = String(tool.parsedArgs?.contents ?? extracted.codeContent ?? '');
		if (!filepath && !contents) {
			return [];
		}
		return [{
			filepath,
			code: contents,
			language: displayLanguageForFile(filepath),
			additions: contents ? contents.split('\n').length : 0,
			deletions: 0,
		}];
	}
	return codeDiffPreviewsForTool({
		toolName: tool.name,
		filepath: extracted.filepath,
		contentKey: extracted.contentKey,
		code: extracted.codeContent,
		parsedArgs: tool.parsedArgs,
		rawArguments: tool.arguments,
	}).map(file => ({
		...file,
		language: file.language || displayLanguageForFile(file.filepath, extracted.contentKey),
	}));
}

function renderToolDiffPreview(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall, preview: IKnoxGuiCodeDiffFile, index: number, total: number): void {
	widget.renderToolCodePreview(parent, state, tool, preview.filepath, preview.code, preview.language, collapseFileToolCodePreview(tool.name), {
		additions: preview.additions,
		deletions: preview.deletions,
		range: preview.range,
		index,
		total,
	});
}

export function patchToolCodePreview(widget: KnoxGuiWidget, codeBox: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall, preview: IKnoxGuiCodeDiffFile, index: number, generating: boolean, total: number): boolean {
	const fence: IKnoxGuiMarkdownFenceBlock = {
		type: 'fence',
		language: preview.language,
		filepath: preview.filepath || undefined,
		range: preview.range,
		code: preview.code,
		closed: !generating,
	};
	return patchLiveCodeFence(
		widget,
		[codeBox],
		state,
		{ id: tool.id, role: 'assistant', content: '' },
		fence,
		index,
		generating,
		toolCodeStreamId(tool.id, index, total),
		{ additions: preview.additions, deletions: preview.deletions },
	);
}
