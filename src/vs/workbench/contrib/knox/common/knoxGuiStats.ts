/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxGuiDailyTokenStats, IKnoxGuiModelTokenStats } from './knoxGuiState.js';

/** KN-372: Core `stats/getTokensPerDay` / `stats/getTokensPerModel` rows. */

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function unwrapRows(raw: unknown): unknown[] {
	if (Array.isArray(raw)) {
		return raw;
	}
	const rec = asRecord(raw);
	if (Array.isArray(rec?.content)) {
		return rec.content;
	}
	return [];
}

function parseTokenCount(value: unknown): number {
	if (typeof value === 'bigint') {
		return Number(value);
	}
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n : 0;
}

function parseTokenFields(rec: Record<string, unknown>): { promptTokens: number; generatedTokens: number } {
	return {
		promptTokens: parseTokenCount(rec.promptTokens ?? rec.prompt_tokens ?? rec.tokens_prompt),
		generatedTokens: parseTokenCount(rec.generatedTokens ?? rec.generated_tokens ?? rec.tokens_generated),
	};
}

export function parseTokensPerDay(raw: unknown): IKnoxGuiDailyTokenStats[] {
	const rows: IKnoxGuiDailyTokenStats[] = [];
	for (const item of unwrapRows(raw)) {
		const rec = asRecord(item);
		if (!rec) {
			continue;
		}
		const day = rec.day ?? rec.date;
		if (typeof day !== 'string' || !day) {
			continue;
		}
		rows.push({ day, ...parseTokenFields(rec) });
	}
	return rows;
}

export function parseTokensPerModel(raw: unknown): IKnoxGuiModelTokenStats[] {
	const rows: IKnoxGuiModelTokenStats[] = [];
	for (const item of unwrapRows(raw)) {
		const rec = asRecord(item);
		if (!rec) {
			continue;
		}
		const model = rec.model ?? rec.name;
		if (typeof model !== 'string' || !model) {
			continue;
		}
		rows.push({ model, ...parseTokenFields(rec) });
	}
	return rows;
}

/** TSV for the copy button — same column order as the stats page. */
export function formatStatsCopyTable(headers: string[], rows: Array<Array<string | number>>): string {
	return [headers, ...rows].map(row => row.map(cell => String(cell)).join('\t')).join('\n');
}
