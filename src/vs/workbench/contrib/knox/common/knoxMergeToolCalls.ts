/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxToolCallDelta, IKnoxToolCallState, incrementalParseJson } from './knoxChatTypes.js';
import { resolveBuiltInToolName } from './knoxToolNames.js';

/** Merge streamed tool-call deltas by `index` (OpenAI) or `id` (Anthropic). */
export function mergeToolCallDeltas(
	existing: IKnoxToolCallDelta[],
	incoming: IKnoxToolCallDelta[],
): IKnoxToolCallDelta[] {
	const next: IKnoxToolCallDelta[] = existing.map(toolCall => ({
		...toolCall,
		function: {
			name: toolCall.function?.name ?? '',
			arguments: toolCall.function?.arguments ?? '',
		},
	}));

	for (const delta of incoming) {
		let target = -1;
		if (typeof delta.index === 'number' && delta.index >= 0) {
			target = delta.index;
		} else if (delta.id) {
			target = next.findIndex(toolCall => toolCall.id === delta.id);
		}
		if (target < 0) {
			target = next.length;
		}
		while (next.length <= target) {
			next.push({
				type: 'function',
				function: { name: '', arguments: '' },
			});
		}
		const current = next[target];
		if (delta.id) {
			current.id = delta.id;
		}
		if (delta.type) {
			current.type = delta.type;
		}
		if (typeof delta.index === 'number') {
			current.index = delta.index;
		}
		current.function = {
			name: delta.function?.name || current.function?.name || '',
			arguments: (current.function?.arguments ?? '') + (delta.function?.arguments ?? ''),
		};
	}

	return next;
}

export function toolCallDeltaToState(toolCallDelta: IKnoxToolCallDelta): IKnoxToolCallState {
	const [, parsedArgs] = incrementalParseJson(toolCallDelta.function?.arguments ?? '{}');
	const rawName = toolCallDelta.function?.name ?? '';
	return {
		status: 'generating',
		toolCall: {
			id: toolCallDelta.id ?? '',
			type: 'function',
			function: {
				name: resolveBuiltInToolName(rawName) || rawName,
				arguments: toolCallDelta.function?.arguments ?? '',
			},
		},
		toolCallId: toolCallDelta.id ?? '',
		parsedArgs,
	};
}

export function syncToolCallStatesFromDeltas(
	deltas: IKnoxToolCallDelta[],
	previous: IKnoxToolCallState[] | undefined,
): IKnoxToolCallState[] {
	return deltas.map((delta, index) => {
		const prev =
			previous?.find(state => state.toolCallId && state.toolCallId === delta.id) ??
			previous?.[index];
		const next = toolCallDeltaToState(delta);
		if (!prev) {
			return next;
		}
		return {
			...prev,
			toolCallId: next.toolCallId || prev.toolCallId,
			parsedArgs: next.parsedArgs,
			toolCall: next.toolCall,
		};
	});
}

export function primaryToolCallState(
	states: IKnoxToolCallState[] | undefined,
): IKnoxToolCallState | undefined {
	if (!states?.length) {
		return undefined;
	}
	return (
		states.find(
			state =>
				state.status === 'calling' ||
				state.status === 'generated' ||
				state.status === 'generating',
		) ?? states[states.length - 1]
	);
}
