/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxToolCallState } from './knoxChatTypes.js';
import {
	knoxCalculateFence,
	knoxExtractStreamingToolCode,
} from './knoxStreamingToolCode.js';
import { KnoxBuiltInToolName, resolveBuiltInToolName } from './knoxToolNames.js';

const COLLAPSED_FILE_PREVIEW_TOOLS = new Set<string>([
	KnoxBuiltInToolName.ReadFile,
	KnoxBuiltInToolName.ReadCurrentlyOpenFile,
]);

const LANGUAGE_BY_EXT: Record<string, string> = {
	py: 'python',
	js: 'javascript',
	jsx: 'jsx',
	tsx: 'tsx',
	ts: 'typescript',
	java: 'java',
	class: 'java',
	go: 'go',
	rb: 'ruby',
	rs: 'rust',
	c: 'c',
	cpp: 'cpp',
	cs: 'csharp',
	php: 'php',
	scala: 'scala',
	swift: 'swift',
	kt: 'kotlin',
	md: 'markdown',
	json: 'json',
	html: 'html',
	css: 'css',
	sh: 'shell',
	yaml: 'yaml',
	yml: 'yaml',
	toml: 'toml',
	tex: 'latex',
	sql: 'sql',
	ps1: 'powershell',
};

export interface IKnoxGenericCodePreview {
	filepath: string;
	codeContent: string;
	contentKey?: string;
	language: string;
	source: string;
	collapse: boolean;
}

/** Read-file cards have no generated code to show — keep the fence collapsed. */
export function knoxCollapseFileToolCodePreview(toolName?: string): boolean {
	return COLLAPSED_FILE_PREVIEW_TOOLS.has(resolveBuiltInToolName(toolName));
}

export function knoxMarkdownLanguageTagForFile(filepath: string): string {
	const raw = filepath.split('.').pop() ?? '';
	const match = raw.match(/^(\S+)\s*(\(.*\))?$/);
	const ext = (match?.[1] ?? raw).toLowerCase();
	if (!ext) {
		return '';
	}
	return LANGUAGE_BY_EXT[ext] ?? ext;
}

export function knoxGenericPreviewLanguage(filepath: string, contentKey?: string): string {
	if (contentKey === 'patch' || contentKey === 'diff') {
		return 'diff';
	}
	if (!filepath) {
		return '';
	}
	const lang = knoxMarkdownLanguageTagForFile(filepath);
	return lang === 'markdown' ? 'text' : lang;
}

export function knoxGenericCodePreview(state: IKnoxToolCallState): IKnoxGenericCodePreview | undefined {
	const extracted = knoxExtractStreamingToolCode({
		parsedArgs: state.parsedArgs,
		rawArguments: state.toolCall.function.arguments,
	});
	const isStreaming = state.status === 'generating' || state.status === 'calling';
	if (!extracted.started && !extracted.codeContent && !extracted.filepath) {
		return undefined;
	}
	if (!extracted.codeContent && !extracted.filepath && !isStreaming) {
		return undefined;
	}

	const language = knoxGenericPreviewLanguage(extracted.filepath, extracted.contentKey);
	const fence = knoxCalculateFence(extracted.codeContent);
	const label = extracted.filepath || (extracted.contentKey === 'patch' || extracted.contentKey === 'diff' ? 'patch' : '');
	return {
		filepath: extracted.filepath,
		codeContent: extracted.codeContent,
		contentKey: extracted.contentKey,
		language,
		source: `${fence}${language} ${label}\n${extracted.codeContent}\n${fence}`,
		collapse: knoxCollapseFileToolCodePreview(state.toolCall.function.name),
	};
}
