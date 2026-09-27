/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiController } from '../../knoxGuiController.js';
import { asRecord, asArray } from './helpers.js';
import { CHECKPOINT_ANALYSIS_GROUP_LIMIT, CHECKPOINT_DASHBOARD_HISTORY_DAYS, CHECKPOINT_GRAPH_LIMIT, CHECKPOINT_GRAPH_PAGE_SIZE, CHECKPOINT_LIST_PAGE_SIZE, checkpointConfigHasErrors, DEFAULT_CHECKPOINT_CONFIG, normalizeCheckpointConfig, parseCheckpointAnalysis, parseCheckpointDiff, parseCheckpointGraphUi, parsePerformanceDashboard, parseRestorePreview, parseShareBundles, parseSuggestedCheckpointGroups, validateCheckpointConfig } from '../../../common/knoxGuiCheckpoints.js';
import { IKnoxGuiHistoryItem, IKnoxGuiState, KnoxCheckpointPanelTab } from '../../../common/knoxGuiState.js';

export async function ensureCheckpointForLastAssistant(controller: KnoxGuiController): Promise<void> {
	const history = controller.store.state.history;
	for (let i = history.length - 1; i >= 0; i--) {
		const item = history[i];
		if (item.role === 'assistant') {
			await controller.ensureCheckpoint(item, i);
			return;
		}
	}
}

export async function ensureCheckpoint(controller: KnoxGuiController, item: IKnoxGuiHistoryItem, index: number): Promise<string | undefined> {
	if (item.checkpointId || item.role !== 'assistant' || !item.id) {
		return item.checkpointId;
	}
	try {
		const existing = await controller.messenger.request<{ checkpointId?: string | null }>('getCheckpointForMessage', { messageId: item.id });
		const existingId = existing && typeof existing === 'object' ? existing.checkpointId : undefined;
		if (existingId) {
			controller.patchHistoryItem(item.id, { checkpointId: existingId });
			return existingId;
		}
		const stableId = `assistant-${index}-${item.id}`;
		const byStable = await controller.messenger.request<{ checkpointId?: string | null }>('getCheckpointForStableId', { stableId });
		const stableCheckpointId = byStable && typeof byStable === 'object' ? byStable.checkpointId : undefined;
		if (stableCheckpointId) {
			controller.patchHistoryItem(item.id, { checkpointId: stableCheckpointId });
			return stableCheckpointId;
		}
		const created = await controller.messenger.request<{ checkpointId?: string }>('createCheckpointForMessage', {
			messageId: item.id,
			description: `Assistant response at index ${index}`,
			stableId,
		});
		const createdId = created && typeof created === 'object' ? created.checkpointId : undefined;
		if (createdId) {
			controller.patchHistoryItem(item.id, { checkpointId: createdId });
			return createdId;
		}
	} catch {
		// Host may not have checkpoints initialized.
	}
	return undefined;
}

export function restoreCheckpoint(controller: KnoxGuiController, checkpointId: string, rewindMemory = false): void {
	controller.messenger.post('restoreCheckpoint', { checkpointId, rewindMemory });
}

function parseFileChanges(value: unknown): { added: number; modified: number; deleted: number } {
	const rec = asRecord(value) ?? {};
	return {
		added: Number(rec.added ?? 0) || 0,
		modified: Number(rec.modified ?? 0) || 0,
		deleted: Number(rec.deleted ?? 0) || 0,
	};
}

function parseCheckpointNode(item: unknown): IKnoxGuiState['checkpoints'][number] {
	const rec = asRecord(item) ?? {};
	const conversation = asRecord(rec.conversationContext);
	return {
		id: String(rec.id ?? ''),
		description: String(rec.description ?? ''),
		created: String(rec.created ?? rec.dateCreated ?? ''),
		kind: String(rec.kind ?? rec.type ?? 'auto'),
		branchId: rec.branchId ? String(rec.branchId) : undefined,
		tags: asArray(rec.tags).map(String),
		shortId: String(rec.shortId ?? rec.id ?? '').slice(0, 10),
		pinned: Boolean(rec.pinned),
		changedPaths: asArray(rec.changedPaths).map(String),
		sessionId: rec.sessionId ? String(rec.sessionId) : (conversation?.sessionId ? String(conversation.sessionId) : undefined),
		parents: asArray(rec.parents).map(String),
		fileChanges: parseFileChanges(rec.fileChanges),
	};
}

