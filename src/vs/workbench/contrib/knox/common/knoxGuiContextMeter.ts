/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** K-012: composer context meter. Mirrors core `agent/contextBudget.ts` (compaction starts at 75%). */

export const KNOX_CONTEXT_FALLBACK_LIMIT = 128_000;
export const KNOX_CONTEXT_WARN_RATIO = 0.75;
export const KNOX_CONTEXT_HIGH_RATIO = 0.9;

export interface IKnoxGuiContextUsage {
	sessionId: string;
	used: number;
	limit: number;
	source: 'reported' | 'estimated';
}

export type KnoxContextLevel = 'ok' | 'warn' | 'high';

/** Provider-reported prompt tokens win; otherwise about 4 characters per token of the logged prompt. */
export function knoxGuiContextUsageFromLog(
	log: { prompt?: unknown; usage?: unknown },
	limit: number,
	sessionId: string,
): IKnoxGuiContextUsage | undefined {
	const usage = log.usage && typeof log.usage === 'object' ? log.usage as { promptTokens?: unknown } : undefined;
	const reported = typeof usage?.promptTokens === 'number' && usage.promptTokens > 0 ? usage.promptTokens : undefined;
	if (reported === undefined && (typeof log.prompt !== 'string' || !log.prompt)) {
		return undefined;
	}
	const used = reported ?? Math.ceil((log.prompt as string).length / 4);
	return { sessionId, used, limit, source: reported !== undefined ? 'reported' : 'estimated' };
}

/** Context window of the selected model: catalog entries by model id, else the 128k default. */
export function knoxGuiResolveContextLimit(
	modelId: string | undefined,
	catalogs: ReadonlyArray<ReadonlyArray<{ model: string; contextLength: number }>>,
): number {
	if (modelId) {
		for (const catalog of catalogs) {
			const hit = catalog.find(entry => entry.model === modelId);
			if (hit && Number.isFinite(hit.contextLength) && hit.contextLength > 0) {
				return hit.contextLength;
			}
		}
	}
	return KNOX_CONTEXT_FALLBACK_LIMIT;
}

export function knoxGuiContextRatio(usage: Pick<IKnoxGuiContextUsage, 'used' | 'limit'>): number {
	return usage.limit > 0 ? Math.min(1, usage.used / usage.limit) : 0;
}

export function knoxGuiContextLevel(ratio: number): KnoxContextLevel {
	return ratio >= KNOX_CONTEXT_HIGH_RATIO ? 'high' : ratio >= KNOX_CONTEXT_WARN_RATIO ? 'warn' : 'ok';
}

export function knoxGuiFormatTokens(count: number): string {
	if (count >= 1_000_000) {
		return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
	}
	if (count >= 1000) {
		return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
	}
	return String(count);
}
