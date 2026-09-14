/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const KNOX_INPUT_HISTORY_LIMIT = 100;
export const KNOX_INPUT_HISTORY_STORAGE_KEY = 'knox.inputHistory.chat';

export interface IKnoxInputHistoryState {
	entries: string[];
	/** `entries.length` means the draft (`pending`) is showing. */
	index: number;
	pending: string;
}

export function knoxCreateInputHistory(entries: readonly string[] = []): IKnoxInputHistoryState {
	const next = entries.filter(entry => entry.length > 0).slice(-KNOX_INPUT_HISTORY_LIMIT);
	return { entries: next, index: next.length, pending: '' };
}

export function knoxParseInputHistory(raw: string | undefined): string[] {
	if (!raw) {
		return [];
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
	} catch {
		return [];
	}
}

export function knoxSerializeInputHistory(entries: readonly string[]): string {
	return JSON.stringify(entries.slice(-KNOX_INPUT_HISTORY_LIMIT));
}

export function knoxInputHistoryPrev(
	state: IKnoxInputHistoryState,
	current: string,
): { state: IKnoxInputHistoryState; value?: string } {
	let next = state;
	if (state.index === state.entries.length) {
		next = { ...state, pending: current };
	}
	if (next.index > 0 && next.index <= next.entries.length) {
		const index = next.index - 1;
		return { state: { ...next, index }, value: next.entries[index] };
	}
	return { state: next };
}

export function knoxInputHistoryNext(
	state: IKnoxInputHistoryState,
): { state: IKnoxInputHistoryState; value?: string } {
	if (state.index >= 0 && state.index < state.entries.length) {
		const index = state.index + 1;
		if (index === state.entries.length) {
			return { state: { ...state, index }, value: state.pending };
		}
		return { state: { ...state, index }, value: state.entries[index] };
	}
	return { state };
}

export function knoxInputHistoryAdd(
	state: IKnoxInputHistoryState,
	value: string,
): IKnoxInputHistoryState {
	if (!value) {
		return { ...state, pending: '', index: state.entries.length };
	}
	if (state.entries[state.entries.length - 1] === value) {
		return { ...state, pending: '', index: state.entries.length };
	}
	const entries = [...state.entries, value].slice(-KNOX_INPUT_HISTORY_LIMIT);
	return { entries, pending: '', index: entries.length };
}
