/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiController } from '../../knoxGuiController.js';
import type { IKnoxGuiState } from '../../../common/knoxGuiState.js';
import { asRecord, asArray } from './helpers.js';
import { knoxGuiT } from '../knoxGuiI18n.js';
import { memoryConfigUpdatePayload, isMemoryTabId, parseEbbinghausStats, parseEffectiveContext, parseExploreResult, parseGraphEntities, parseGraphStats, parseMemoryDashboard, parseMemoryItem, parseMemorySession, parseMetricsTrend, parsePhaseStatus, parseReviewDue, parseSessionHistory, unwrapBrainConfig, withMemoryConfigDefaults, memoryConsolidateParts } from '../../../common/knoxGuiMemory.js';

const MEMORY_PAGE_SIZE = 50;

export async function loadMemory(controller: KnoxGuiController): Promise<void> { // KN-376
	controller.store.patch({ memoryBusy: true });
	try {
		await Promise.all([
			controller.loadMemoryOverview({ showLoading: true }),
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

/** `useMemoryRefresh` hooks: a live update reloads only the visible tab and never raises `memoryBusy`. */
export function refreshMemoryActiveTab(controller: KnoxGuiController): void {
	const state = controller.store.state;
	switch (state.memoryTab) {
		case 'overview':
			void controller.loadMemoryOverview();
			return;
		case 'memories':
			if (state.memoryBusy || state.memoryBrowserBusy || controller.memoryRefreshBlocked() || state.memories.length > MEMORY_PAGE_SIZE) {
				return;
			}
			void controller.loadMemories(false);
			return;
		case 'sessions':
			void controller.loadMemorySessions();
			return;
		case 'graph':
			void controller.loadMemoryGraph(false);
			return;
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
	} finally {
		controller.store.patch({ memoryTabHydrated: true });
	}
}

export async function loadMemoryOverview(controller: KnoxGuiController, options?: { showLoading?: boolean }): Promise<void> { // KN-376 KN-310–313
	if (options?.showLoading) {
		controller.store.patch({ memoryOverviewLoading: true });
	}
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
	} finally {
		if (options?.showLoading) {
			controller.store.patch({ memoryOverviewLoading: false });
		}
	}
}

export async function loadMemories(controller: KnoxGuiController, append = false): Promise<void> { // KN-376 KN-311
	controller.store.patch(append ? { memoriesLoadingMore: true, memoryBrowserError: undefined } : { memoriesLoading: true, memoryBrowserError: undefined });
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
		showMemoryBanner(controller, 'error', { key: 'memoryLoadError' });
	} finally {
		controller.store.patch({ memoriesLoading: false, memoriesLoadingMore: false });
	}
}

export async function loadMemorySessions(controller: KnoxGuiController): Promise<void> { // KN-376 KN-315
	controller.store.patch({ memorySessionsLoading: true, memorySessionError: undefined });
	try {
		const result = await controller.messenger.request<Record<string, unknown>>('brain/listSessions', { limit: 100 });
		controller.store.patch({
			memorySessions: asArray(asRecord(result)?.sessions ?? result).map(parseMemorySession).filter((session): session is NonNullable<typeof session> => Boolean(session)),
		});
	} catch {
		controller.store.patch({ memorySessionError: 'memorySessionHistoryLoadError' });
	} finally {
		controller.store.patch({ memorySessionsLoading: false });
	}
}

export async function loadMemorySessionHistory(controller: KnoxGuiController, sessionId: string): Promise<void> {
	controller.store.patch({ memorySelectedSessionId: sessionId, memorySessionHistoryLoading: true, memorySessionError: undefined });
	try {
		const result = await controller.messenger.request<Record<string, unknown>>('brain/getSessionHistory', {
			sessionId,
			episodicLimit: 200,
			semanticLimit: 100,
		});
		if (controller.store.state.memorySelectedSessionId === sessionId) {
			controller.store.patch({ memorySessionHistory: parseSessionHistory(result, sessionId) });
		}
	} catch {
		controller.store.patch({ memorySessionError: 'memorySessionHistoryLoadError' });
	} finally {
		if (controller.store.state.memorySelectedSessionId === sessionId) {
			controller.store.patch({ memorySessionHistoryLoading: false });
		}
	}
}

export async function searchMemoryBacklogs(controller: KnoxGuiController, query: string): Promise<void> {
	controller.store.patch({ memorySessionQuery: query });
	if (query.trim().length < 2) {
		controller.store.patch({ memoryBacklogMatches: [], memoryBacklogSearching: false });
		return;
	}
	controller.store.patch({ memoryBacklogSearching: true });
	try {
		const result = await controller.messenger.request<Record<string, unknown>>('brain/searchBacklogs', {
			query: query.trim(),
			limit: 30,
			workspace_dir: controller.workspaceDirectory || await controller.resolveWorkspaceDirectory(),
		});
		const inner = asRecord(asRecord(result)?.result) ?? asRecord(result);
		const episodic = asArray(inner?.episodic).map(item => {
			const rec = asRecord(item) ?? {};
			return {
				id: String(rec.id ?? ''),
				kind: 'episodic' as const,
				content: String(rec.content ?? ''),
				sessionId: rec.session_id ? String(rec.session_id) : undefined,
				role: rec.role ? String(rec.role) : undefined,
			};
		});
		const semantic = asArray(inner?.semantic).map(item => {
			const rec = asRecord(item) ?? {};
			return {
				id: String(rec.id ?? ''),
				kind: 'semantic' as const,
				title: rec.title ? String(rec.title) : undefined,
				content: String(rec.content ?? ''),
				sessionId: rec.source_session_id ? String(rec.source_session_id) : undefined,
				category: rec.category ? String(rec.category) : undefined,
			};
		});
		if (controller.store.state.memorySessionQuery === query) {
			controller.store.patch({ memoryBacklogMatches: [...semantic, ...episodic] });
		}
	} catch {
		controller.store.patch({ memoryBacklogMatches: [] });
	} finally {
		if (controller.store.state.memorySessionQuery === query) {
			controller.store.patch({ memoryBacklogSearching: false });
		}
	}
}

export async function loadMemoryGraph(controller: KnoxGuiController, append = false): Promise<void> { // KN-376 KN-311
	const seq = append ? controller.memoryGraphSeq : ++controller.memoryGraphSeq;
	controller.store.patch(append ? { memoryGraphLoadingMore: true } : { memoryGraphLoading: true, memoryGraphError: undefined });
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
		if (seq !== controller.memoryGraphSeq) {
			return;
		}
		const rec = asRecord(list);
		const entities = parseGraphEntities(rec?.entities ?? list);
		const total = Number(rec?.total ?? entities.length);
		const existing = append ? controller.store.state.memoryGraphEntities : [];
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
	} catch (error) {
		if (!append && seq === controller.memoryGraphSeq) {
			controller.store.patch({ memoryGraphError: error instanceof Error && error.message ? error.message : String(error) });
		}
	} finally {
		if (append) {
			controller.store.patch({ memoryGraphLoadingMore: false });
		} else if (seq === controller.memoryGraphSeq) {
			controller.store.patch({ memoryGraphLoading: false });
		}
	}
}

/** A failed explore keeps the previous result, as `KnowledgeGraphView.tsx` does. */
export async function exploreMemoryEntity(controller: KnoxGuiController, entityId: number): Promise<void> {
	try {
		const depth = controller.store.state.memoryGraphStats?.maxDepth ?? 3;
		const result = await controller.messenger.request<Record<string, unknown>>('brain/exploreGraph', { entity_id: entityId, depth });
		const explore = parseExploreResult(result);
		if (explore) {
			controller.store.patch({ memoryExplore: explore, memoryGraphEdges: explore.edges });
		}
	} catch {
		// keep the previous explore result
	}
}

export async function loadMemoryConfig(controller: KnoxGuiController): Promise<void> { // KN-376 KN-314
	controller.store.patch({ memoryConfigLoading: true });
	try {
		const config = await controller.messenger.request<Record<string, unknown>>('brain/getConfig', undefined);
		controller.store.patch({ memoryConfig: withMemoryConfigDefaults(unwrapBrainConfig(config)) });
	} catch {
		// optional
	} finally {
		controller.store.patch({ memoryConfigLoading: false });
	}
}

/** `MemorySettings.tsx` `saveConfig`: the saved checkmark shows for 2 s after the host accepts the write. */
export function updateMemoryConfig(controller: KnoxGuiController, key: string, value: unknown): void {
	controller.store.patch({ memoryConfig: { ...controller.store.state.memoryConfig, [key]: value } });
	void controller.messenger.request('brain/updateConfig', memoryConfigUpdatePayload(key, value)).then(() => {
		controller.store.patch({ memorySavedKey: key });
		setTimeout(() => {
			if (controller.store.state.memorySavedKey === key) {
				controller.store.patch({ memorySavedKey: undefined });
			}
		}, 2000);
	}, () => { /* optional */ });
}

export async function consolidateMemory(controller: KnoxGuiController): Promise<void> {
	if (controller.store.state.memoryConsolidating) {
		return;
	}
	controller.store.patch({ memoryConsolidating: true, memoryActionMessage: undefined });
	try {
		await controller.messenger.request('brain/consolidate', undefined);
		controller.store.patch({ memoryActionMessage: 'memoryConsolidateResult' });
		await controller.loadMemoryOverview({ showLoading: true });
	} catch {
		controller.store.patch({ memoryActionMessage: 'memoryActionFailed' });
	} finally {
		controller.store.patch({ memoryConsolidating: false });
	}
}

type MemoryBanner = NonNullable<IKnoxGuiState['memoryBrowserError']>;

/** `MemoryBrowser.tsx` `showError` / `showNotice`: errors clear after 5 s, notices after 4 s. */
export function showMemoryBanner(controller: KnoxGuiController, kind: 'error' | 'notice', banner: MemoryBanner | undefined): void {
	const key = kind === 'error' ? 'memoryBrowserError' : 'memoryBrowserNotice';
	controller.store.patch({ [key]: banner });
	if (banner) {
		setTimeout(() => {
			if (controller.store.state[key] === banner) {
				controller.store.patch({ [key]: undefined });
			}
		}, kind === 'error' ? 5000 : 4000);
	}
}

/** `bulk` uses `brain/deleteMemories` and reports partial failures; a single forget checks `success`. */
export async function deleteMemories(controller: KnoxGuiController, ids: string[], bulk = ids.length > 1): Promise<void> {
	const numeric = ids.map(id => Number(id)).filter(id => !Number.isNaN(id));
	if (!numeric.length) {
		return;
	}
	showMemoryBanner(controller, 'error', undefined);
	controller.store.patch({ memoryBrowserBusy: true });
	try {
		if (!bulk) {
			const result = asRecord(await controller.messenger.request('brain/deleteMemory', { id: numeric[0] }));
			if (!result?.success) {
				showMemoryBanner(controller, 'error', { key: 'memoryDeleteFailed' });
				return;
			}
			controller.store.patch({ memories: controller.store.state.memories.filter(memory => memory.id !== ids[0]) });
			return;
		}
		const result = asRecord(await controller.messenger.request('brain/deleteMemories', { ids: numeric }));
		const deleted = Number(result?.deleted ?? 0);
		const failed = Number(result?.failed ?? Math.max(0, numeric.length - deleted));
		controller.store.patch({ memories: controller.store.state.memories.filter(memory => !ids.includes(memory.id)) });
		if (failed > 0) {
			showMemoryBanner(controller, 'error', { key: 'memoryBulkDeletePartialFail', count: failed });
		}
	} catch {
		showMemoryBanner(controller, 'error', { key: 'memoryDeleteFailed' });
	} finally {
		controller.store.patch({ memoryBrowserBusy: false });
	}
}

export async function pinMemories(controller: KnoxGuiController, ids: string[], pinned: boolean, bulk = ids.length > 1): Promise<void> {
	const numeric = ids.map(id => Number(id)).filter(id => !Number.isNaN(id));
	if (!numeric.length) {
		return;
	}
	const apply = () => controller.store.patch({
		memories: controller.store.state.memories.map(memory => ids.includes(memory.id) ? { ...memory, pinned } : memory),
	});
	showMemoryBanner(controller, 'error', undefined);
	if (bulk) {
		controller.store.patch({ memoryBrowserBusy: true });
	}
	try {
		if (!bulk) {
			const result = asRecord(await controller.messenger.request(pinned ? 'brain/pinMemory' : 'brain/unpinMemory', { id: numeric[0] }));
			if (!result?.success) {
				showMemoryBanner(controller, 'error', { key: 'memoryPinFailed' });
				return;
			}
			apply();
			return;
		}
		const result = asRecord(await controller.messenger.request(pinned ? 'brain/pinMemories' : 'brain/unpinMemories', { ids: numeric }));
		const failed = Number(result?.failed ?? 0);
		apply();
		if (failed > 0) {
			showMemoryBanner(controller, 'error', { key: 'memoryBulkPinPartialFail', count: failed });
		} else {
			showMemoryBanner(controller, 'notice', { key: pinned ? 'memoryBulkPinned' : 'memoryBulkUnpinned' });
		}
	} catch {
		showMemoryBanner(controller, 'error', { key: 'memoryPinFailed' });
	} finally {
		if (bulk) {
			controller.store.patch({ memoryBrowserBusy: false });
		}
	}
}

export type KnoxMemoryMaintenanceAction = 'optimize' | 'consolidate' | 'heal' | 'purge';

type MemorySettingsResult = NonNullable<IKnoxGuiState['memorySettingsResult']>;

/** `MemorySettings.tsx` `actionResult`: auto-dismisses after `ms` unless replaced. */
export function showMemorySettingsResult(controller: KnoxGuiController, result: MemorySettingsResult | undefined, ms = 5000): void {
	controller.store.patch({ memorySettingsResult: result });
	if (result) {
		setTimeout(() => {
			if (controller.store.state.memorySettingsResult === result) {
				controller.store.patch({ memorySettingsResult: undefined });
			}
		}, ms);
	}
}

function memoryT(controller: KnoxGuiController, key: string): string {
	return knoxGuiT(controller.store.state.language, key);
}

/** `MemorySettings.tsx` `runAction`; `healthAction` drives the per-button spinner. */
export async function runMemoryMaintenance(controller: KnoxGuiController, action: KnoxMemoryMaintenanceAction): Promise<void> { // KN-376 KN-314
	if (controller.store.state.memorySettingsAction) {
		return;
	}
	controller.store.patch({ memorySettingsAction: action, memorySettingsResult: undefined });
	try {
		let message: string;
		if (action === 'optimize') {
			const rec = asRecord(await controller.messenger.request('brain/optimize', undefined));
			message = typeof rec?.message === 'string' && rec.message ? rec.message : memoryT(controller, 'memoryActionSuccess');
		} else if (action === 'consolidate') {
			const rec = asRecord(await controller.messenger.request('brain/consolidate', undefined));
			const parts = memoryConsolidateParts(rec?.result);
			message = !parts
				? memoryT(controller, 'memoryActionSuccess')
				: parts.length ? `${memoryT(controller, 'memoryConsolidateResult')}: ${parts.join(', ')}` : memoryT(controller, 'memoryConsolidateNoChanges');
		} else {
			await controller.messenger.request('brain/heal', action === 'purge' ? { action: 'prune_expired' } : undefined);
			message = memoryT(controller, 'memoryActionSuccess');
		}
		showMemorySettingsResult(controller, { type: 'success', message });
		void controller.loadMemoryOverview();
		if (action === 'purge' || action === 'consolidate') {
			void controller.loadMemories(false);
		}
	} catch {
		showMemorySettingsResult(controller, { type: 'error', message: memoryT(controller, 'memoryActionFailed') });
	} finally {
		controller.store.patch({ memorySettingsAction: undefined });
	}
}

/** `handleExport`: copies the payload and reports size, file path and encryption for 8 s. Resolves `true` on success so the password can be cleared. */
export async function exportMemory(controller: KnoxGuiController, password?: string): Promise<boolean> { // KN-376 KN-314
	if (controller.store.state.memorySettingsAction) {
		return false;
	}
	controller.store.patch({ memorySettingsAction: 'export', memorySettingsResult: undefined });
	try {
		const result = await controller.messenger.request<Record<string, unknown>>('brain/export', {
			password: password?.trim() || undefined,
		});
		const rec = asRecord(result) ?? {};
		const data = rec.data != null ? String(rec.data) : '';
		const filePath = rec.filePath != null ? String(rec.filePath) : '';
		controller.messenger.post('copyText', { text: data });
		const sizeKb = (data.length / 1024).toFixed(1);
		const base = filePath
			? `${memoryT(controller, 'memoryExportSuccess')} (${sizeKb} KB) → ${filePath}`
			: `${memoryT(controller, 'memoryExportCopied')} (${sizeKb} KB)`;
		const suffix = memoryT(controller, rec.encrypted ? 'memoryExportEncrypted' : 'memoryExportLocalOnly');
		showMemorySettingsResult(controller, { type: 'success', message: `${base} · ${suffix}` }, 8000);
		return true;
	} catch {
		showMemorySettingsResult(controller, { type: 'error', message: memoryT(controller, 'memoryActionFailed') });
		return false;
	} finally {
		controller.store.patch({ memorySettingsAction: undefined });
	}
}

/** `handleImportFile`: validates the backup version and requires a password for encrypted backups. */
export async function importMemoryData(controller: KnoxGuiController, data: string, password?: string): Promise<boolean> { // KN-376 KN-314
	if (controller.store.state.memorySettingsAction) {
		return false;
	}
	let version: unknown;
	try {
		version = asRecord(JSON.parse(data))?.version;
	} catch {
		version = undefined;
	}
	if (!version) {
		showMemorySettingsResult(controller, { type: 'error', message: memoryT(controller, 'memoryImportInvalidFile') });
		return false;
	}
	if (version === 'knox-brain-encrypted-v1' && !password?.trim()) {
		showMemorySettingsResult(controller, { type: 'error', message: memoryT(controller, 'memoryImportPasswordRequired') });
		return false;
	}
	controller.store.patch({ memorySettingsAction: 'import', memorySettingsResult: undefined });
	try {
		const rec = asRecord(await controller.messenger.request('brain/import', {
			data,
			password: password?.trim() || undefined,
		}));
		const message = typeof rec?.result === 'string' && rec.result ? rec.result : memoryT(controller, 'memoryActionSuccess');
		showMemorySettingsResult(controller, { type: 'success', message }, 8000);
		void controller.loadMemory();
		return true;
	} catch {
		showMemorySettingsResult(controller, { type: 'error', message: memoryT(controller, 'memoryActionFailed') });
		return false;
	} finally {
		controller.store.patch({ memorySettingsAction: undefined });
	}
}
