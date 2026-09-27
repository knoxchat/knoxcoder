/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxChatMode, KnoxGuiEditStatus } from './knoxGuiState.js';

export type { KnoxGuiEditStatus } from './knoxGuiState.js';
export interface IKnoxGuiCodeToEditRange {
	start: { line: number; character?: number };
	end: { line: number; character?: number };
}

export interface IKnoxGuiCodeToEdit {
	filepath: string;
	contents?: string;
	range?: IKnoxGuiCodeToEditRange;
}

export interface IKnoxGuiEditModeSlice {
	mode: KnoxChatMode;
	codeToEdit: IKnoxGuiCodeToEdit[];
	editStatus: KnoxGuiEditStatus;
	editPreviousInputs: string[];
	editFileAfterEdit?: string;
}

const EDIT_STATUS_TRANSITIONS: Record<KnoxGuiEditStatus, ReadonlySet<KnoxGuiEditStatus>> = {
	'not-started': new Set(['streaming']),
	streaming: new Set(['accepting']),
	accepting: new Set(['done', 'accepting:full-diff']),
	'accepting:full-diff': new Set(['done', 'accepting']),
	done: new Set(['not-started']),
};

export function knoxGuiResetEditModeState(): Pick<IKnoxGuiEditModeSlice, 'editStatus' | 'editPreviousInputs' | 'editFileAfterEdit'> {
	return {
		editStatus: 'not-started',
		editPreviousInputs: [],
		editFileAfterEdit: undefined,
	};
}

export function knoxGuiNextEditStatus(current: KnoxGuiEditStatus, next: string): KnoxGuiEditStatus | undefined {
	if (!isEditStatus(next)) {
		return undefined;
	}
	return EDIT_STATUS_TRANSITIONS[current].has(next) ? next : undefined;
}

export function isEditStatus(value: string): value is KnoxGuiEditStatus {
	return value === 'not-started'
		|| value === 'streaming'
		|| value === 'accepting'
		|| value === 'accepting:full-diff'
		|| value === 'done';
}

export function isCodeToEditEqual(a: IKnoxGuiCodeToEdit, b: IKnoxGuiCodeToEdit): boolean {
	if (a.filepath !== b.filepath || a.contents !== b.contents) {
		return false;
	}
	if (a.range && b.range) {
		return a.range.start.line === b.range.start.line && a.range.end.line === b.range.end.line;
	}
	return !a.range && !b.range;
}

export function mergeCodeToEdit(existing: IKnoxGuiCodeToEdit[], incoming: IKnoxGuiCodeToEdit | IKnoxGuiCodeToEdit[]): IKnoxGuiCodeToEdit[] {
	const entries = Array.isArray(incoming) ? incoming : [incoming];
	const next = existing.slice();
	for (const entry of entries) {
		if (!next.some(item => isCodeToEditEqual(item, entry))) {
			next.push(entry);
		}
	}
	return next;
}

export function parseCodeToEdit(raw: Record<string, unknown>): IKnoxGuiCodeToEdit | undefined {
	const nested = isRecord(raw.rangeInFileWithContents)
		? raw.rangeInFileWithContents
		: isRecord(raw.rangeInFile)
			? raw.rangeInFile
			: raw;
	const filepath = typeof nested.filepath === 'string' ? nested.filepath
		: typeof raw.filepath === 'string' ? raw.filepath
			: undefined;
	if (!filepath) {
		return undefined;
	}
	const contents = nested.contents != null ? String(nested.contents)
		: raw.contents != null ? String(raw.contents)
			: undefined;
	const rangeRec = isRecord(nested.range) ? nested.range : isRecord(raw.range) ? raw.range : undefined;
	const start = isRecord(rangeRec?.start) ? rangeRec.start : undefined;
	const end = isRecord(rangeRec?.end) ? rangeRec.end : undefined;
	const range = start && end && typeof start.line === 'number' && typeof end.line === 'number'
		? {
			start: { line: Number(start.line), character: typeof start.character === 'number' ? start.character : 0 },
			end: { line: Number(end.line), character: typeof end.character === 'number' ? end.character : 0 },
		}
		: undefined;
	return { filepath, contents, range };
}

export function parseCodeToEditList(raw: unknown): IKnoxGuiCodeToEdit[] {
	const items = Array.isArray(raw) ? raw : [raw];
	const parsed: IKnoxGuiCodeToEdit[] = [];
	for (const item of items) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const code = parseCodeToEdit(item as Record<string, unknown>);
		if (code) {
			parsed.push(code);
		}
	}
	return parsed;
}

/** Single-range Cmd+I edit. Whole-file chips without a range are multi-file. */
export function isSingleRangeEdit(state: { mode: KnoxChatMode; codeToEdit: Array<{ range?: unknown }> }): boolean {
	return state.mode === 'edit' && state.codeToEdit.length === 1 && state.codeToEdit[0].range != null;
}

export function isSingleRangeEditOrInsertion(state: { mode: KnoxChatMode; codeToEdit: Array<{ range?: unknown }> }): boolean {
	if (state.mode !== 'edit') {
		return false;
	}
	return state.codeToEdit.length === 0 || isSingleRangeEdit(state);
}

/** Native composer posts `edit/sendPrompt` only when one ranged chip is present. */
export function shouldSendEditPrompt(state: { mode: KnoxChatMode; codeToEdit: Array<{ range?: unknown }> }): boolean {
	return isSingleRangeEdit(state);
}

export function shouldFocusEditorOnEditExit(state: { mode: KnoxChatMode; codeToEdit: Array<{ range?: unknown }> }): boolean {
	return isSingleRangeEditOrInsertion(state);
}

export function knoxGuiMultifileEditPrompt(codeToEdit: IKnoxGuiCodeToEdit[]): string {
	const files = codeToEdit.map(code => {
		const name = code.filepath.split(/[/\\]/).pop() ?? code.filepath;
		return `\`\`\` ${name}\n${code.contents ?? ''}\n\`\`\``;
	}).join('\n');
	return [
		'You are an AI assistant designed to help software engineers make multi-file edits in their codebase. Your task is to generate the necessary code changes for multiple files based on the engineer\'s request. Follow these guidelines:',
		'',
		'1. Start with a brief introduction of the task you\'re about to perform. Do not start with any other preamble, such as "Certainly!"',
		'2. When providing instructions, if a user needs to interact with a CLI, walk them through each step',
		'3. Perform file edits in a logical, sequential ordering',
		'4. For each file edit, provide a brief explanation of the changes',
		'5. If the user submits a code block that contains a filename in the language specifier, always include the filename in any code block you generate based on that file.',
		'6. After providing all file changes, include a brief, sequential overview of the most important 3-5 edits',
		'',
		'Here are the files to base your edits on:',
		'',
		'<files>',
		files,
		'</files>',
		'',
		'Please provide the multi-file edit details based on the engineer\'s request below:',
	].join('\n');
}

export function editSendPromptPayload(prompt: string, code: IKnoxGuiCodeToEdit, selectedModelTitle: string): { prompt: string; range: IKnoxGuiCodeToEdit; selectedModelTitle: string } {
	return { prompt, range: code, selectedModelTitle };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
