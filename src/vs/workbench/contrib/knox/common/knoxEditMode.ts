/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { KnoxChatMode } from './knoxChat.js';
import { IKnoxContextProviderDescription, IKnoxMessageContent } from './knoxChatTypes.js';

/** GUI `EditStatus`. */
export type KnoxEditStatus =
	| 'not-started'
	| 'streaming'
	| 'accepting'
	| 'accepting:full-diff'
	| 'done';

export interface IKnoxEditRange {
	start: { line: number; character: number };
	end: { line: number; character: number };
}

export interface IKnoxFileToEdit {
	filepath: string;
	contents: string;
}

export interface IKnoxRangeToEdit extends IKnoxFileToEdit {
	range: IKnoxEditRange;
}

export type IKnoxCodeToEdit = IKnoxFileToEdit | IKnoxRangeToEdit;

export interface IKnoxEditModeState {
	editStatus: KnoxEditStatus;
	previousInputs: IKnoxMessageContent[];
	fileAfterEdit?: string;
}

export const KNOX_DEFAULT_EDIT_MODE_STATE: IKnoxEditModeState = {
	editStatus: 'not-started',
	previousInputs: [],
};

/** Context providers the GUI hides while `mode === 'edit'`. */
export const KNOX_EDIT_DISALLOWED_CONTEXT_PROVIDERS = new Set([
	'tree',
	'open',
	'web',
	'diff',
	'folder',
	'search',
	'debugger',
	'repo-map',
]);

export const KNOX_ADD_CODE_TO_EDIT_COMMAND_ID = 'knox.native.addCodeToEdit.accept';

export function knoxFocusEditState(): IKnoxEditModeState {
	return {
		editStatus: 'not-started',
		previousInputs: [],
	};
}

export function knoxCodeToEditHasRange(code: IKnoxCodeToEdit): code is IKnoxRangeToEdit {
	return 'range' in code && !!code.range;
}

export function knoxIsCodeToEditEqual(a: IKnoxCodeToEdit, b: IKnoxCodeToEdit): boolean {
	if (a.filepath !== b.filepath || a.contents !== b.contents) {
		return false;
	}
	if (knoxCodeToEditHasRange(a) && knoxCodeToEditHasRange(b)) {
		return a.range.start.line === b.range.start.line
			&& a.range.end.line === b.range.end.line;
	}
	return !knoxCodeToEditHasRange(a) && !knoxCodeToEditHasRange(b);
}

export function knoxAddCodeToEdit(
	existing: readonly IKnoxCodeToEdit[],
	payload: IKnoxCodeToEdit | readonly IKnoxCodeToEdit[],
): IKnoxCodeToEdit[] {
	const entries = Array.isArray(payload) ? payload : [payload];
	const next = existing.slice();
	for (const entry of entries) {
		if (!next.some(item => knoxIsCodeToEditEqual(item, entry))) {
			next.push(entry);
		}
	}
	return next;
}

export function knoxRemoveCodeToEdit(
	existing: readonly IKnoxCodeToEdit[],
	payload: IKnoxCodeToEdit,
): IKnoxCodeToEdit[] {
	return existing.filter(entry => !knoxIsCodeToEditEqual(entry, payload));
}

export function knoxIsInEditMode(mode: KnoxChatMode): boolean {
	return mode === 'edit';
}

export function knoxHasCodeToEdit(codeToEdit: readonly IKnoxCodeToEdit[]): boolean {
	return codeToEdit.length > 0;
}

export function knoxIsEditModeAndNoCodeToEdit(mode: KnoxChatMode, codeToEdit: readonly IKnoxCodeToEdit[]): boolean {
	return knoxIsInEditMode(mode) && !knoxHasCodeToEdit(codeToEdit);
}

/**
 * Single-range highlighted edit, or an empty insertion (no files yet).
 * Matches GUI `selectIsSingleRangeEditOrInsertion`.
 */
export function knoxIsSingleRangeEditOrInsertion(
	mode: KnoxChatMode,
	codeToEdit: readonly IKnoxCodeToEdit[],
): boolean {
	if (mode !== 'edit') {
		return false;
	}
	const isInsertion = codeToEdit.length === 0;
	const isSingleRange = codeToEdit.length === 1 && knoxCodeToEditHasRange(codeToEdit[0]);
	return isSingleRange || isInsertion;
}

export function knoxCanSubmitEdit(
	mode: KnoxChatMode,
	codeToEdit: readonly IKnoxCodeToEdit[],
	streaming: boolean,
): boolean {
	if (streaming) {
		return false;
	}
	return !knoxIsEditModeAndNoCodeToEdit(mode, codeToEdit);
}