function parseCheckpointBranch(item: unknown): IKnoxGuiState['checkpointBranches'][number] {
	const rec = asRecord(item) ?? {};
	return {
		id: String(rec.id ?? ''),
		name: String(rec.name ?? ''),
		headCheckpointId: String(rec.headCheckpointId ?? ''),
		isActive: Boolean(rec.isActive),
		color: rec.color ? String(rec.color) : undefined,
	};
}

function graphRequestPayload(controller: KnoxGuiController, limit: number): Record<string, unknown> {
	const ui = controller.store.state.checkpointGraphUi;
	return {
		limit,
		branchIds: ui.activeBranchOnly ? undefined : ui.branchIds,
		activeBranchOnly: ui.activeBranchOnly,
	};
}

export async function loadCheckpoints(controller: KnoxGuiController): Promise<void> {
	try {
		if (!controller.checkpointGraphUiLoaded) {
			try {
				const stored = await controller.messenger.request('getCheckpointGraphUiState', undefined);
				controller.store.patch({ checkpointGraphUi: parseCheckpointGraphUi(stored) });
			} catch {
				// optional persisted graph chrome
			}
			controller.checkpointGraphUiLoaded = true;
		}
		const shell = await controller.messenger.request<Record<string, unknown>>('getCheckpointGraphShell', undefined);
		if (shell) {
			controller.store.patch({
				checkpointShell: { state: String(shell.state ?? 'empty'), checkpointCount: Number(shell.checkpointCount ?? 0) },
				checkpointWorkspaceFolders: asArray(shell.workspaceFolders).map(item => {
					const rec = asRecord(item) ?? {};
					return { path: String(rec.path ?? ''), name: String(rec.name ?? rec.path ?? '') };
				}).filter(folder => folder.path),
				checkpointActiveWorkspace: shell.activeWorkspacePath ? String(shell.activeWorkspacePath) : controller.store.state.checkpointActiveWorkspace,
			});
		}
		const limit = controller.store.state.checkpointGraphLimit || CHECKPOINT_GRAPH_PAGE_SIZE;
		const graph = await controller.messenger.request<Record<string, unknown>>('checkpointGraph', graphRequestPayload(controller, limit));
		const nodes = asArray(graph?.nodes).map(parseCheckpointNode);
		const branches = asArray(graph?.branches).map(parseCheckpointBranch);
		controller.store.patch({
			checkpoints: nodes,
			checkpointBranches: branches,
			checkpointHeadId: graph?.headCheckpointId ? String(graph.headCheckpointId) : branches.find(branch => branch.isActive)?.headCheckpointId,
			checkpointGraphHasMore: graph?.hasMore === true,
			checkpointGraphLimit: limit,
			checkpointGraphLoadMoreError: undefined,
		});
		if (nodes.length) {
			try {
				const tree = await controller.messenger.request<Record<string, unknown>>('checkpointWorkingTree', undefined);
				controller.store.patch({ checkpointWorkingTreePaths: asArray(tree?.paths).map(String) });
			} catch {
				controller.store.patch({ checkpointWorkingTreePaths: [] });
			}
		} else {
			controller.store.patch({ checkpointWorkingTreePaths: [] });
		}
		if (controller.store.state.checkpointView === 'checkpoints') {
			void loadCheckpointList(controller);
		} else if (controller.store.state.checkpointView === 'timeline') {
			void loadCheckpointTimeline(controller);
		}
	} catch {
		// checkpoints optional
	}
}

export function setCheckpointTab(controller: KnoxGuiController, tab: KnoxCheckpointPanelTab): void {
	controller.store.patch({ checkpointView: tab });
	if (tab === 'configuration') {
		void controller.loadCheckpointConfig();
	} else if (tab === 'dashboard') {
		void controller.loadCheckpointDashboard();
	} else if (tab === 'analysis') {
		void loadCheckpointAnalysisGroups(controller);
		void controller.loadCheckpointAnalysis();
	} else if (tab === 'share') {
		void controller.loadShareBundles();
	} else if (tab === 'checkpoints') {
		void loadCheckpointList(controller);
	} else if (tab === 'timeline') {
		void loadCheckpointTimeline(controller);
	}
}

