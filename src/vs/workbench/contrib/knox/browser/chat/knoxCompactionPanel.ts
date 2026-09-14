/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass } from '../knoxGuiIcons.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { knoxIsCompactionBannerVisible } from '../../common/knoxCompaction.js';
import { KnoxAttachedPanel } from './knoxAttachedPanel.js';

/**
 * Latest context-compaction banner (T5.10).
 */
export class KnoxCompactionPanel extends Disposable {

	private readonly _panel: KnoxAttachedPanel;
	private readonly _dismiss: HTMLButtonElement;

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
	) {
		super();
		this._panel = this._register(new KnoxAttachedPanel(parent, 'compaction-status-panel'));
		this._panel.title.textContent = localize('knox.compactionAppliedTitle', "Context compacted");
		this._dismiss = append(this._panel.extra, $<HTMLButtonElement>('button.knox-attached-dismiss'));
		this._dismiss.type = 'button';
		this._dismiss.setAttribute('aria-label', localize('knox.compactionDismiss', "Dismiss"));
		const glyph = append(this._dismiss, $('span'));
		glyph.className = knoxGuiIconClass('x');
		this._register(addDisposableListener(this._dismiss, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			this._chatService.setLastCompaction(null);
		}));
		this._register(this._panel.onDidChangeHeight(() => this._onDidChangeHeight.fire()));
		this._register(this._chatService.onDidChange(() => this._render()));
		this._render();
	}

	private _render(): void {
		const compaction = this._chatService.lastCompaction;
		if (!knoxIsCompactionBannerVisible(compaction)) {
			this._panel.setVisible(false);
			return;
		}
		this._panel.setVisible(true);
		this._panel.meta.textContent = compaction.summarizationMethod === 'llm'
			? localize('knox.compactionMethodLlm', "LLM summary")
			: compaction.summarizationMethod === 'heuristic'
				? localize('knox.compactionMethodHeuristic', "heuristic")
				: localize('knox.compactionMethodNone', "trimmed");

		clearNode(this._panel.body);
		const stats = [
			localize('knox.compactionStats', "{0} → {1} messages", compaction.originalMessageCount, compaction.compactedMessageCount),
		];
		if (compaction.deduplicated) {
			stats.push(localize('knox.compactionDeduplicated', "deduplicated"));
		}
		if (compaction.summarized) {
			stats.push(localize('knox.compactionSummarized', "summarized"));
		}
		append(this._panel.body, $('div.knox-attached-muted')).textContent = stats.join(' · ');
		if (compaction.summaryText) {
			append(this._panel.body, $('pre.knox-attached-pre')).textContent = compaction.summaryText;
		} else {
			append(this._panel.body, $('div.knox-attached-empty')).textContent = localize('knox.compactionNoSummary', "No summary text available for this compaction.");
		}
	}
}
