/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KnoxChatMode } from './knoxChat.js';
import {
	buildKnoxAgentActivitySteps,
	IKnoxAgentActivityStep,
	knoxItemCreatedAtMs,
} from './knoxAgentActivity.js';
import { getHistoryToolStates } from './knoxChatHistory.js';
import {
	IKnoxChatHistoryItem,
	IKnoxToolCallState,
	knoxAssistantReplyText,
	messageHasVisibleContent,
	renderKnoxChatMessage,
} from './knoxChatTypes.js';
import { knoxVisibleToolOutputItems } from './knoxToolOutput.js';
import {
	knoxLastUserIndex,
	knoxVisibleHistoryIndexes,
} from './knoxChatHistoryWindow.js';

export type KnoxThreadRowKind =
	| 'user'
	| 'assistant'
	| 'thinking'
	| 'tool'
	| 'timeline'
	| 'loading'
	| 'loadEarlier'
	| 'spacer';

export interface IKnoxThreadRow {
	readonly id: string;
	readonly kind: KnoxThreadRowKind;
	readonly historyIndex: number;
	measuredHeight: number | undefined;
	item?: IKnoxChatHistoryItem;
	isLast?: boolean;
	userIndex?: number;
	toolState?: IKnoxToolCallState;
	steps?: IKnoxAgentActivityStep[];
	startedAt?: number;
	timelineExpanded?: boolean;
	/** Snapshot of painted content, stamped by `buildKnoxThreadRows`. */
	paintKey?: string;
}

export interface IKnoxThreadModelOptions {
	mode: KnoxChatMode;
	isStreaming: boolean;
	timelineExpanded?: ReadonlySet<number>;
	/**
	 * Inclusive history index of the first mounted message. `0` (default) mounts
	 * the full transcript. The thread list passes `resolveDisplayStart` so only
	 * the latest window (and the live last-user prompt) is painted.
	 */
	displayStart?: number;
	lastUserIndex?: number;
}

const DEFAULT_HEIGHT: Record<KnoxThreadRowKind, number> = {
	user: 72,
	assistant: 88,
	thinking: 64,
	tool: 96,
	timeline: 52,
	loading: 32,
	loadEarlier: 28,
	spacer: 0,
};

export function knoxThreadRowHeight(row: IKnoxThreadRow): number {
	return row.measuredHeight ?? DEFAULT_HEIGHT[row.kind];
}

/**
 * Spacer height is owned by `_syncSpacer` and must not be DOM-probed (an empty
 * row measures 0). Every other row returns `null` so ListView remeasures after
 * each paint — returning a cached height skips the probe and clips streaming
 * markdown behind `overflow: hidden`.
 */
export function knoxThreadDynamicHeight(row: IKnoxThreadRow): number | null {
	if (row.kind === 'spacer') {
		return row.measuredHeight ?? 0;
	}
	return null;
}

/** A single WorkbenchList splice operation. */
export interface IKnoxThreadSplice {
	start: number;
	deleteCount: number;
	rows: IKnoxThreadRow[];
}

export interface IKnoxThreadRowDiff {
	/**
	 * True when the row **id sequence** is identical to the previous rows, so
	 * the list does not need to add/remove rows — only re-render the rows whose
	 * content changed. This is the common streaming case.
	 */
	unchangedOrder: boolean;
	/** Add/remove script. Empty when `unchangedOrder` is true. */
	splices: IKnoxThreadSplice[];
	/**
	 * Indices whose row content changed in place (same id, new object). The
	 * caller splices just those rows so the list re-renders them without
	 * resetting identity, heights, or scroll for the rest.
	 */
	changedIndices: number[];
}

function sameIdSequence(a: readonly IKnoxThreadRow[], b: readonly IKnoxThreadRow[]): boolean {
	if (a.length !== b.length) {
		return false;
	}
	for (let i = 0; i < a.length; i++) {
		if (a[i].id !== b[i].id) {
			return false;
		}
	}
	return true;
}

