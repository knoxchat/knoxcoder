/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiController } from '../../knoxGuiController.js';
import { ACTIVITY_PANEL_EXPANDED_KEY, GIT_DIFF_EXPANDED_KEY, asRecord, asArray, withTimeout } from './helpers.js';
import { StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { finalizeGitDiffFiles, gitFilesFromChangedList, gitFilesFromDiffs, knoxGuiResolveOpenPath, mergeGitChangedWithDiffs, parseBackgroundJobs } from '../../../common/knoxGuiPanels.js';
import { IKnoxGuiContextItem, IKnoxGuiGitDiffFile } from '../../../common/knoxGuiState.js';
import { knoxGuiContextItemOpenAction } from '../../../common/knoxGuiTranscript.js';

export function showFile(controller: KnoxGuiController, filepath: string, options?: { startLine?: number; endLine?: number }): void {
	const target = knoxGuiResolveOpenPath(filepath, []);
	if (target?.direct) {
		// URI or absolute path: nothing to resolve, open right away.
		openResolved(controller, target.fallback, options);
		return;
	}
	void resolveAndOpen(controller, filepath, options);
}

function openResolved(controller: KnoxGuiController, uri: string, options?: { startLine?: number; endLine?: number }): void {
	if (options?.startLine != null && options.startLine > 0) {
		const startLine = options.startLine - 1;
		const endLine = options.endLine != null && options.endLine > 0 ? options.endLine - 1 : startLine;
		controller.messenger.post('showLines', { filepath: uri, startLine, endLine });
		return;
	}
	controller.messenger.post('showFile', { filepath: uri });
}

/**
 * The host opens URIs only. Transcript paths are usually workspace-relative (`snake_game/src/main.rs`),
 * so resolve them against the workspace folders first, like the original Knox `openFileInEditor`.
 */
async function resolveAndOpen(controller: KnoxGuiController, filepath: string, options?: { startLine?: number; endLine?: number }): Promise<void> {
	const dirs = await controller.messenger.request<string[]>('getWorkspaceDirs', undefined).catch(() => [] as string[]);
	const target = knoxGuiResolveOpenPath(filepath, Array.isArray(dirs) ? dirs.filter(dir => typeof dir === 'string') : []);
	if (!target) {
		return;
	}
	for (const candidate of target.candidates) {
		const exists = await controller.messenger.request<boolean>('fileExists', { filepath: candidate }).catch(() => false);
		if (exists) {
			openResolved(controller, candidate, options);
			return;
		}
	}
	openResolved(controller, target.fallback, options);
}

export function openContextItem(controller: KnoxGuiController, ctx: IKnoxGuiContextItem): void {
	const action = knoxGuiContextItemOpenAction(ctx);
	switch (action.kind) {
		case 'url':
			controller.messenger.post('openUrl', action.url);
			return;
		case 'lines':
			controller.messenger.post('showLines', { filepath: action.filepath, startLine: action.startLine, endLine: action.endLine });
			return;
		case 'file':
			void controller.messenger.request('openFile', { path: action.filepath }).catch(() => undefined);
			return;
		case 'virtual':
			void controller.messenger.request('showVirtualFile', { name: action.name, content: action.content }).catch(() => undefined);
			return;
	}
}

export function openGitFile(controller: KnoxGuiController, file: IKnoxGuiGitDiffFile): void {
	void openGitFileAsync(controller, file);
}

async function openGitFileAsync(controller: KnoxGuiController, file: IKnoxGuiGitDiffFile): Promise<void> {
	if (file.status === 'deleted') {
		controller.messenger.post('openGitChange', { uri: file.uri });
		return;
	}
	try {
		await controller.messenger.request('showFile', { filepath: file.uri || file.filepath });
	} catch {
		controller.messenger.post('openGitChange', { uri: file.uri });
	}
}

export function gitDiffExpanded(controller: KnoxGuiController): boolean {
	const stored = controller.storageService.get(GIT_DIFF_EXPANDED_KEY, StorageScope.PROFILE);
	if (stored === undefined) {
		return true;
	}
	return stored === 'true';
}

export function gitDiffExpandedPinned(controller: KnoxGuiController): boolean {
	return controller.storageService.get(GIT_DIFF_EXPANDED_KEY, StorageScope.PROFILE) !== undefined;
}

export function setGitDiffExpanded(controller: KnoxGuiController, expanded: boolean): void {
	controller.storageService.store(GIT_DIFF_EXPANDED_KEY, expanded ? 'true' : 'false', StorageScope.PROFILE, StorageTarget.USER);
}

export function activityPanelExpanded(controller: KnoxGuiController): boolean {
	return controller.storageService.get(ACTIVITY_PANEL_EXPANDED_KEY, StorageScope.PROFILE) === 'true';
}

export function setActivityPanelExpanded(controller: KnoxGuiController, expanded: boolean): void {
	controller.storageService.store(ACTIVITY_PANEL_EXPANDED_KEY, expanded ? 'true' : 'false', StorageScope.PROFILE, StorageTarget.USER);
}

export function dismissCompaction(controller: KnoxGuiController): void {
	controller.store.patch({ compaction: undefined });
}

export function dismissInjectedMemories(controller: KnoxGuiController): void {
	controller.store.patch({ injectedMemories: [] });
}

export function toggleJobsPanel(controller: KnoxGuiController): void {
	controller.store.patch({ jobsPanelOpen: !controller.store.state.jobsPanelOpen });
}

export async function runJobAction(controller: KnoxGuiController, action: 'kill' | 'killAll' | 'dismiss' | 'clear', jobId?: string): Promise<void> {
	try {
		const result = await controller.messenger.request<Record<string, unknown>>('agent/jobs', { action, jobId });
		const jobs = parseBackgroundJobs(asRecord(result)?.jobs ?? result);
		controller.store.patch({ backgroundJobs: jobs });
	} catch {
		if (action === 'dismiss' && jobId) {
			controller.store.patch({ backgroundJobs: controller.store.state.backgroundJobs.filter(job => job.id !== jobId) });
		}
		if (action === 'clear') {
			controller.store.patch({ backgroundJobs: controller.store.state.backgroundJobs.filter(job => job.status === 'running') });
		}
	}
}

export async function pinInjectedMemory(controller: KnoxGuiController, id: number, pinned: boolean): Promise<void> {
	try {
		const result = await controller.messenger.request<Record<string, unknown>>(pinned ? 'brain/unpinMemory' : 'brain/pinMemory', { id });
		if (asRecord(result)?.success) {
			controller.store.patch({
				injectedMemories: controller.store.state.injectedMemories.map(item => item.id === id ? { ...item, pinned: !pinned } : item),
			});
		}
	} catch {
		// best-effort
	}
}

export async function forgetInjectedMemory(controller: KnoxGuiController, id: number): Promise<void> {
	try {
		const result = await controller.messenger.request<Record<string, unknown>>('brain/deleteMemory', { id });
		if (asRecord(result)?.success) {
			controller.store.patch({ injectedMemories: controller.store.state.injectedMemories.filter(item => item.id !== id) });
		}
	} catch {
		// best-effort
	}
}

export async function mismatchInjectedMemory(controller: KnoxGuiController, id: number): Promise<void> {
	try {
		const result = await controller.messenger.request<Record<string, unknown>>('brain/mismatchMemory', { id, sessionId: controller.store.state.sessionId });
		if (asRecord(result)?.success) {
			controller.store.patch({ injectedMemories: controller.store.state.injectedMemories.filter(item => item.id !== id) });
		}
	} catch {
		// best-effort
	}
}

export async function refreshGitDiff(controller: KnoxGuiController, force = false): Promise<void> {
	const now = Date.now();
	if (!force && now - controller.lastGitFetch < 1500) {
		return;
	}
	controller.lastGitFetch = now;
	try {
		const changed = await withTimeout(controller.messenger.request<unknown>('getGitChangedFiles', undefined), 5000);
		const changedList = Array.isArray(changed) ? changed : asArray(asRecord(changed)?.content ?? asRecord(changed)?.files);
		let files: IKnoxGuiGitDiffFile[] = [];
		if (changedList.length) {
			files = gitFilesFromChangedList(changedList.map(item => {
				const rec = asRecord(item) ?? {};
				return {
					filepath: String(rec.filepath ?? rec.path ?? ''),
					uri: rec.uri ? String(rec.uri): undefined,
					status: rec.status as IKnoxGuiGitDiffFile['status'],
					additions: typeof rec.additions === 'number' ? rec.additions : undefined,
					deletions: typeof rec.deletions === 'number' ? rec.deletions : undefined,
					isBinary: typeof rec.isBinary === 'boolean' ? rec.isBinary : undefined,
				};
			}).filter(file => file.filepath));
			if (files.some(file => file.additions === 0 && file.deletions === 0 && !file.isBinary)) {
				const diffs = await withTimeout(controller.messenger.request<unknown>('getDiff', { includeUnstaged: true }), 5000);
				const list = Array.isArray(diffs) ? diffs.map(String): asArray(asRecord(diffs)?.content).map(String);
				files = mergeGitChangedWithDiffs(files, gitFilesFromDiffs(list));
			}
		} else {
			const diffs = await withTimeout(controller.messenger.request<unknown>('getDiff', { includeUnstaged: true }), 5000);
			const list = Array.isArray(diffs) ? diffs.map(String): asArray(asRecord(diffs)?.content).map(String);
			files = gitFilesFromDiffs(list);
		}
		controller.store.patch({ gitDiffFiles: finalizeGitDiffFiles(files) });
	} catch {
		// git optional
	}
}

export function startGitPoll(controller: KnoxGuiController): void {
	controller.clearGitPoll();
	controller.gitPollTimer = setInterval(() => {
		if (controller.wasStreaming && !controller.store.state.isStreaming) {
			void controller.refreshGitDiff(true);
			if (controller.store.state.worktree.enabled) {
				void controller.runWorktree('status');
			}
		} else {
			const minGap = controller.store.state.isStreaming ? 5000 : 15000;
			if (Date.now() - controller.lastGitFetch >= minGap) {
				void controller.refreshGitDiff(controller.store.state.isStreaming);
			}
		}
		controller.wasStreaming = controller.store.state.isStreaming;
	}, 5000);
}

export function clearGitPoll(controller: KnoxGuiController): void {
	if (controller.gitPollTimer) {
		clearInterval(controller.gitPollTimer);
		controller.gitPollTimer = undefined;
	}
}

export async function refreshBackgroundJobs(controller: KnoxGuiController): Promise<void> {
	try {
		const result = await controller.messenger.request<Record<string, unknown>>('agent/jobs', { action: 'list' });
		controller.store.patch({ backgroundJobs: parseBackgroundJobs(asRecord(result)?.jobs ?? result) });
	} catch {
		// jobs optional
	}
}

export async function runWorktree(controller: KnoxGuiController, action: 'enter' | 'apply' | 'discard' | 'status'): Promise<void> {
	controller.store.patch({ worktree: { ...controller.store.state.worktree, busy: true } });
	try {
		const result = await controller.messenger.request<Record<string, unknown>>('agent/worktree', { action, sessionId: controller.store.state.sessionId });
		const rec = asRecord(result);
		const state = asRecord(rec?.state);
		if (!rec?.ok || !state?.enabled) {
			controller.store.patch({ worktree: { enabled: false, busy: false, files: [], error: rec?.error ? String(rec.error): undefined } });
			return;
		}
		controller.store.patch({
			worktree: {
				enabled: true,
				busy: false,
				branch: state.branch ? String(state.branch): undefined,
				path: state.path ? String(state.path): undefined,
				files: asArray(state.files).map(String),
				error: rec.error ? String(rec.error): undefined,
			},
		});
	} catch (error) {
		controller.store.patch({ worktree: { ...controller.store.state.worktree, busy: false, error: error instanceof Error ? error.message : String(error) } });
	}
}

export async function loadPendingFiles(controller: KnoxGuiController): Promise<void> {
	try {
		const result = await controller.messenger.request<Record<string, unknown>>('batch/getPendingFiles', undefined);
		const files = asArray(asRecord(result)?.files ?? result).map(item => {
			const rec = asRecord(item) ?? {};
			return { filepath: String(rec.filepath ?? ''), numDiffs: Number(rec.numDiffs ?? 0), selected: rec.selected !== false };
		});
		controller.store.patch({ pendingFiles: files, batchApplying: false });
	} catch {
		controller.store.patch({ batchApplying: false });
	}
}

export async function applyBatchDiff(controller: KnoxGuiController, kind: 'acceptAll' | 'rejectAll' | 'acceptSelected' | 'rejectSelected', fileUris?: string[]): Promise<void> {
	controller.store.patch({ batchApplying: true });
	try {
		await controller.messenger.request(`batch/${kind}`, fileUris ? { fileUris } : undefined);
		await controller.loadPendingFiles();
	} catch {
		controller.store.patch({ batchApplying: false });
	}
}

export function schedulePendingFilesReload(controller: KnoxGuiController): void {
	if (controller.pendingFilesTimer) {
		clearTimeout(controller.pendingFilesTimer);
	}
	controller.pendingFilesTimer = setTimeout(() => {
		void controller.loadPendingFiles();
	}, 200);
}
