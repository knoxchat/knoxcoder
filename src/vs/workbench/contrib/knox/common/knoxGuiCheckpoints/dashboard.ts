/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { arr, rec } from './parse.js';

/** Performance dashboard charts and host-payload parsing. */

export const CHECKPOINT_CHART_MIN_DAYS = 14;
/** KN-375: match PerformanceDashboard + KN-327 engine default. */
export const CHECKPOINT_DASHBOARD_HISTORY_DAYS = 30;

export function utcDayKey(iso: string): string {
	const parsed = Date.parse(iso);
	if (!Number.isFinite(parsed)) {
		return iso.slice(0, 10);
	}
	return new Date(parsed).toISOString().slice(0, 10);
}

export function formatChartTick(isoDay: string): string {
	const [, month, day] = isoDay.split('-');
	return month && day ? `${Number(month)}/${Number(day)}` : isoDay;
}

/** `PerformanceDashboard.tsx` `formatDuration`. */
export function formatCheckpointDuration(ms: number): string {
	return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** `PerformanceDashboard.tsx` `formatBytes` (trailing `.0` dropped). */
export function formatDashboardBytes(bytes: number): string {
	if (!bytes) {
		return '0 B';
	}
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.min(sizes.length - 1, Math.max(0, Math.floor(Math.log(bytes) / Math.log(1024))));
	return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(1))} ${sizes[i]}`;
}

/** Recharts `interval` for the day axis: every label up to 8 days, then about 7 labels. */
export function checkpointChartTickInterval(length: number): number {
	return length <= 8 ? 0 : Math.max(0, Math.ceil(length / 7) - 1);
}

/** Recharts `getNiceTickValues([0, max], tickCount, false)` for a `[0, 'auto']` YAxis with `allowDecimals={false}`: always `tickCount` integer ticks. */
export function checkpointChartYTicks(max: number, tickCount = 5): number[] {
	const count = Math.max(tickCount, 2);
	if (!(max > 0)) {
		return Array.from({ length: count }, (_, i) => i);
	}
	const precise = (value: number) => Number(value.toPrecision(12));
	for (let correction = 0; ; correction++) {
		const rough = max / (count - 1);
		const digits = Math.floor(Math.log10(rough)) + 1;
		const unit = Math.pow(10, digits);
		const scale = digits !== 1 ? 0.05 : 0.1;
		const step = Math.ceil(precise((Math.ceil(precise(rough / unit / scale)) + correction) * scale * unit));
		if (Math.ceil(precise(max / step)) + 1 <= count) {
			return Array.from({ length: count }, (_, i) => i * step);
		}
	}
}

export function compactAxisNumber(value: number): string {
	if (Math.abs(value) >= 1_000_000) {
		const millions = value / 1_000_000;
		return `${millions >= 10 || millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)}M`;
	}
	if (Math.abs(value) >= 1_000) {
		const thousands = value / 1_000;
		return `${thousands >= 10 || thousands % 1 === 0 ? thousands.toFixed(0) : thousands.toFixed(1)}k`;
	}
	return String(Math.round(value));
}

export function fillDailyCounts(
	points: Array<{ bucket: string; count: number }>,
	minDays = CHECKPOINT_CHART_MIN_DAYS,
): Array<{ date: string; count: number; iso: string }> {
	const byDay = new Map<string, number>();
	for (const point of points) {
		const key = utcDayKey(point.bucket);
		byDay.set(key, (byDay.get(key) ?? 0) + point.count);
	}
	const keys = [...byDay.keys()].sort();
	const end = keys.length > 0
		? new Date(`${keys[keys.length - 1]}T00:00:00.000Z`)
		: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
	const paddedStart = new Date(end);
	paddedStart.setUTCDate(paddedStart.getUTCDate() - (Math.max(minDays, 1) - 1));
	const dataStart = keys.length > 0 ? new Date(`${keys[0]}T00:00:00.000Z`) : paddedStart;
	const start = dataStart < paddedStart ? dataStart : paddedStart;
	const maxSpanMs = 30 * 24 * 60 * 60 * 1000;
	const clampedStart = end.getTime() - start.getTime() > maxSpanMs
		? new Date(end.getTime() - maxSpanMs)
		: start;
	const rows: Array<{ date: string; count: number; iso: string }> = [];
	for (let cursor = new Date(clampedStart); cursor.getTime() <= end.getTime(); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
		const iso = cursor.toISOString().slice(0, 10);
		rows.push({ iso, date: formatChartTick(iso), count: byDay.get(iso) ?? 0 });
	}
	return rows;
}

export function fillDailyCarryForward(
	points: Array<{ bucket: string; value: number }>,
	minDays = CHECKPOINT_CHART_MIN_DAYS,
): Array<{ date: string; value: number; iso: string }> {
	const byDay = new Map<string, number>();
	for (const point of [...points].sort((a, b) => a.bucket.localeCompare(b.bucket))) {
		byDay.set(utcDayKey(point.bucket), point.value);
	}
	const skeleton = fillDailyCounts([...byDay.entries()].map(([bucket, count]) => ({ bucket, count })), minDays);
	let last = 0;
	return skeleton.map(row => {
		if (byDay.has(row.iso)) {
			last = byDay.get(row.iso) ?? last;
		}
		return { date: row.date, iso: row.iso, value: last };
	});
}

/** MC-71: undefined when the host sent none (older host), so the Dashboard hides the section. */
export function parseRecipeMetrics(value: unknown): { attempts: number; applied: number; failedVerify: number; reverted: number; llmCallsAvoided: number; tokensSaved: number; wrongApplyRate: number } | undefined {
	const row = rec(value);
	if (!row) {
		return undefined;
	}
	const count = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
	return {
		attempts: count(row.attempts),
		applied: count(row.applied),
		failedVerify: count(row.failedVerify),
		reverted: count(row.reverted),
		llmCallsAvoided: count(row.llmCallsAvoided),
		tokensSaved: count(row.tokensSaved),
		wrongApplyRate: Math.min(1, count(row.wrongApplyRate)),
	};
}

export function parsePerformanceDashboard(value: unknown): {
	currentStorage?: { totalBytes: number; checkpointCount: number; blobCount?: number };
	storageHistory: Array<{ timestamp: string; totalBytes: number; checkpointCount: number }>;
	creationFrequency: Array<{ bucket: string; count: number }>;
	restorationEvents: Array<{ timestamp: string; checkpointId: string; success: boolean; durationMs: number; filesRestored: number; filesFailed: number; error?: string }>;
	aiSessionMetrics: Array<{ sessionId: string; startedAt: string; filesChanged: number; linesAdded?: number; linesDeleted?: number; checkpointsCreated: number; rollbacks?: number; durationSeconds: number }>;
	recipeMetrics?: { attempts: number; applied: number; failedVerify: number; reverted: number; llmCallsAvoided: number; tokensSaved: number; wrongApplyRate: number };
	summary: {
		totalCheckpointsCreated: number;
		totalRestorations: number;
		restorationSuccessRate: number;
		avgCreationTimeMs: number;
		totalAiSessions: number;
		avgChangesPerSession: number;
		totalRollbacks: number;
	};
} | undefined {
	const root = rec(value);
	const data = rec(root?.data) ?? root;
	if (!data) {
		return undefined;
	}
	const summary = rec(data.summary) ?? {};
	const storage = rec(data.currentStorage);
	return {
		currentStorage: storage ? {
			totalBytes: Number(storage.totalBytes ?? 0),
			checkpointCount: Number(storage.checkpointCount ?? 0),
			blobCount: storage.blobCount !== undefined ? Number(storage.blobCount) : undefined,
		} : undefined,
		storageHistory: arr(data.storageHistory).map(item => {
			const row = rec(item) ?? {};
			return { timestamp: String(row.timestamp ?? ''), totalBytes: Number(row.totalBytes ?? 0), checkpointCount: Number(row.checkpointCount ?? 0) };
		}),
		creationFrequency: arr(data.creationFrequency).map(item => {
			const row = rec(item) ?? {};
			return { bucket: String(row.bucket ?? ''), count: Number(row.count ?? 0) };
		}),
		restorationEvents: arr(data.restorationEvents).map(item => {
			const row = rec(item) ?? {};
			return {
				timestamp: String(row.timestamp ?? ''),
				checkpointId: String(row.checkpointId ?? ''),
				success: Boolean(row.success),
				durationMs: Number(row.durationMs ?? 0),
				filesRestored: Number(row.filesRestored ?? 0),
				filesFailed: Number(row.filesFailed ?? 0),
				error: row.error ? String(row.error) : undefined,
			};
		}),
		aiSessionMetrics: arr(data.aiSessionMetrics).map(item => {
			const row = rec(item) ?? {};
			return {
				sessionId: String(row.sessionId ?? ''),
				startedAt: String(row.startedAt ?? ''),
				filesChanged: Number(row.filesChanged ?? 0),
				linesAdded: typeof row.linesAdded === 'number' ? row.linesAdded : undefined,
				linesDeleted: typeof row.linesDeleted === 'number' ? row.linesDeleted : undefined,
				checkpointsCreated: Number(row.checkpointsCreated ?? 0),
				rollbacks: row.rollbacks !== undefined ? Number(row.rollbacks) : undefined,
				durationSeconds: Number(row.durationSeconds ?? 0),
			};
		}),
		recipeMetrics: parseRecipeMetrics(data.recipeMetrics),
		summary: {
			totalCheckpointsCreated: Number(summary.totalCheckpointsCreated ?? 0),
			totalRestorations: Number(summary.totalRestorations ?? 0),
			restorationSuccessRate: Number(summary.restorationSuccessRate ?? 0),
			avgCreationTimeMs: Number(summary.avgCreationTimeMs ?? 0),
			totalAiSessions: Number(summary.totalAiSessions ?? 0),
			avgChangesPerSession: Number(summary.avgChangesPerSession ?? 0),
			totalRollbacks: Number(summary.totalRollbacks ?? 0),
		},
	};
}