function sameRowContent(a: IKnoxThreadRow, b: IKnoxThreadRow): boolean {
	if (
		a.kind !== b.kind
		|| a.historyIndex !== b.historyIndex
		|| a.isLast !== b.isLast
		|| a.timelineExpanded !== b.timelineExpanded
		|| a.startedAt !== b.startedAt
		|| a.userIndex !== b.userIndex
	) {
		return false;
	}
	// Snapshot keys are stamped at build time so in-place history mutations
	// (streaming tokens, tools/partialOutput) still dirty the row.
	if (a.paintKey !== undefined || b.paintKey !== undefined) {
		return a.paintKey === b.paintKey;
	}
	return a.item === b.item && a.toolState === b.toolState && a.steps === b.steps;
}

function computePaintKey(row: IKnoxThreadRow): string {
	const item = row.item;
	const tool = row.toolState;
	const content = item ? renderKnoxChatMessage(item.message) : '';
	const output = (tool?.output ?? []).map(entry => `${entry.name}:${entry.content}`).join('\n');
	const steps = (row.steps ?? []).map(step => `${step.id}:${step.kind}:${step.status}:${step.detail ?? ''}`).join(',');
	return [
		content,
		item?.reasoning?.text ?? '',
		item?.reasoning?.active ? '1' : '0',
		item?.isGatheringContext ? '1' : '0',
		item?.message.redactedThinking ?? '',
		tool?.status ?? '',
		output,
		tool ? JSON.stringify(tool.parsedArgs ?? {}) : '',
		steps,
	].join('\x1e');
}

/**
 * Minimal splice script to turn `previous` into `next`, keyed by row id.
 * Preserves list identity, measured heights, collapse maps, and scroll for the
 * common streaming case (only the last assistant/thinking/tool row changes).
 */
export function diffKnoxThreadRows(
	previous: readonly IKnoxThreadRow[],
	next: readonly IKnoxThreadRow[],
): IKnoxThreadRowDiff {
	if (sameIdSequence(previous, next)) {
		const changedIndices: number[] = [];
		for (let i = 0; i < next.length; i++) {
			if (!sameRowContent(previous[i], next[i])) {
				changedIndices.push(i);
			}
		}
		return { unchangedOrder: true, splices: [], changedIndices };
	}

	const previousIds = previous.map(row => row.id);
	const nextIds = next.map(row => row.id);

	// Longest common prefix and suffix bound the changed span, so appends and
	// in-place edits produce a single small splice.
	let prefix = 0;
	while (prefix < previousIds.length && prefix < nextIds.length && previousIds[prefix] === nextIds[prefix]) {
		prefix += 1;
	}
	let suffix = 0;
	while (
		suffix < previousIds.length - prefix
		&& suffix < nextIds.length - prefix
		&& previousIds[previousIds.length - 1 - suffix] === nextIds[nextIds.length - 1 - suffix]
	) {
		suffix += 1;
	}

	const deleteCount = previousIds.length - prefix - suffix;
	const rows = next.slice(prefix, nextIds.length - suffix);
	const splices: IKnoxThreadSplice[] = [];
	if (deleteCount > 0 || rows.length > 0) {
		splices.push({ start: prefix, deleteCount, rows });
	}

	return { unchangedOrder: false, splices, changedIndices: [] };
}

/** Same visible reply already shown on the previous assistant (skip thinking). */
export function isDuplicateKnoxAssistantReply(
	history: readonly IKnoxChatHistoryItem[],
	index: number,
): boolean {
	const item = history[index];
	if (item.message.role !== 'assistant') {
		return false;
	}
	const content = knoxAssistantReplyText(item);
	if (!content) {
		return false;
	}
	for (let i = index - 1; i >= 0; i--) {
		const prev = history[i];
		if (prev.message.role === 'thinking') {
			continue;
		}
		if (prev.message.role !== 'assistant') {
			return false;
		}
		return knoxAssistantReplyText(prev) === content;
	}
	return false;
}

export function knoxTurnHasVisibleProgress(
	history: readonly IKnoxChatHistoryItem[],
	userIndex: number,
): boolean {
	for (let i = userIndex + 1; i < history.length; i++) {
		const item = history[i];
		if (item.message.role === 'user') {
			break;
		}
		if (item.toolCallState || (item.toolCallStates?.length ?? 0) > 0) {
			return true;
		}
		if (item.message.role === 'thinking') {
			return true;
		}
		if (item.reasoning?.text?.trim()) {
			return true;
		}
		if (messageHasVisibleContent(item.message.content)) {
			return true;
		}
	}
	return false;
}

