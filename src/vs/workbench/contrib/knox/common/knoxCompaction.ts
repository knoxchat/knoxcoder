/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxLastCompaction } from './knoxChatTypes.js';

export function knoxIsCompactionBannerVisible(
	compaction: IKnoxLastCompaction | null | undefined,
): compaction is IKnoxLastCompaction {
	return Boolean(
		compaction &&
		(compaction.tokensSaved > 0 || compaction.originalMessageCount > compaction.compactedMessageCount),
	);
}

export function knoxParseLastCompaction(data: unknown): IKnoxLastCompaction | null {
	if (!data || typeof data !== 'object') {
		return null;
	}
	const record = data as Record<string, unknown>;
	const tokensSaved = typeof record.tokensSaved === 'number' ? record.tokensSaved : 0;
	const originalMessageCount = typeof record.originalMessageCount === 'number' ? record.originalMessageCount : 0;
	const compactedMessageCount = typeof record.compactedMessageCount === 'number' ? record.compactedMessageCount : 0;
	const method = record.summarizationMethod;
	const payload: IKnoxLastCompaction = {
		tokensSaved,
		originalMessageCount,
		compactedMessageCount,
		summarized: record.summarized === true,
		deduplicated: record.deduplicated === true,
		summarizationMethod: method === 'llm' || method === 'heuristic' ? method : 'none',
		summaryText: typeof record.summaryText === 'string' ? record.summaryText : undefined,
	};
	return knoxIsCompactionBannerVisible(payload) ? payload : null;
}
