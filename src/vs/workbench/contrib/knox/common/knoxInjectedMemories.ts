/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxInjectedMemoryItem } from './knoxChatTypes.js';

/** Collapse below this fusion score in selective memory mode. */
export const KNOX_SELECTIVE_COLLAPSE_BELOW = 0.7;

export function knoxParseMemoryMode(data: unknown): string {
	if (!data || typeof data !== 'object') {
		return 'summarized';
	}
	const record = data as { config?: { memory_mode?: unknown }; memory_mode?: unknown };
	const mode = record.config?.memory_mode ?? record.memory_mode;
	return typeof mode === 'string' && mode ? mode : 'summarized';
}

export function knoxPartitionInjectedMemories(
	items: readonly IKnoxInjectedMemoryItem[],
	memoryMode: string,
): { visible: readonly IKnoxInjectedMemoryItem[]; collapsed: readonly IKnoxInjectedMemoryItem[] } {
	if (memoryMode !== 'selective') {
		return { visible: items, collapsed: [] };
	}
	const visible = items.filter(item =>
		item.kind === 'timeout' ||
		item.kind === 'goal' ||
		typeof item.score !== 'number' ||
		item.score >= KNOX_SELECTIVE_COLLAPSE_BELOW,
	);
	const collapsed = items.filter(item => !visible.includes(item));
	return { visible, collapsed };
}

export function knoxInjectedMemoryIsTimeout(items: readonly IKnoxInjectedMemoryItem[]): boolean {
	return items.length === 1 && items[0].kind === 'timeout';
}

export function knoxInjectedMemoryIsActionable(item: IKnoxInjectedMemoryItem): boolean {
	return item.id != null && item.kind === 'semantic';
}
