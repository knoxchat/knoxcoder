/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { KNOX_GIT_DIFF_PANEL_EXPANDED_KEY } from '../../common/knoxChat.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { IKnoxGuiBridge } from '../../common/knoxGuiProtocol.js';
import {
	IKnoxGitDiffFile,
	knoxFinalizeGitDiffFiles,
	knoxGitDiffTotals,
	knoxGitFileTypeColor,
	knoxGitFileTypeIsConfig,
	knoxParseDiffList,
	knoxParseGitChangedFiles,
} from '../../common/knoxGitDiff.js';
import { KnoxAttachedPanel } from './knoxAttachedPanel.js';

function unwrapContent(result: unknown): unknown {
	if (result && typeof result === 'object') {
		const record = result as { status?: string; content?: unknown };
		if (record.status === 'success') {
			return record.content;
		}
		if (record.status === 'error') {
			return undefined;
		}
		if ('content' in record) {
			return record.content;
		}
	}
	return result;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<null>(resolve => {
				timeout = setTimeout(() => resolve(null), ms);
			}),
		]);
	} finally {
		if (timeout) {
			clearTimeout(timeout);
		}
	}
}

/**
 * Changed-files strip with +/- counts (T5.11).
 */
export class KnoxGitDiffPanel extends Disposable {

	private readonly _panel: KnoxAttachedPanel;
	private readonly _contentStore = this._register(new DisposableStore());
	private readonly _poll: RunOnceScheduler;
	private readonly _initialFetch: RunOnceScheduler;
	private readonly _afterStreamFetch: RunOnceScheduler;
	private _files: IKnoxGitDiffFile[] = [];
	private _hasFetched = false;
	private _lastFetch = 0;
	private _expandedPinnedByUser: boolean;
	private _wasStreaming = false;
	private _fetching = false;

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
		@IStorageService private readonly _storageService: IStorageService,
	) {
		super();
		const stored = this._storageService.getBoolean(KNOX_GIT_DIFF_PANEL_EXPANDED_KEY, StorageScope.PROFILE);
		this._expandedPinnedByUser = stored !== undefined;
		this._panel = this._register(new KnoxAttachedPanel(parent, 'git-diff-panel', stored ?? true));
		this._panel.title.textContent = localize('knox.filesChangedZero', "0 files changed");

		this._poll = this._register(new RunOnceScheduler(() => {
			void this._fetch(this._chatService.isStreaming);
			this._schedulePoll();
		}, 15_000));
		this._initialFetch = this._register(new RunOnceScheduler(() => void this._fetch(), 500));
		this._afterStreamFetch = this._register(new RunOnceScheduler(() => void this._fetch(true), 400));

		this._register(this._panel.onDidChangeHeight(() => this._onDidChangeHeight.fire()));
		this._register(addDisposableListener(this._panel.toggle, 'click', () => {
			this._expandedPinnedByUser = true;
			this._storageService.store(
				KNOX_GIT_DIFF_PANEL_EXPANDED_KEY,
				this._panel.open,
				StorageScope.PROFILE,
				StorageTarget.MACHINE,
			);
		}));
		this._register(this._bridge.onDidReceivePush(message => {
			if (message.messageType === 'gitStateChanged') {
				void this._fetch(true);
			}
		}));
		this._register(this._chatService.onDidChange(() => this._onSessionChange()));
		this._wasStreaming = this._chatService.isStreaming;
		this._schedulePoll();
		this._initialFetch.schedule();
		this._render();
	}

	private _schedulePoll(): void {
		this._poll.schedule(this._chatService.isStreaming ? 5_000 : 15_000);
	}

	private _onSessionChange(): void {
		const streaming = this._chatService.isStreaming;
		if (this._wasStreaming && !streaming) {
			this._afterStreamFetch.schedule();
		}
		this._wasStreaming = streaming;
	}

	private async _fetch(force = false): Promise<void> {
		const now = Date.now();
		if (!force && now - this._lastFetch < 1500) {
			return;
		}
		if (this._fetching) {
			return;
		}
		this._lastFetch = now;
		this._fetching = true;
		try {
			let files: IKnoxGitDiffFile[] = [];
			const changed = unwrapContent(await withTimeout(this._bridge.request('getGitChangedFiles', undefined), 5_000));
			const serverFiles = knoxParseGitChangedFiles(changed);
			if (serverFiles.length > 0) {
				files = serverFiles;
			} else {
				const diffs = unwrapContent(await withTimeout(this._bridge.request('getDiff', { includeUnstaged: true }), 5_000));
				files = knoxParseDiffList(diffs);
			}
			const next = knoxFinalizeGitDiffFiles(files);
			if (this._files.length === 0 && next.length > 0 && !this._expandedPinnedByUser) {
				this._panel.setOpen(true);
			}
			this._files = next;
			this._hasFetched = true;
			this._render();
		} catch {
			this._hasFetched = true;
			this._render();
		} finally {
			this._fetching = false;
		}
	}

	private async _openFile(file: IKnoxGitDiffFile): Promise<void> {
		try {
			if (file.status === 'deleted') {
				await this._bridge.request('openGitChange', { uri: file.uri });
				return;
			}
			await this._bridge.request('openFile', { path: file.uri });
		} catch {
			try {
				await this._bridge.request('openGitChange', { uri: file.uri });
			} catch {
				// Opening is best-effort.
			}
		}
	}

	private _render(): void {
		this._contentStore.clear();
		if (!this._hasFetched || this._files.length === 0) {
			this._panel.setVisible(false);
			return;
		}
		this._panel.setVisible(true);
		const count = this._files.length;
		this._panel.title.textContent = count === 1
			? localize('knox.filesChangedOne', "1 file changed")
			: localize('knox.filesChangedMany', "{0} files changed", count);
		const totals = knoxGitDiffTotals(this._files);
		const bits: string[] = [];
		if (totals.additions > 0) {
			bits.push(`+${totals.additions}`);
		}
		if (totals.deletions > 0) {
			bits.push(`-${totals.deletions}`);
		}
		this._panel.meta.textContent = bits.join(' ');

		clearNode(this._panel.body);
		for (const file of this._files) {
			const row = append(this._panel.body, $<HTMLButtonElement>('button.knox-git-file'));
			row.type = 'button';
			row.title = file.filepath;
			const type = append(row, $('span.knox-git-type'));
			type.textContent = knoxGitFileTypeIsConfig(file.fileType) ? '⚙' : file.fileType;
			type.style.color = knoxGitFileTypeColor(file.fileType);
			append(row, $('span.knox-git-path')).textContent = file.displayPath;
			const stats = append(row, $('span.knox-git-stats'));
			const showStats = file.additions > 0 || file.deletions > 0;
			if (file.isBinary && !showStats) {
				append(stats, $('span.knox-git-binary')).textContent = localize('knox.gitDiffBinary', "binary");
			} else {
				if (file.additions > 0) {
					append(stats, $('span.knox-git-add')).textContent = `+${file.additions}`;
				}
				if (file.deletions > 0) {
					append(stats, $('span.knox-git-del')).textContent = `-${file.deletions}`;
				}
			}
			this._contentStore.add(addDisposableListener(row, 'click', () => void this._openFile(file)));
		}
	}
}
