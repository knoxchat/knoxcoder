/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Exact-search hit list and tool-search loaded/already chips. */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { appendKnoxGuiSvg, setKnoxGuiInnerHtml } from '../../knoxGuiIcons.js';
import { knoxGuiParseToolSearch } from '../../../../common/knoxGuiToolSearch.js';
import {
	exactSearchDisplayQuery,
	exactSearchQueryBadge,
	highlightSearchQueryInHtml,
	parseSearchResults,
	searchOutput,
} from '../../../../common/knoxGuiTools.js';
import { IKnoxGuiState, IKnoxGuiToolCall } from '../../../../common/knoxGuiState.js';
import { makeKnoxGuiActivatable } from '../a11y.js';

export function renderExactSearchTool(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
	const query = exactSearchDisplayQuery(tool);
	const items = tool.outputItems?.length ? tool.outputItems : (tool.output ? [{ content: tool.output }] : []);
	const content = searchOutput(items);
	const parsed = parseSearchResults(content);
	const matches = parsed.reduce((sum, file) => sum + file.lines.filter(line => line.isMatch).length, 0);
	const streaming = tool.status === 'generating' || tool.status === 'calling';
	const expanded = widget.cardExpanded(tool.id, true);
	const title = DOM.append(parent, DOM.$('.knox-gui-tool-kind-title'));
	appendKnoxGuiSvg(title, 'search', 16);
	DOM.append(title, DOM.$('span.knox-gui-cyan', undefined, t(state, 'exactSearch')));
	const card = DOM.append(parent, DOM.$('.knox-gui-search-card'));
	card.setAttribute('data-testid', 'knox-gui-search');
	const head = DOM.append(card, DOM.$('.knox-gui-search-head'));
	widget.collapseChevron(head, {
		expanded,
		title: expanded ? t(state, 'collapse') : t(state, 'expand'),
		onClick: () => widget.toggleCardExpanded(tool.id, true),
	});
	appendKnoxGuiSvg(head, 'search', 14);
	const queryEl = DOM.append(head, DOM.$('span.knox-gui-search-query', undefined, exactSearchQueryBadge(query)));
	queryEl.title = query || t(state, 'searching');
	const stats = DOM.append(head, DOM.$('span.knox-gui-muted'));
	stats.textContent = streaming
		? t(state, 'searching')
		: parsed.length > 0
			? t(state, 'matchesInFiles', { matches, files: parsed.length })
			: t(state, 'noMatchesFound');
	if (!expanded) {
		return;
	}
	const body = DOM.append(card, DOM.$('.knox-gui-search-body'));
	if (streaming) {
		const loading = DOM.append(body, DOM.$('.knox-gui-search-empty'));
		widget.appendSpinner(loading, 16);
		DOM.append(loading, DOM.$('span', undefined, t(state, 'searchingRepository')));
		return;
	}
	if (!parsed.length) {
		const empty = DOM.append(body, DOM.$('.knox-gui-search-empty'));
		appendKnoxGuiSvg(empty, 'search', 28);
		DOM.append(empty, DOM.$('span', undefined, t(state, 'noMatchesFound')));
		return;
	}
	for (const file of parsed) {
		const block = DOM.append(body, DOM.$('.knox-gui-search-file'));
		const fileHead = DOM.append(block, DOM.$('.knox-gui-search-file-head'));
		widget.renderClickablePath(fileHead, file.filePath, { showIcon: true });
		DOM.append(fileHead, DOM.$('span.knox-gui-tool-badge', undefined, file.language));
		for (const line of file.lines) {
			const row = DOM.append(block, DOM.$('button.knox-gui-search-line')) as HTMLButtonElement;
			row.type = 'button';
			if (line.isMatch) {
				row.classList.add('match');
			}
			row.title = `${file.filePath}:${line.lineNum}`;
			DOM.append(row, DOM.$('span.knox-gui-search-ln', undefined, String(line.lineNum)));
			const code = DOM.append(row, DOM.$('code.knox-gui-search-code'));
			widget.paintHighlightedCode(code, file.language, line.content, file.filePath);
			if (line.isMatch && query) {
				setKnoxGuiInnerHtml(code, highlightSearchQueryInHtml(code.innerHTML, query));
			}
			makeKnoxGuiActivatable(widget, row);
			widget.renderStore.add(DOM.addDisposableListener(row, 'click', () => {
				widget.controller.showFile(file.filePath, { startLine: line.lineNum, endLine: line.lineNum });
			}));
		}
	}
}

export function renderToolSearch(parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
	const result = knoxGuiParseToolSearch(tool.parsedArgs, tool.outputItems?.[0]?.content ?? tool.output);
	const card = DOM.append(parent, DOM.$('.knox-gui-tool-search'));
	card.setAttribute('data-testid', 'knox-gui-tool-search');
	if (result.requested) {
		DOM.append(card, DOM.$('.knox-gui-muted', undefined, t(state, 'toolSearchLooking', { query: result.requested })));
	}
	const chips = (labelKey: 'toolSearchLoaded' | 'toolSearchAlready', names: readonly string[]) => {
		if (!names.length) {
			return;
		}
		const row = DOM.append(card, DOM.$('.knox-gui-tool-search-row'));
		DOM.append(row, DOM.$('span.knox-gui-muted', undefined, t(state, labelKey)));
		for (const name of names) {
			DOM.append(row, DOM.$('span.knox-gui-tool-search-chip', undefined, name.replace(/^builtin_/, '')));
		}
	};
	chips('toolSearchLoaded', result.loaded);
	chips('toolSearchAlready', result.already);
	if (result.noMatch) {
		DOM.append(card, DOM.$('.knox-gui-muted', undefined, t(state, 'toolSearchNone')));
	}
}