export async function openRestorePreview(controller: KnoxGuiController, checkpointId: string, rewindMemory = false): Promise<void> { // KN-375
	controller.store.patch({
		checkpointDialog: 'restore',
		checkpointRestoreId: checkpointId,
		checkpointRestoreMemory: rewindMemory,
		checkpointRestoreLoading: true,
		checkpointRestoreError: undefined,
		checkpointRestorePreview: undefined,
		checkpointRestoreSelected: [],
		checkpointRestoreShowDiff: false,
		checkpointRestoreDiff: undefined,
	});
	try {
		const result = await controller.messenger.request('previewRestore', { checkpointId });
		const preview = parseRestorePreview(result);
		if (!preview) {
			controller.store.patch({ checkpointRestoreLoading: false, checkpointRestoreError: 'restorePreviewFailed' });
			return;
		}
		controller.store.patch({
			checkpointRestoreLoading: false,
			checkpointRestorePreview: preview,
			checkpointRestoreSelected: [...preview.writePaths],
		});
	} catch {
		controller.store.patch({ checkpointRestoreLoading: false, checkpointRestoreError: 'restorePreviewFailed' });
	}
}

export function closeCheckpointDialog(controller: KnoxGuiController): void {
	controller.store.patch({
		checkpointDialog: null,
		checkpointRestoreLoading: false,
		checkpointCompareLoading: false,
		checkpointComparePickId: undefined,
	});
}

export function toggleRestorePath(controller: KnoxGuiController, relativePath: string, checked: boolean): void {
	const selected = new Set(controller.store.state.checkpointRestoreSelected);
	if (checked) {
		selected.add(relativePath);
	} else {
		selected.delete(relativePath);
	}
	controller.store.patch({ checkpointRestoreSelected: [...selected] });
}

export function toggleRestoreAll(controller: KnoxGuiController, checked: boolean): void {
	const files = controller.store.state.checkpointRestorePreview?.files ?? [];
	controller.store.patch({ checkpointRestoreSelected: checked ? files.map(file => file.relativePath): [] });
}

export async function restoreSelectedFiles(controller: KnoxGuiController): Promise<void> {
	const checkpointId = controller.store.state.checkpointRestoreId;
	const paths = controller.store.state.checkpointRestoreSelected;
	if (!checkpointId || !paths.length) {
		return;
	}
	await controller.messenger.request('restoreCheckpointFiles', { checkpointId, relativePaths: paths });
	controller.closeCheckpointDialog();
	void controller.loadCheckpoints();
}

export async function restoreAllFiles(controller: KnoxGuiController): Promise<void> {
	const checkpointId = controller.store.state.checkpointRestoreId;
	if (!checkpointId) {
		return;
	}
	await controller.messenger.request('restoreCheckpoint', { checkpointId, rewindMemory: controller.store.state.checkpointRestoreMemory });
	controller.closeCheckpointDialog();
	void controller.loadCheckpoints();
}

export async function toggleRestoreDiff(controller: KnoxGuiController): Promise<void> {
	if (controller.store.state.checkpointRestoreShowDiff) {
		controller.store.patch({ checkpointRestoreShowDiff: false });
		return;
	}
	const checkpointId = controller.store.state.checkpointRestoreId;
	if (!checkpointId) {
		return;
	}
	try {
		const result = await controller.messenger.request('computeCheckpointDiff', { checkpointId, compareToWorkspace: true });
		const diff = parseCheckpointDiff(result, 'currentWorkspaceOption');
		controller.store.patch({ checkpointRestoreShowDiff: Boolean(diff), checkpointRestoreDiff: diff, checkpointDiffSelectedFile: diff?.files[0]?.relativePath });
	} catch {
		controller.store.patch({ checkpointRestoreShowDiff: false });
	}
}

