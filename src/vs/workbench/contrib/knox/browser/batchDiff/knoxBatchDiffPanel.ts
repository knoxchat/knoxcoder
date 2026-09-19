/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IKnoxGuiBridge, knoxUnwrapProtocol } from '../../common/knoxGuiProtocol.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { knoxApplyStatesFingerprint } from '../../common/knoxApply.js';
import { knoxNls } from '../../common/knoxI18n.js';
import {
	IKnoxBatchDiffFile,
	knoxBatchDiffFileName,
	knoxBatchDiffTotals,
	knoxParseBatchDiffFiles,
	knoxSelectAllBatchDiffFiles,
	knoxSelectedBatchDiffUris,
	knoxToggleBatchDiffFile,
} from '../../common/knoxBatchDiff.js';

/**
 * Native batch diff (T9.5): checkboxes; accept/reject selected or all.
 */
export class KnoxBatchDiffPanel extends Disposable {

	readonly element: HTMLElement;
	private readonly _viewStore = this._register(new DisposableStore());
	private _files: IKnoxBatchDiffFile[] = [];
	private _busy = false;
	private _applyFingerprint = '';

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
	) {
		super();
		this.element = append(parent, $('.knox-batch-diff'));
		this.element.setAttribute('role', 'region');
		this.element.setAttribute('aria-label', knoxNls('batchDiff'));
		this._applyFingerprint = knoxApplyStatesFingerprint(this._chatService.applyStates);
		this._register(this._chatService.onDidChange(() => this._onApplyChanged()));
		void this.refresh();
	}

	private _onApplyChanged(): void {
		const next = knoxApplyStatesFingerprint(this._chatService.applyStates);
		if (next === this._applyFingerprint) {
			return;
		}
		this._applyFingerprint = next;
		void this.refresh();
	}

	async refresh(): Promise<void> {
		try {
			const result = knoxUnwrapProtocol(await this._bridge.request('batch/getPendingFiles', undefined));
			this._files = knoxParseBatchDiffFiles(result.content);
		} catch {
			this._files = [];
		}
		this._render();
	}

	private _render(): void {
		this._viewStore.clear();
		clearNode(this.element);
		const t = (key: string) => knoxNls(key, undefined, undefined, this._chatService.language);
		if (!this._files.length) {
			append(this.element, $('p.knox-muted')).textContent = t('noPendingDiffs');
			return;
		}
		const totals = knoxBatchDiffTotals(this._files);
		const header = append(this.element, $('.knox-batch-header'));
		append(header, $('strong')).textContent = t('batchDiff');
		append(header, $('span.knox-muted')).textContent = `${totals.files} ${t('files')}, ${totals.diffs} ${t('changes')}`;
		const actions = append(header, $('.knox-batch-header-actions'));
		this._textButton(actions, t('selectAll'), () => {
			this._files = knoxSelectAllBatchDiffFiles(this._files, true);
			this._render();
		});
		this._textButton(actions, t('deselectAll'), () => {
			this._files = knoxSelectAllBatchDiffFiles(this._files, false);
			this._render();
		});

		const list = append(this.element, $('.knox-batch-list'));
		for (const file of this._files) {
			const row = append(list, $('label.knox-batch-row'));
			row.classList.toggle('selected', file.selected);
			const box = append(row, $<HTMLInputElement>('input'));
			box.type = 'checkbox';
			box.checked = file.selected;
			const names = knoxBatchDiffFileName(file.filepath);
			const name = append(row, $('span.knox-batch-name'));
			name.textContent = names.name;
			if (names.dir) {
				append(name, $('span.knox-muted')).textContent = ` ${names.dir}`;
			}
			append(row, $('span.knox-batch-count')).textContent = String(file.numDiffs);
			this._viewStore.add(addDisposableListener(box, 'change', () => {
				this._files = knoxToggleBatchDiffFile(this._files, file.filepath);
				this._render();
			}));
		}

		const footer = append(this.element, $('.knox-batch-footer'));
		append(footer, $('span.knox-muted')).textContent = `${totals.selected}/${totals.files} ${t('selectedCountOf')}`;
		const buttons = append(footer, $('.knox-batch-actions'));
		this._action(buttons, t('acceptSelected'), !totals.selected || this._busy, () => this._run('batch/acceptSelected', knoxSelectedBatchDiffUris(this._files)));
		this._action(buttons, t('rejectSelected'), !totals.selected || this._busy, () => this._run('batch/rejectSelected', knoxSelectedBatchDiffUris(this._files)));
		this._action(buttons, t('acceptAll'), this._busy, () => this._run('batch/acceptAll'));
		this._action(buttons, t('rejectAll'), this._busy, () => this._run('batch/rejectAll'));
	}

	private async _run(messageType: string, fileUris?: string[]): Promise<void> {
		this._busy = true;
		this._render();
		try {
			await this._bridge.request(messageType, fileUris ? { fileUris } : undefined);
			await this.refresh();
		} finally {
			this._busy = false;
			this._render();
		}
	}

	private _textButton(parent: HTMLElement, label: string, onClick: () => void): void {
		const button = append(parent, $<HTMLButtonElement>('button.knox-link'));
		button.type = 'button';
		button.textContent = label;
		this._viewStore.add(addDisposableListener(button, 'click', onClick));
	}

	private _action(parent: HTMLElement, label: string, disabled: boolean, onClick: () => void): void {
		const button = append(parent, $<HTMLButtonElement>('button.knox-overlay-back'));
		button.type = 'button';
		button.textContent = label;
		button.disabled = disabled;
		this._viewStore.add(addDisposableListener(button, 'click', onClick));
	}
}
