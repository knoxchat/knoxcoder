/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiController } from '../../knoxGuiController.js';
import { asRecord, asArray } from './helpers.js';
import { memoryConfigUpdatePayload, isMemoryTabId, parseEbbinghausStats, parseEffectiveContext, parseExploreResult, parseGraphEntities, parseGraphStats, parseMemoryDashboard, parseMemoryItem, parseMemorySession, parseMetricsTrend, parsePhaseStatus, parseReviewDue, parseSessionHistory, unwrapBrainConfig } from '../../../common/knoxGuiMemory.js';

export async function loadMemory(controller: KnoxGuiController): Promise<void> { // KN-376
	controller.store.patch({ memoryBusy: true });
	try {
		await Promise.all([
			controller.loadMemoryOverview(),
			controller.loadMemories(false),
			controller.loadMemorySessions(),
			controller.loadMemoryGraph(false),
			controller.loadMemoryConfig(),
		]);
	} catch {
		// memory optional until core is ready
	} finally {
		controller.store.patch({ memoryBusy: false });
	}
}

export async function hydrateMemoryTab(controller: KnoxGuiController): Promise<void> { // KN-376
	try {
		const ui = await controller.messenger.request<Record<string, unknown>>('getMemoryViewUiState', undefined);
		const tab = String(asRecord(ui)?.activeTabId ?? asRecord(ui)?.tab ?? '');
		if (isMemoryTabId(tab)) {
			controller.store.patch({ memoryTab: tab });
		}
	} catch {
		// optional
	}
}

export async function loadMemoryOverview(controller: KnoxGuiController): Promise<void> { // KN-376 KN-310–313
	try {
		const [dash, effective, trend, phase, review, ebb] = await Promise.all([
			controller.messenger.request<Record<string, unknown>>('brain/dashboard', undefined).catch(() => undefined),
			controller.messenger.request<Record<string, unknown>>('brain/getEffectiveContext', undefined).catch(() => undefined),
			controller.messenger.request<Record<string, unknown>>('brain/getMetricsTrend', { hours: 24 }).catch(() => undefined),
			controller.messenger.request<Record<string, unknown>>('brain/getPhaseStatus', undefined).catch(() => undefined),
			controller.messenger.request<Record<string, unknown>>('brain/getReviewDue', { limit: 8 }).catch(() => undefined),
			controller.messenger.request<Record<string, unknown>>('brain/getEbbinghausStats', undefined).catch(() => undefined),
		]);
		controller.store.patch({
			memoryDashboard: parseMemoryDashboard(dash),
			memoryEffectiveContext: parseEffectiveContext(effective),
			memoryMetricsTrend: parseMetricsTrend(trend),
			memoryPhaseStatus: parsePhaseStatus(phase) ?? parsePhaseStatus(dash),
			memoryReviewDue: parseReviewDue(review),
			memoryEbbinghausStats: parseEbbinghausStats(ebb),
		});
	} catch {
		// optional
	}
}

export async function loadMemories(controller: KnoxGuiController, append = false): Promise<void> { // KN-376 KN-311
	try {
		const state = controller.store.state;
		const query = state.memoryQuery.trim();
		const limit = 50;
		const currentOffset = append ? state.memories.length : 0;
		const search = await controller.messenger.request<Record<string, unknown>>('brain/searchMemories', {
			query: query || undefined,
			category: state.memoryFilterCategory !== 'all' ? state.memoryFilterCategory : undefined,
			tier: state.memoryFilterTier !== 'all' ? state.memoryFilterTier : undefined,
			pinned: state.memoryFilterPinned === 'all' ? undefined : state.memoryFilterPinned === 'pinned',
			limit: query ? currentOffset + limit + 1 : limit + 1,
			offset: query ? 0 : currentOffset,
		});
		const rec = asRecord(search);
		const next = asArray(rec?.memories ?? search).map(parseMemoryItem).filter((item): item is NonNullable<typeof item> => Boolean(item));
		if (query) {
			const pageItems = next.slice(currentOffset, currentOffset + limit);
			controller.store.patch({
				memories: append ? [...state.memories, ...pageItems.filter(item => !state.memories.some(existing => existing.id === item.id))] : pageItems,
				memoryHasMore: next.length > currentOffset + limit,
			});
			return;
		}
		const hasMore = next.length > limit;
		const pageItems = next.slice(0, limit);
		const total = Number(rec?.total ?? (hasMore ? currentOffset + next.length : currentOffset + pageItems.length));
		controller.store.patch({
			memories: append ? [...state.memories, ...pageItems.filter(item => !state.memories.some(existing => existing.id === item.id))] : pageItems,
			memoryHasMore: rec?.total != null ? currentOffset + pageItems.length < total : hasMore,
		});
	} catch {
		// optional
	}
}