export function openCompare(controller: KnoxGuiController, checkpointId: string): void {
	const pick = controller.store.state.checkpointComparePickId;
	if (!pick || pick === checkpointId) {
		controller.store.patch({ checkpointComparePickId: checkpointId });
		return;
	}
	void controller.openCompareDialog(pick, checkpointId);
}

export async function openCompareDialog(controller: KnoxGuiController, leftId: string, rightId: string): Promise<void> {
	const left = findCheckpointNode(controller, leftId);
	const right = findCheckpointNode(controller, rightId);
	controller.store.patch({
		checkpointDialog: 'compare',
		checkpointCompareLeftId: leftId,
		checkpointCompareRightId: rightId,
		checkpointComparePickId: undefined,
		checkpointCompareLoading: true,
		checkpointCompareError: undefined,
		checkpointCompareDiff: undefined,
		checkpointDiffSelectedFile: undefined,
	});
	try {
		const result = await controller.messenger.request('computeCheckpointDiff', { checkpointId: rightId, compareToCheckpointId: leftId });
		const diff = parseCheckpointDiff(result, right?.description);
		if (!diff) {
			controller.store.patch({ checkpointCompareLoading: false, checkpointCompareError: left ? 'failedToCompareCheckpoints' : 'noPreviousCheckpoint' });
			return;
		}
		controller.store.patch({
			checkpointCompareLoading: false,
			checkpointCompareDiff: diff,
			checkpointDiffSelectedFile: diff.files[0]?.relativePath,
		});
	} catch {
		controller.store.patch({ checkpointCompareLoading: false, checkpointCompareError: 'failedToCompareCheckpoints' });
	}
}

export async function loadCheckpointConfig(controller: KnoxGuiController): Promise<void> {
	try {
		const result = await controller.messenger.request<Record<string, unknown>>('getCheckpointConfig', undefined);
		const raw = asRecord(result)?.config ?? result;
		const config = normalizeCheckpointConfig(asRecord(raw) as Partial<typeof DEFAULT_CHECKPOINT_CONFIG>);
		controller.store.patch({ checkpointConfig: config, checkpointConfigDraft: { ...config }, checkpointConfigStatus: undefined });
	} catch {
		const config = { ...DEFAULT_CHECKPOINT_CONFIG };
		controller.store.patch({ checkpointConfig: config, checkpointConfigDraft: { ...config }, checkpointConfigStatus: { type: 'info', messageKey: 'checkpointUseDefaultConfig' } });
	}
}

export function patchCheckpointConfig(controller: KnoxGuiController, partial: Partial<typeof DEFAULT_CHECKPOINT_CONFIG>): void {
	const draft = normalizeCheckpointConfig({ ...DEFAULT_CHECKPOINT_CONFIG, ...controller.store.state.checkpointConfigDraft, ...partial });
	controller.store.patch({ checkpointConfigDraft: draft });
}

export async function saveCheckpointConfig(controller: KnoxGuiController): Promise<void> {
	const draft = controller.store.state.checkpointConfigDraft ?? DEFAULT_CHECKPOINT_CONFIG;
	if (checkpointConfigHasErrors(validateCheckpointConfig(draft))) {
		controller.store.patch({ checkpointConfigStatus: { type: 'error', messageKey: 'checkpointFixValidationErrors' } });
		return;
	}
	try {
		await controller.messenger.request('saveCheckpointConfig', { config: draft });
		controller.store.patch({ checkpointConfig: { ...draft }, checkpointConfigStatus: { type: 'success', messageKey: 'checkpointConfigSaved' } });
	} catch {
		controller.store.patch({ checkpointConfigStatus: { type: 'error', messageKey: 'checkpointSaveFailed' } });
	}
}

export function resetCheckpointConfigToDefaults(controller: KnoxGuiController): void {
	controller.store.patch({
		checkpointConfigDraft: { ...DEFAULT_CHECKPOINT_CONFIG },
		checkpointConfigStatus: { type: 'info', messageKey: 'checkpointResetToDefault' },
	});
}