export function isLastKnoxUserInput(
	history: readonly IKnoxChatHistoryItem[],
	index: number,
): boolean {
	return !history.slice(index + 1).some(entry => entry.message.role === 'user');
}

export function knoxMessageHasReasoning(item: IKnoxChatHistoryItem): boolean {
	return !!item.reasoning?.text?.trim() || !!item.reasoning?.active;
}

export function knoxAssistantIsTruncated(item: IKnoxChatHistoryItem, isStreaming: boolean, isLast: boolean): boolean {
	if (isStreaming && isLast) {
		return false;
	}
	const content = renderKnoxChatMessage(item.message).trim();
	if (!content) {
		return false;
	}
	const endingPunctuation = ['.', '?', '!', '```', ':'];
	if (endingPunctuation.some(p => content.endsWith(p))) {
		return false;
	}
	if (/\p{Emoji}/u.test(content.slice(-2))) {
		return false;
	}
	return true;
}

function rowId(kind: KnoxThreadRowKind, key: string): string {
	return `${kind}:${key}`;
}

function historyKey(item: IKnoxChatHistoryItem, index: number): string {
	return item.message.id ?? item.messageId ?? String(index);
}

/**
 * Flatten session history into WorkbenchList rows matching `knox/gui` Chat.tsx:
 * user bubbles, completed-turn timelines, chat-mode loading, assistant/thinking
 * bodies, and native tool cards.
 */
export function buildKnoxThreadRows(
	history: readonly IKnoxChatHistoryItem[],
	options: IKnoxThreadModelOptions,
): IKnoxThreadRow[] {
	const rows: IKnoxThreadRow[] = [];
	const lastIndex = history.length - 1;
	const displayStart = options.displayStart ?? 0;
	const lastUserIndex = options.lastUserIndex ?? knoxLastUserIndex(history);
	const visible = new Set(knoxVisibleHistoryIndexes(history, displayStart, lastUserIndex));

	for (let index = 0; index < history.length; index++) {
		if (!visible.has(index)) {
			continue;
		}
		const item = history[index];
		const duplicateReply = isDuplicateKnoxAssistantReply(history, index);
		const replyText = knoxAssistantReplyText(item);
		const showAssistantReply = !!replyText && !duplicateReply;
		const isLast = index === lastIndex;

		if (item.message.role === 'user') {
			rows.push({
				id: rowId('user', historyKey(item, index)),
				kind: 'user',
				historyIndex: index,
				measuredHeight: undefined,
				item,
				isLast,
			});

			const lastUser = isLastKnoxUserInput(history, index);
			if (options.mode === 'agent') {
				if (!lastUser) {
					const steps = buildKnoxAgentActivitySteps(history, index);
					if (steps.length) {
						rows.push({
							id: rowId('timeline', String(index)),
							kind: 'timeline',
							historyIndex: index,
							measuredHeight: undefined,
							userIndex: index,
							steps,
							timelineExpanded: options.timelineExpanded?.has(index) === true,
						});
					}
				}
			} else if (
				options.isStreaming &&
				lastUser &&
				!knoxTurnHasVisibleProgress(history, index)
			) {
				rows.push({
					id: rowId('loading', String(index)),
					kind: 'loading',
					historyIndex: index,
					measuredHeight: undefined,
					userIndex: index,
					startedAt: knoxItemCreatedAtMs(item),
				});
			}
			continue;
		}

		if (item.message.role === 'tool') {
			if (!knoxVisibleToolOutputItems(item.contextItems).length) {
				continue;
			}
			rows.push({
				id: rowId('tool', item.message.toolCallId ?? historyKey(item, index)),
				kind: 'tool',
				historyIndex: index,
				measuredHeight: undefined,
				item,
			});
			continue;
		}

		const toolStates = getHistoryToolStates(item);
		if (item.message.role === 'assistant' && item.message.toolCalls && toolStates.length) {
			if (showAssistantReply || knoxMessageHasReasoning(item)) {
				rows.push({
					id: rowId('assistant', historyKey(item, index)),
					kind: 'assistant',
					historyIndex: index,
					measuredHeight: undefined,
					item,
					isLast,
				});
			}
			for (const state of toolStates) {
				rows.push({
					id: rowId('tool', state.toolCallId || state.toolCall.id),
					kind: 'tool',
					historyIndex: index,
					measuredHeight: undefined,
					item,
					toolState: state,
				});
			}
			continue;
		}

		if (item.message.role === 'thinking') {
			const prev = history[index - 1];
			const duplicateRedacted = !!(
				item.message.redactedThinking
				&& prev?.message.role === 'thinking'
				&& prev.message.redactedThinking
			);
			if (duplicateRedacted) {
				continue;
			}
			rows.push({
				id: rowId('thinking', historyKey(item, index)),
				kind: 'thinking',
				historyIndex: index,
				measuredHeight: undefined,
				item,
				isLast,
			});
			continue;
		}

		if (duplicateReply) {
			continue;
		}

		rows.push({
			id: rowId('assistant', historyKey(item, index)),
			kind: 'assistant',
			historyIndex: index,
			measuredHeight: undefined,
			item,
			isLast,
		});
	}

	for (const row of rows) {
		row.paintKey = computePaintKey(row);
	}
	return rows;
}