const EDIT_STATUS_TRANSITIONS: ReadonlyArray<readonly [KnoxEditStatus, KnoxEditStatus]> = [
	['not-started', 'streaming'],
	['streaming', 'accepting'],
	['accepting', 'done'],
	['accepting:full-diff', 'done'],
	['accepting', 'accepting:full-diff'],
	['accepting:full-diff', 'accepting'],
	['done', 'not-started'],
];

export function knoxCanTransitionEditStatus(from: KnoxEditStatus, to: KnoxEditStatus): boolean {
	return EDIT_STATUS_TRANSITIONS.some(([a, b]) => a === from && b === to);
}

export function knoxApplyEditStatus(
	state: IKnoxEditModeState,
	status: KnoxEditStatus,
	fileAfterEdit?: string,
): IKnoxEditModeState {
	if (!knoxCanTransitionEditStatus(state.editStatus, status)) {
		return state;
	}
	const next: IKnoxEditModeState = {
		editStatus: status,
		previousInputs: state.previousInputs,
		fileAfterEdit: state.fileAfterEdit,
	};
	if (state.editStatus === 'streaming' && status === 'accepting' && fileAfterEdit !== undefined) {
		next.fileAfterEdit = fileAfterEdit;
	}
	return next;
}

export function knoxSubmitEdit(state: IKnoxEditModeState, prompt: IKnoxMessageContent): IKnoxEditModeState {
	return {
		editStatus: 'streaming',
		previousInputs: [...state.previousInputs, prompt],
		fileAfterEdit: state.fileAfterEdit,
	};
}

export function knoxSetEditDone(): IKnoxEditModeState {
	return {
		editStatus: 'done',
		previousInputs: [],
	};
}

export function knoxParseEditRange(raw: unknown): IKnoxEditRange | undefined {
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}
	const record = raw as { start?: unknown; end?: unknown };
	const start = knoxParsePosition(record.start);
	const end = knoxParsePosition(record.end);
	if (!start || !end) {
		return undefined;
	}
	return { start, end };
}

function knoxParsePosition(raw: unknown): { line: number; character: number } | undefined {
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}
	const record = raw as { line?: unknown; character?: unknown };
	if (typeof record.line !== 'number' || typeof record.character !== 'number') {
		return undefined;
	}
	return { line: record.line, character: record.character };
}

export function knoxParseCodeToEdit(data: unknown): IKnoxCodeToEdit | undefined {
	if (!data || typeof data !== 'object') {
		return undefined;
	}
	const record = data as { filepath?: unknown; contents?: unknown; range?: unknown };
	if (typeof record.filepath !== 'string' || !record.filepath) {
		return undefined;
	}
	const contents = typeof record.contents === 'string' ? record.contents : '';
	const range = knoxParseEditRange(record.range);
	if (range) {
		return { filepath: record.filepath, contents, range };
	}
	return { filepath: record.filepath, contents };
}

export function knoxParseCodeToEditList(data: unknown): IKnoxCodeToEdit[] {
	if (Array.isArray(data)) {
		const items: IKnoxCodeToEdit[] = [];
		for (const entry of data) {
			const parsed = knoxParseCodeToEdit(entry);
			if (parsed) {
				items.push(parsed);
			}
		}
		return items;
	}
	const one = knoxParseCodeToEdit(data);
	return one ? [one] : [];
}

export function knoxParseEditStatusPayload(data: unknown): { status: KnoxEditStatus; fileAfterEdit?: string } | undefined {
	if (!data || typeof data !== 'object') {
		return undefined;
	}
	const record = data as { status?: unknown; fileAfterEdit?: unknown };
	if (!isEditStatus(record.status)) {
		return undefined;
	}
	return {
		status: record.status,
		fileAfterEdit: typeof record.fileAfterEdit === 'string' ? record.fileAfterEdit : undefined,
	};
}

function isEditStatus(value: unknown): value is KnoxEditStatus {
	return value === 'not-started'
		|| value === 'streaming'
		|| value === 'accepting'
		|| value === 'accepting:full-diff'
		|| value === 'done';
}

export function knoxCodeToEditResource(filepath: string): URI {
	try {
		if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(filepath)) {
			return URI.parse(filepath);
		}
	} catch {
		// Fall through to file path.
	}
	return URI.file(filepath);
}

export function knoxCodeToEditPath(filepath: string): string {
	try {
		const resource = knoxCodeToEditResource(filepath);
		return resource.scheme === 'file' ? resource.fsPath : resource.path;
	} catch {
		return filepath;
	}
}

export function knoxCodeToEditBasename(filepath: string): string {
	const path = knoxCodeToEditPath(filepath).replace(/\\/g, '/');
	const parts = path.split('/');
	return parts[parts.length - 1] || path;
}