export function cancelCheckpointConfig(controller: KnoxGuiController): void {
	const original = controller.store.state.checkpointConfig ?? DEFAULT_CHECKPOINT_CONFIG;
	controller.store.patch({
		checkpointConfigDraft: { ...original },
		checkpointConfigStatus: undefined,
	});
}

export async function loadCheckpointDashboard(controller: KnoxGuiController): Promise<void> { // KN-375
	try {
		const result = await controller.messenger.request('getPerformanceDashboard', { historyDays: CHECKPOINT_DASHBOARD_HISTORY_DAYS });
		controller.store.patch({ checkpointDashboard: parsePerformanceDashboard(result) });
	} catch {
		controller.store.patch({ checkpointDashboard: undefined });
	}
}

export async function loadCheckpointAnalysis(controller: KnoxGuiController, checkpointId?: string): Promise<void> { // KN-375
	const id = checkpointId ?? controller.store.state.selectedCheckpointId ?? controller.store.state.checkpoints[0]?.id;
	if (!id) {
		controller.store.patch({ checkpointAnalysis: undefined });
		return;
	}
	controller.store.patch({ selectedCheckpointId: id });
	try {
		const result = await controller.messenger.request('analyzeCheckpoint', { checkpointId: id });
		controller.store.patch({ checkpointAnalysis: parseCheckpointAnalysis(result) });
	} catch {
		controller.store.patch({ checkpointAnalysis: undefined });
	}
}

export async function loadCheckpointAnalysisGroups(controller: KnoxGuiController): Promise<void> { // KN-375
	try {
		const result = await controller.messenger.request('suggestCheckpointGroups', { limit: CHECKPOINT_ANALYSIS_GROUP_LIMIT });
		controller.store.patch({ checkpointAnalysisGroups: parseSuggestedCheckpointGroups(result) });
	} catch {
		controller.store.patch({ checkpointAnalysisGroups: [] });
	}
}

export async function loadShareBundles(controller: KnoxGuiController): Promise<void> {
	try {
		const result = await controller.messenger.request('getSharedCheckpointBundles', { limit: 100 });
		const parsed = parseShareBundles(result);
		controller.store.patch({ checkpointShareBundles: parsed.bundles, checkpointShareAudit: parsed.auditRecords });
	} catch {
		controller.store.patch({ checkpointShareBundles: [], checkpointShareAudit: [] });
	}
}

export async function shareCheckpoints(controller: KnoxGuiController): Promise<void> {
	await controller.messenger.request('shareCheckpoints', {
		checkpointIds: controller.store.state.selectedCheckpointId ? [controller.store.state.selectedCheckpointId] : undefined,
	});
	await controller.loadShareBundles();
}

export async function importShareBundle(controller: KnoxGuiController, filePath: string): Promise<void> {
	await controller.messenger.request('importSharedBundle', { filePath });
	await controller.loadShareBundles();
	void controller.loadCheckpoints();
}

export async function revealShareBundle(controller: KnoxGuiController, filePath: string): Promise<void> {
	await controller.messenger.request('revealSharedBundle', { filePath });
}

export async function pinCheckpoint(controller: KnoxGuiController, checkpointId: string, pinned: boolean): Promise<void> {
	const patchPinned = () => {
		const pin = (nodes: IKnoxGuiState['checkpoints']) => nodes.map(node => node.id === checkpointId ? { ...node, pinned } : node);
		controller.store.patch({
			checkpoints: pin(controller.store.state.checkpoints),
			checkpointListItems: pin(controller.store.state.checkpointListItems),
			checkpointTimeline: pin(controller.store.state.checkpointTimeline),
		});
	};
	try {
		await controller.messenger.request('pinCheckpoint', { checkpointId, pinned });
		patchPinned();
		void controller.loadCheckpoints();
	} catch {
		controller.messenger.post('runCheckpointGraphAction', { action: pinned ? 'pin' : 'unpin', checkpointId });
		patchPinned();
	}
}