export async function loadMemorySessions(controller: KnoxGuiController): Promise<void> { // KN-376 KN-315
	try {
		const result = await controller.messenger.request<Record<string, unknown>>('brain/listSessions', { limit: 100 });
		controller.store.patch({
			memorySessions: asArray(asRecord(result)?.sessions ?? result).map(parseMemorySession).filter((session): session is NonNullable<typeof session> => Boolean(session)),
		});
	} catch {
		// optional
	}
}

export async function loadMemorySessionHistory(controller: KnoxGuiController, sessionId: string): Promise<void> {
	controller.store.patch({ memorySelectedSessionId: sessionId });
	try {
		const result = await controller.messenger.request<Record<string, unknown>>('brain/getSessionHistory', {
			sessionId,
			episodicLimit: 200,
			semanticLimit: 100,
		});
		controller.store.patch({ memorySessionHistory: parseSessionHistory(result, sessionId) });
	} catch {
		controller.store.patch({ memorySessionHistory: undefined });
	}
}

export async function searchMemoryBacklogs(controller: KnoxGuiController, query: string): Promise<void> {
	controller.store.patch({ memorySessionQuery: query });
	if (query.trim().length < 2) {
		controller.store.patch({ memoryBacklogMatches: [] });
		return;
	}
	try {
		const result = await controller.messenger.request<Record<string, unknown>>('brain/searchBacklogs', {
			query: query.trim(),
			limit: 30,
		});
		const inner = asRecord(asRecord(result)?.result) ?? asRecord(result);
		const episodic = asArray(inner?.episodic).map(item => {
			const rec = asRecord(item) ?? {};
			return {
				id: String(rec.id ?? ''),
				kind: 'episodic' as const,
				content: String(rec.content ?? ''),
				sessionId: rec.session_id ? String(rec.session_id): undefined,
				role: rec.role ? String(rec.role): undefined,
			};
		});
		const semantic = asArray(inner?.semantic).map(item => {
			const rec = asRecord(item) ?? {};
			return {
				id: String(rec.id ?? ''),
				kind: 'semantic' as const,
				title: rec.title ? String(rec.title): undefined,
				content: String(rec.content ?? ''),
				sessionId: rec.source_session_id ? String(rec.source_session_id): undefined,
				category: rec.category ? String(rec.category): undefined,
			};
		});
		controller.store.patch({ memoryBacklogMatches: [...semantic, ...episodic] });
	} catch {
		controller.store.patch({ memoryBacklogMatches: [] });
	}
}

export async function loadMemoryGraph(controller: KnoxGuiController, append = false): Promise<void> { // KN-376 KN-311
	try {
		const state = controller.store.state;
		const [statsRaw, list] = await Promise.all([
			controller.messenger.request<Record<string, unknown>>('brain/graphStats', undefined).catch(() => undefined),
			controller.messenger.request<Record<string, unknown>>('brain/listEntities', {
				query: state.memoryGraphQuery.trim() || undefined,
				entity_type: state.memoryGraphFilterType === 'all' ? undefined : state.memoryGraphFilterType,
				limit: 50,
				offset: append ? state.memoryGraphEntities.length : 0,
			}).catch(async () => controller.messenger.request<Record<string, unknown>>('brain/searchEntities', {
				query: state.memoryGraphQuery,
				limit: 50,
			})),
		]);
		const rec = asRecord(list);
		const entities = parseGraphEntities(rec?.entities ?? list);
		const total = Number(rec?.total ?? entities.length);
		const existing = append ? state.memoryGraphEntities : [];
		const merged = [...existing];
		for (const entity of entities) {
			if (!merged.some(item => item.id === entity.id)) {
				merged.push(entity);
			}
		}
		controller.store.patch({
			memoryGraphEntities: merged,
			memoryGraphStats: parseGraphStats(statsRaw),
			memoryGraphTotal: total,
			memoryGraphHasMore: merged.length < total,
			memoryDashboard: state.memoryDashboard ? {
				...state.memoryDashboard,
				totalEntities: Number(statsRaw?.total_entities ?? state.memoryDashboard.totalEntities),
				totalEdges: Number(statsRaw?.total_edges ?? state.memoryDashboard.totalEdges),
			} : state.memoryDashboard,
		});
	} catch {
		// graph optional
	}
}

export async function exploreMemoryEntity(controller: KnoxGuiController, entityId: number): Promise<void> {
	try {
		const depth = controller.store.state.memoryGraphStats?.maxDepth ?? 3;
		const result = await controller.messenger.request<Record<string, unknown>>('brain/exploreGraph', { entity_id: entityId, depth });
		const explore = parseExploreResult(result);
		controller.store.patch({
			memoryExplore: explore,
			memoryGraphEdges: explore?.edges ?? [],
		});
	} catch {
		controller.store.patch({ memoryExplore: undefined });
	}
}

