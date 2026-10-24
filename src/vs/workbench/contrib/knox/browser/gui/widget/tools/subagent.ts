/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Task-subagent card: profile/prompt meta, live progress, and merge rows. */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { knoxGuiParseSubagentMerges } from '../../../../common/knoxGuiSubagentMerge.js';
import { IKnoxGuiState, IKnoxGuiToolCall } from '../../../../common/knoxGuiState.js';

export function renderTaskSubagent(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
	const args = tool.parsedArgs ?? {};
	const profile = typeof args.profile === 'string' ? args.profile : 'explore';
	const prompt = typeof args.prompt === 'string' ? args.prompt : '';
	const explores = Array.isArray(args.explores) ? args.explores.length : 0;
	const output = tool.outputItems?.[0]?.content ?? tool.output;
	const card = DOM.append(parent, DOM.$('.knox-gui-subagent'));
	card.setAttribute('data-testid', 'knox-gui-subagent');
	card.setAttribute('data-subagent-profile', profile);
	const meta = DOM.append(card, DOM.$('.knox-gui-muted.knox-gui-subagent-meta'));
	meta.setAttribute('data-testid', 'knox-gui-subagent-meta');
	meta.textContent = `${profile}${explores > 1 ? ` ×${explores}` : ''}${prompt ? ` — ${prompt.slice(0, 160)}${prompt.length > 160 ? '…' : ''}` : ''}`;
	if ((tool.status === 'calling' || tool.status === 'generating') && output) {
		const live = DOM.append(card, DOM.$('.knox-gui-muted.knox-gui-subagent-progress'));
		live.setAttribute('data-testid', 'knox-gui-subagent-progress');
		const lines = output.trim().split(/\r?\n/).filter(line => line.trim());
		live.textContent = lines.at(-1) ?? output.slice(0, 160);
	}
	const merges = knoxGuiParseSubagentMerges(output);
	if (merges.length) {
		const list = DOM.append(card, DOM.$('.knox-gui-subagent-merges'));
		list.setAttribute('data-testid', 'knox-gui-subagent-merges');
		for (const merge of merges) {
			const files = merge.files.join(', ');
			const text = merge.status === 'applied' ? t(state, 'subagentMergeApplied', { files })
				: merge.status === 'conflict' ? t(state, 'subagentMergeConflict', { files })
					: merge.status === 'no-changes' ? t(state, 'subagentMergeNone')
						: merge.status === 'skipped' ? t(state, 'subagentMergeSkipped')
							: t(state, 'subagentMergeError');
			const row = DOM.append(list, DOM.$(`.knox-gui-subagent-merge.knox-gui-subagent-merge-${merge.status}`));
			row.setAttribute('data-merge-status', merge.status);
			row.textContent = merge.label ? `${merge.label} — ${text}` : text;
			if (merge.patchPath) {
				const patchPath = merge.patchPath;
				const open = DOM.append(row, DOM.$('button.knox-gui-link-button', undefined, t(state, 'subagentMergeOpenPatch')));
				widget.renderStore.add(DOM.addDisposableListener(open, 'click', () => widget.controller.showFile(patchPath)));
			}
		}
	}
	if (output) {
		DOM.append(card, DOM.$('pre.knox-gui-subagent-output', undefined, output));
	}
}