export async function loadMoreCheckpoints(controller: KnoxGuiController): Promise<void> {
	if (!controller.store.state.checkpointGraphHasMore) {
		return;
	}
	const nextLimit = Math.min(CHECKPOINT_GRAPH_LIMIT, (controller.store.state.checkpointGraphLimit || CHECKPOINT_GRAPH_PAGE_SIZE) + CHECKPOINT_GRAPH_PAGE_SIZE);
	try {
		const graph = await controller.messenger.request<Record<string, unknown>>('checkpointGraph', graphRequestPayload(controller, nextLimit));
		if (!graph) {
			controller.store.patch({ checkpointGraphLoadMoreError: 'checkpointGraph.loadMoreFailed' });
			return;
		}
		controller.store.patch({
			checkpoints: asArray(graph.nodes).map(parseCheckpointNode),
			checkpointBranches: asArray(graph.branches).map(parseCheckpointBranch),
			checkpointHeadId: graph.headCheckpointId ? String(graph.headCheckpointId) : controller.store.state.checkpointHeadId,
			checkpointGraphHasMore: graph.hasMore === true,
			checkpointGraphLimit: nextLimit,
			checkpointGraphLoadMoreError: undefined,
		});
	} catch {
		controller.store.patch({ checkpointGraphLoadMoreError: 'checkpointGraph.loadMoreFailed' });
	}
}

export async function saveCheckpointGraphUi(controller: KnoxGuiController, partial: Partial<IKnoxGuiState['checkpointGraphUi']>): Promise<void> {
	const next = { ...controller.store.state.checkpointGraphUi, ...partial };
	controller.store.patch({ checkpointGraphUi: next });
	try {
		await controller.messenger.request('saveCheckpointGraphUiState', next);
	} catch {
		// persistence optional
	}
}

export async function setCheckpointBranchFilter(controller: KnoxGuiController, filter: { branchIds?: string[]; activeBranchOnly?: boolean }): Promise<void> {
	await saveCheckpointGraphUi(controller, {
		branchIds: filter.activeBranchOnly ? undefined : filter.branchIds,
		activeBranchOnly: filter.activeBranchOnly,
	});
	controller.store.patch({ checkpointGraphLimit: CHECKPOINT_GRAPH_PAGE_SIZE });
	await loadCheckpoints(controller);
}

export async function setCheckpointWorkspace(controller: KnoxGuiController, path: string): Promise<void> {
	if (!path || path === controller.store.state.checkpointActiveWorkspace) {
		return;
	}
	try {
		const result = await controller.messenger.request<Record<string, unknown>>('setActiveCheckpointWorkspace', { workspacePath: path });
		if (result && result.success === false) {
			return;
		}
		controller.store.patch({ checkpointActiveWorkspace: path, checkpointGraphLimit: CHECKPOINT_GRAPH_PAGE_SIZE });
		await loadCheckpoints(controller);
	} catch {
		// workspace switch optional
	}
}

export async function deleteSelectedCheckpoints(controller: KnoxGuiController, ids: string[]): Promise<void> {
	if (!ids.length) {
		return;
	}
	try {
		await controller.messenger.request('deleteCheckpoints', { checkpointIds: ids });
	} catch {
		controller.messenger.post('deleteCheckpoints', { checkpointIds: ids });
	}
	await loadCheckpoints(controller);
	if (controller.store.state.checkpointView === 'checkpoints') {
		await loadCheckpointList(controller);
	}
}

function findCheckpointNode(controller: KnoxGuiController, id: string | undefined): IKnoxGuiState['checkpoints'][number] | undefined {
	if (!id) {
		return undefined;
	}
	const state = controller.store.state;
	return state.checkpoints.find(node => node.id === id)
		?? state.checkpointListItems.find(node => node.id === id)
		?? state.checkpointTimeline.find(node => node.id === id);
}