export async function loadMemoryConfig(controller: KnoxGuiController): Promise<void> { // KN-376 KN-314
	try {
		const config = await controller.messenger.request<Record<string, unknown>>('brain/getConfig', undefined);
		controller.store.patch({ memoryConfig: unwrapBrainConfig(config) });
	} catch {
		// optional
	}
}

export function updateMemoryConfig(controller: KnoxGuiController, key: string, value: unknown): void {
	controller.store.patch({ memoryConfig: { ...controller.store.state.memoryConfig, [key]: value } });
	void controller.messenger.request('brain/updateConfig', memoryConfigUpdatePayload(key, value));
}

export async function consolidateMemory(controller: KnoxGuiController): Promise<void> {
	controller.store.patch({ memoryBusy: true, memoryActionMessage: undefined });
	try {
		await controller.messenger.request('brain/consolidate', undefined);
		controller.store.patch({ memoryActionMessage: 'memoryConsolidateResult' });
		await controller.loadMemoryOverview();
	} catch {
		controller.store.patch({ memoryActionMessage: 'memoryActionFailed' });
	} finally {
		controller.store.patch({ memoryBusy: false });
	}
}

export async function deleteMemories(controller: KnoxGuiController, ids: string[]): Promise<void> {
	const numeric = ids.map(id => Number(id)).filter(id => !Number.isNaN(id));
	if (numeric.length === 1) {
		await controller.messenger.request('brain/deleteMemory', { id: numeric[0] });
	} else if (numeric.length) {
		await controller.messenger.request('brain/deleteMemories', { ids: numeric });
	}
	controller.store.patch({ memories: controller.store.state.memories.filter(memory => !ids.includes(memory.id)) });
}

export async function pinMemories(controller: KnoxGuiController, ids: string[], pinned: boolean): Promise<void> {
	const numeric = ids.map(id => Number(id)).filter(id => !Number.isNaN(id));
	if (numeric.length === 1) {
		await controller.messenger.request(pinned ? 'brain/pinMemory' : 'brain/unpinMemory', { id: numeric[0] });
	} else if (numeric.length) {
		await controller.messenger.request(pinned ? 'brain/pinMemories' : 'brain/unpinMemories', { ids: numeric });
	}
	controller.store.patch({
		memories: controller.store.state.memories.map(memory => ids.includes(memory.id) ? { ...memory, pinned } : memory),
	});
}

export type KnoxMemoryMaintenanceAction = 'optimize' | 'heal' | 'purge';

export async function runMemoryMaintenance(controller: KnoxGuiController, action: KnoxMemoryMaintenanceAction): Promise<void> { // KN-376 KN-314
	controller.store.patch({ memoryBusy: true, memoryActionMessage: undefined });
	try {
		if (action === 'optimize') {
			await controller.messenger.request('brain/optimize', undefined);
		} else if (action === 'heal') {
			await controller.messenger.request('brain/heal', undefined);
		} else {
			await controller.messenger.request('brain/heal', { action: 'prune_expired' });
		}
		controller.store.patch({ memoryActionMessage: 'memoryActionSuccess' });
		await controller.loadMemoryOverview();
		if (action === 'purge') {
			await controller.loadMemories(false);
		}
	} catch {
		controller.store.patch({ memoryActionMessage: 'memoryActionFailed' });
	} finally {
		controller.store.patch({ memoryBusy: false });
	}
}

export async function exportMemory(controller: KnoxGuiController, password?: string): Promise<void> { // KN-376 KN-314
	controller.store.patch({ memoryBusy: true, memoryActionMessage: undefined });
	try {
		const result = await controller.messenger.request<Record<string, unknown>>('brain/export', {
			password: password?.trim() || undefined,
		});
		const rec = asRecord(result) ?? {};
		const data = rec.data != null ? String(rec.data) : '';
		if (data) {
			controller.messenger.post('copyText', { text: data });
		}
		controller.store.patch({ memoryActionMessage: rec.encrypted ? 'memoryExportSuccess' : 'memoryExportCopied' });
	} catch {
		controller.store.patch({ memoryActionMessage: 'memoryActionFailed' });
	} finally {
		controller.store.patch({ memoryBusy: false });
	}
}

export async function importMemoryData(controller: KnoxGuiController, data: string, password?: string): Promise<void> { // KN-376 KN-314
	controller.store.patch({ memoryBusy: true, memoryActionMessage: undefined });
	try {
		await controller.messenger.request('brain/import', {
			data,
			password: password?.trim() || undefined,
		});
		controller.store.patch({ memoryActionMessage: 'memoryActionSuccess' });
		await controller.loadMemory();
	} catch {
		controller.store.patch({ memoryActionMessage: 'memoryActionFailed' });
	} finally {
		controller.store.patch({ memoryBusy: false });
	}
}