export function knoxRelativeEditPath(filepath: string, dirs: readonly string[]): string {
	const path = knoxCodeToEditPath(filepath);
	let best = path;
	let bestLen = -1;
	for (const dir of dirs) {
		const normalized = knoxCodeToEditPath(dir).replace(/[/\\]+$/, '');
		if (path === normalized) {
			return knoxCodeToEditBasename(path);
		}
		const prefix = normalized.endsWith('/') || normalized.endsWith('\\') ? normalized : `${normalized}/`;
		const winPrefix = prefix.replace(/\//g, '\\');
		if ((path.startsWith(prefix) || path.startsWith(winPrefix)) && normalized.length > bestLen) {
			bestLen = normalized.length;
			best = path.slice(normalized.length + 1);
		}
	}
	return best;
}

export function knoxCodeToEditCardTitle(count: number): string {
	if (count <= 0) {
		return localize('knox.editCode', "Edit Code");
	}
	return localize('knox.editCodeItems', "Edit Code ({0} items)", count);
}

export function knoxCodeToEditItemLabel(code: IKnoxCodeToEdit): {
	title: string;
	isInsertion: boolean;
	rangeLabel?: string;
} {
	const fileName = knoxCodeToEditBasename(code.filepath);
	if (!knoxCodeToEditHasRange(code)) {
		return { title: fileName, isInsertion: false };
	}
	const start = code.range.start.line + 1;
	const end = code.range.end.line + 1;
	const isInsertion = start === end;
	if (isInsertion) {
		return {
			title: localize('knox.insertingAtLine', "{0} - Inserting at line {1}", fileName, start),
			isInsertion: true,
			rangeLabel: String(start),
		};
	}
	return {
		title: `${fileName} (${start} - ${end})`,
		isInsertion: false,
		rangeLabel: `${start}-${end}`,
	};
}

export function knoxEditContextProviders(
	providers: readonly IKnoxContextProviderDescription[] | undefined,
): IKnoxContextProviderDescription[] {
	return (providers ?? []).filter(provider => !KNOX_EDIT_DISALLOWED_CONTEXT_PROVIDERS.has(provider.title));
}

export interface IKnoxHashTrigger {
	/** 0-based offset of the `#`. */
	at: number;
	query: string;
}

/** `#` add-file trigger; does not cross spaces or newlines (GUI AddCodeToEdit). */
export function knoxHashTriggerAt(text: string, offset: number): IKnoxHashTrigger | undefined {
	const clamped = Math.max(0, Math.min(offset, text.length));
	let at = -1;
	for (let i = clamped - 1; i >= 0; i--) {
		const ch = text.charAt(i);
		if (ch === '#') {
			at = i;
			break;
		}
		if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
			return undefined;
		}
	}
	if (at < 0) {
		return undefined;
	}
	return { at, query: text.slice(at + 1, clamped) };
}

export function knoxGetMultifileEditPrompt(
	codeToEdit: readonly IKnoxCodeToEdit[],
	dirs: readonly string[] = [],
): string {
	const codeToEditStr = codeToEdit
		.map(code => {
			const relative = knoxRelativeEditPath(code.filepath, dirs);
			return `
      \`\`\` ${relative}
      ${code.contents}
      \`\`\`
        `;
		})
		.join('\n');

	return `
      You are an AI assistant designed to help software engineers make multi-file edits in their codebase. Your task is to generate the necessary code changes for multiple files based on the engineer's request. Follow these guidelines:

      1. Start with a brief introduction of the task you're about to perform. Do not start with any other preamble, such as "Certainly!"
      2. When providing instructions, if a user needs to interact with a CLI, walk them through each step
      2. Perform file edits in a logical, sequential ordering
      3. For each file edit, provide a brief explanation of the changes
      4. If the user submits a code block that contains a filename in the language specifier, always include the filename in any code block you generate based on that file. The filename should be on the same line as the language specifier in your code block.
        a. When creating new files, also inlcude the filname in the language specifier of the code block.
      6. After providing all file changes, include a brief, sequential overview of the most important 3-5 edits

      Remember to be concise and focus on the code changes and their impact.

      Here's an example of how your response should be structured:

      <example>
      I'll make the following changes to implement feature X:

      1. First, I'll modify file1.js to add a new function:
      \`\`\`javascript /path/to/file1.js
      // Entire content of file1.js or changes to be made
      \`\`\`

      2. Next, let's create a new test file:
      \`\`\`javascript /path/to/file1.test.js
      # Entire content of file2.py or changes to be made
      \`\`\`

      Summary:
      - [Sequential overview of the most important 3-5 edits]
      </example>

      Here are the files to base your edits on:

      <files>
      ${codeToEditStr}
      </files>

      Please provide the multi-file edit details based on the engineer's request below:
  `;
}