export async function loadCheckpointList(controller: KnoxGuiController, options?: { append?: boolean }): Promise<void> {
	const append = options?.append === true;
	if (append) {
		if (controller.store.state.checkpointListLoadingMore || !controller.store.state.checkpointListHasMore) {
			return;
		}
		controller.store.patch({ checkpointListLoadingMore: true });
	} else {
		controller.store.patch({ checkpointListLoading: true });
	}
	try {
		const offset = append ? controller.store.state.checkpointListItems.length : 0;
		const result = await controller.messenger.request<Record<string, unknown>>('listCheckpoints', {
			query: controller.store.state.checkpointQuery.trim() || undefined,
			offset,
			limit: CHECKPOINT_LIST_PAGE_SIZE,
			sessionId: controller.store.state.checkpointThisSession ? controller.store.state.sessionId : undefined,
			thisSessionOnly: controller.store.state.checkpointThisSession,
		});
		const nodes = asArray(result?.checkpoints).map(parseCheckpointNode);
		const folders = asArray(result?.workspaceFolders).map(item => {
			const rec = asRecord(item) ?? {};
			return { path: String(rec.path ?? ''), name: String(rec.name ?? rec.path ?? '') };
		}).filter(folder => folder.path);
		const previous = append ? controller.store.state.checkpointListItems : [];
		const seen = new Set(previous.map(node => node.id));
		const merged = append ? [...previous, ...nodes.filter(node => !seen.has(node.id))] : nodes;
		controller.store.patch({
			checkpointListItems: merged,
			checkpointListTotal: Number(result?.total ?? merged.length),
			checkpointListHasMore: result?.hasMore === true,
			checkpointListLoading: false,
			checkpointListLoadingMore: false,
			checkpointWorkspaceFolders: folders.length ? folders : controller.store.state.checkpointWorkspaceFolders,
			checkpointActiveWorkspace: result?.activeWorkspacePath ? String(result.activeWorkspacePath) : controller.store.state.checkpointActiveWorkspace,
		});
	} catch {
		controller.store.patch({ checkpointListLoading: false, checkpointListLoadingMore: false });
	}
}

export async function ensureCheckpointHead(controller: KnoxGuiController): Promise<void> {
	const headId = controller.store.state.checkpointHeadId;
	while (
		headId
		&& !controller.store.state.checkpoints.some(node => node.id === headId)
		&& controller.store.state.checkpointGraphHasMore
		&& (controller.store.state.checkpointGraphLimit || CHECKPOINT_GRAPH_PAGE_SIZE) < CHECKPOINT_GRAPH_LIMIT
	) {
		const previousLimit = controller.store.state.checkpointGraphLimit;
		await loadMoreCheckpoints(controller);
		if (controller.store.state.checkpointGraphLimit === previousLimit) {
			break;
		}
	}
}

export async function loadCheckpointTimeline(controller: KnoxGuiController): Promise<void> {
	try {
		const result = await controller.messenger.request<Record<string, unknown>>('getCheckpointTimeline', { limit: 500 });
		const nodes = asArray(result?.checkpoints).map(item => {
			const rec = asRecord(item) ?? {};
			return parseCheckpointNode({
				...rec,
				kind: rec.kind ?? rec.type,
				created: rec.created ?? rec.dateCreated,
				parents: rec.parents ?? (rec.parentId ? [rec.parentId] : []),
			});
		});
		controller.store.patch({
			checkpointTimeline: nodes,
			checkpointTimelineBranches: asArray(result?.branches).map(parseCheckpointBranch),
		});
	} catch {
		controller.store.patch({
			checkpointTimeline: controller.store.state.checkpoints,
			checkpointTimelineBranches: controller.store.state.checkpointBranches,
		});
	}
}

export async function createCheckpointBranch(controller: KnoxGuiController, name: string, baseCheckpointId: string): Promise<string | undefined> { // KN-375
	try {
		const result = await controller.messenger.request<Record<string, unknown>>('createCheckpointBranch', { name, baseCheckpointId });
		await loadCheckpoints(controller);
		return result?.id ? String(result.id) : (result?.branch && typeof result.branch === 'object' && 'id' in result.branch ? String((result.branch as { id: unknown }).id) : undefined);
	} catch {
		controller.messenger.post('createCheckpointBranch', { name, baseCheckpointId });
		return undefined;
	}
}

export async function switchCheckpointBranch(controller: KnoxGuiController, branchId: string): Promise<void> { // KN-375
	try {
		await controller.messenger.request('switchCheckpointBranch', { branchId });
		await loadCheckpoints(controller);
	} catch {
		controller.messenger.post('switchCheckpointBranch', { branchId });
	}
}