export const KNOX_LOAD_EARLIER_ROW_ID = 'knox-thread-load-earlier';

export function knoxLoadEarlierRow(hiddenCount: number): IKnoxThreadRow {
	return {
		id: KNOX_LOAD_EARLIER_ROW_ID,
		kind: 'loadEarlier',
		historyIndex: -1,
		measuredHeight: undefined,
		userIndex: hiddenCount,
		paintKey: `loadEarlier:${hiddenCount}`,
	};
}

/** Prepend the Load-earlier control when the display window hides older messages. */
export function withKnoxLoadEarlierRow(rows: IKnoxThreadRow[], displayStart: number): IKnoxThreadRow[] {
	if (displayStart <= 0) {
		return rows;
	}
	return [knoxLoadEarlierRow(displayStart), ...rows];
}

export const KNOX_THREAD_SPACER_ID = 'knox-thread-spacer';

export function knoxThreadSpacerRow(pad: number): IKnoxThreadRow {
	return {
		id: KNOX_THREAD_SPACER_ID,
		kind: 'spacer',
		historyIndex: -1,
		measuredHeight: pad,
	};
}

export function knoxContentThreadRows(rows: readonly IKnoxThreadRow[]): IKnoxThreadRow[] {
	return rows.filter(row => row.kind !== 'spacer');
}

/**
 * Last index that `WorkbenchList.reveal` will accept. Prefer `_list.length`
 * over `_rows.length` — a phantom leading spacer in `_rows` is how
 * `ListError [KnoxThread] Invalid index` takes down the pane.
 */
export function knoxLastRevealIndex(listLength: number): number | undefined {
	return listLength > 0 ? listLength - 1 : undefined;
}

export type KnoxSpacerListOp =
	| { readonly type: 'none' }
	| { readonly type: 'clear' }
	| { readonly type: 'remove' }
	| { readonly type: 'insert'; readonly row: IKnoxThreadRow }
	| { readonly type: 'update'; readonly pad: number };

/**
 * Keep the synthetic flex spacer in `_rows` and the WorkbenchList in lockstep.
 * Callers must apply `op` to the list; inventing a spacer in `_rows` without
 * inserting it is the Invalid-index crash on send.
 */
export function knoxThreadSpacerSync(args: {
	viewport: number;
	rows: readonly IKnoxThreadRow[];
	listHasSpacer: boolean;
}): { rows: IKnoxThreadRow[]; op: KnoxSpacerListOp } {
	const content = knoxContentThreadRows(args.rows);
	if (args.viewport <= 0) {
		return { rows: content, op: { type: 'none' } };
	}
	if (!content.length) {
		if (args.listHasSpacer || args.rows.length > 0) {
			return { rows: [], op: { type: 'clear' } };
		}
		return { rows: [], op: { type: 'none' } };
	}
	const contentHeight = content.reduce((sum, row) => sum + knoxThreadRowHeight(row), 0);
	const pad = Math.max(0, args.viewport - contentHeight);
	if (pad === 0) {
		if (args.listHasSpacer) {
			return { rows: content, op: { type: 'remove' } };
		}
		return { rows: content, op: { type: 'none' } };
	}
	const spacer = knoxThreadSpacerRow(pad);
	const rows = [spacer, ...content];
	if (args.listHasSpacer) {
		return { rows, op: { type: 'update', pad } };
	}
	return { rows, op: { type: 'insert', row: spacer } };
}
