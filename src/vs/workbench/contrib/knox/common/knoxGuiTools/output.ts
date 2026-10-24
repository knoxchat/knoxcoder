/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxGuiToolCall, IKnoxGuiToolOutputItem } from '../knoxGuiState.js';
import { toolStepDetail } from '../knoxGuiTranscript.js';
import { formatToolName, IKnoxGuiFinishedToolSummary } from './status.js';

/** Tool output items, finished-card summaries, and partial-output coalescing. */

export const TOOL_PARTIAL_OUTPUT_COALESCE_MS = 50;

function lineCount(text: string | undefined): number | undefined {
	if (!text) {
		return undefined;
	}
	return text.split('\n').length;
}

export function toolOutputItemsFromUnknown(value: unknown): IKnoxGuiToolOutputItem[] {
	if (value === undefined || value === null) {
		return [];
	}
	if (typeof value === 'string') {
		return value ? [{ content: value }] : [];
	}
	const list = Array.isArray(value) ? value : [value];
	const items: IKnoxGuiToolOutputItem[] = [];
	for (const part of list) {
		if (typeof part === 'string') {
			if (part) {
				items.push({ content: part });
			}
			continue;
		}
		if (!part || typeof part !== 'object') {
			continue;
		}
		const rec = part as Record<string, unknown>;
		const content = typeof rec.content === 'string' ? rec.content : typeof rec.text === 'string' ? rec.text : '';
		const name = typeof rec.name === 'string' ? rec.name : undefined;
		const description = typeof rec.description === 'string' ? rec.description : undefined;
		if (!content && !name) {
			continue;
		}
		items.push({ name, description, content });
	}
	return items;
}

export function toolOutputText(items: IKnoxGuiToolOutputItem[] | undefined, fallback?: string): string {
	if (items?.length) {
		return items.map(item => item.content).filter(Boolean).join('\n');
	}
	return fallback ?? '';
}

export function toolResultHint(call: IKnoxGuiToolCall): string | undefined {
	if (call.status === 'canceled') {
		return 'canceled';
	}
	const output = call.outputItems?.[0]?.content ?? call.output;
	const lines = lineCount(output);
	if (lines && lines > 1) {
		return `${lines} lines`;
	}
	const desc = call.outputItems?.[0]?.description?.trim();
	if (desc && desc.length < 80) {
		return desc;
	}
	return toolStepDetail(call.name, call.parsedArgs);
}

export function finishedToolSummary(call: IKnoxGuiToolCall, displayTitle?: string): IKnoxGuiFinishedToolSummary {
	const name = formatToolName(call.name, displayTitle);
	const detail = toolStepDetail(call.name, call.parsedArgs);
	const result = toolResultHint(call);
	return {
		name,
		detail,
		result: result && result !== detail ? result : undefined,
	};
}

export function createLatestValueCoalescer<K, V>(
	emit: (key: K, value: V) => void,
	options?: { waitMs?: number; schedule?: (fn: () => void, ms: number) => () => void },
): { enqueue: (key: K, value: V) => void; flush: () => void; dispose: () => void } {
	const waitMs = options?.waitMs ?? TOOL_PARTIAL_OUTPUT_COALESCE_MS;
	const schedule = options?.schedule ?? ((fn: () => void, ms: number) => {
		const timer = setTimeout(fn, ms);
		return () => clearTimeout(timer);
	});
	const pending = new Map<K, V>();
	let cancel: (() => void) | null = null;
	const flush = () => {
		cancel?.();
		cancel = null;
		for (const [key, value] of pending) {
			emit(key, value);
		}
		pending.clear();
	};
	return {
		enqueue(key: K, value: V) {
			pending.set(key, value);
			if (!cancel) {
				cancel = schedule(flush, waitMs);
			}
		},
		flush,
		dispose() {
			cancel?.();
			cancel = null;
			pending.clear();
		},
	};
}
