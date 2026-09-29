/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Diff viewer: split/unified rows, word-level highlights, binary preview and the changed-file tree. */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { appendKnoxGuiSvg } from '../../knoxGuiIcons.js';
import {
	buildCheckpointFileTree,
	computeLineDiff,
	alignSplitDiffRows,
	buildDiffSegments,
	checkpointDiffChangedFiles,
	checkpointDiffContentBytes,
	checkpointDiffSummary,
	checkpointImageMime,
	formatSnapshotSize,
	hunkWordAltRanges,
	type IKnoxGuiTextRange,
} from '../../../../common/knoxGuiCheckpoints.js';
import { languageIdFromFence } from '../../../../common/knoxGuiTranscript.js';
import { IKnoxGuiCheckpointDiffFile, IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { checkpointButton } from './primitives.js';

export function renderDiffViewer(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, diff: NonNullable<IKnoxGuiState['checkpointCompareDiff']>): void {
	const changed = checkpointDiffChangedFiles(diff.files);
	if (!changed.length) {
		const empty = DOM.append(parent, DOM.$('.knox-gui-diff-viewer.knox-gui-diff-viewer-empty'));
		empty.setAttribute('data-testid', 'checkpoint-diff-empty');
		appendKnoxGuiSvg(empty, 'circle-check', 48).classList.add('knox-gui-diff-empty-icon');
		DOM.append(empty, DOM.$('p', undefined, t(state, 'noChangesDetected')));
		return;
	}
	const wrap = DOM.append(parent, DOM.$('.knox-gui-diff-viewer'));
	wrap.setAttribute('data-testid', 'checkpoint-diff-viewer');
	const summary = checkpointDiffSummary(diff.files);
	const header = DOM.append(wrap, DOM.$('.knox-gui-diff-toolbar'));
	const route = DOM.append(header, DOM.$('.knox-gui-diff-route'));
	appendKnoxGuiSvg(route, 'git-compare', 16).classList.add('knox-gui-diff-route-icon');
	const routeText = DOM.append(route, DOM.$('.knox-gui-diff-route-text'));
	appendKnoxGuiSvg(routeText, 'clock', 12);
	DOM.append(routeText, DOM.$('span.knox-gui-diff-route-name', { title: diff.oldCheckpoint.description }, diff.oldCheckpoint.description));
	appendKnoxGuiSvg(routeText, 'chevron-right', 12);
	DOM.append(routeText, DOM.$('span.knox-gui-diff-route-name', { title: diff.newCheckpoint.description }, diff.newCheckpoint.description));
	const controls = DOM.append(header, DOM.$('.knox-gui-diff-controls'));
	const totals = DOM.append(controls, DOM.$('.knox-gui-diff-summary'));
	totals.setAttribute('data-testid', 'checkpoint-diff-summary');
	DOM.append(totals, DOM.$('span.knox-gui-diff-summary-files', undefined, t(state, 'filesChanged', { count: summary.filesChanged })));
	DOM.append(totals, DOM.$('span.knox-gui-diff-vsep'));
	const plus = DOM.append(totals, DOM.$('span.knox-gui-diff-summary-stat.odp-text-green'));
	appendKnoxGuiSvg(plus, 'plus', 12);
	DOM.append(plus, DOM.$('span.sr-only', undefined, '+'));
	plus.append(String(summary.additions));
	const minus = DOM.append(totals, DOM.$('span.knox-gui-diff-summary-stat.odp-text-red'));
	appendKnoxGuiSvg(minus, 'minus', 12);
	DOM.append(minus, DOM.$('span.sr-only', undefined, '-'));
	minus.append(String(summary.deletions));
	DOM.append(controls, DOM.$('span.knox-gui-diff-vsep'));
	const toggles = DOM.append(controls, DOM.$('.knox-gui-diff-toggles'));
	const isSplit = state.checkpointDiffView === 'split';
	checkpointButton(widget, toggles, { svg: 'columns-2', label: t(state, 'split'), title: t(state, 'splitView'), selected: isSplit, variant: isSplit ? 'default' : 'outline', size: 'xs', onClick: () => widget.controller.store.patch({ checkpointDiffView: 'split' }) });
	checkpointButton(widget, toggles, { svg: 'file-text', label: t(state, 'unified'), title: t(state, 'unifiedView'), selected: !isSplit, variant: isSplit ? 'outline' : 'default', size: 'xs', onClick: () => widget.controller.store.patch({ checkpointDiffView: 'unified' }) });
	checkpointButton(widget, toggles, { svg: 'wrap-text', title: t(state, state.checkpointDiffWrap ? 'disableTextWrapping' : 'enableTextWrapping'), ariaLabel: t(state, state.checkpointDiffWrap ? 'disableTextWrapping' : 'enableTextWrapping'), selected: state.checkpointDiffWrap, variant: state.checkpointDiffWrap ? 'default' : 'outline', size: 'xs', onClick: () => widget.controller.store.patch({ checkpointDiffWrap: !state.checkpointDiffWrap }) });
	checkpointButton(widget, toggles, { svg: widget.checkpointDiffTreeCollapsed ? 'panel-left-open' : 'panel-left-close', title: t(state, widget.checkpointDiffTreeCollapsed ? 'showFileTree' : 'hideFileTree'), ariaLabel: t(state, widget.checkpointDiffTreeCollapsed ? 'showFileTree' : 'hideFileTree'), size: 'xs', onClick: () => { widget.checkpointDiffTreeCollapsed = !widget.checkpointDiffTreeCollapsed; widget.render(); } });

	const split = DOM.append(wrap, DOM.$(widget.checkpointDiffTreeCollapsed ? '.knox-gui-diff-split.tree-collapsed' : '.knox-gui-diff-split'));
	const selected = changed.find(file => file.relativePath === state.checkpointDiffSelectedFile) ?? changed[0];
	if (!widget.checkpointDiffTreeCollapsed) {
		const tree = DOM.append(split, DOM.$('.knox-gui-file-tree'));
		tree.setAttribute('data-testid', 'checkpoint-diff-tree');
		widget.renderFileTree(tree, { ...state, checkpointDiffSelectedFile: selected.relativePath }, changed, path => widget.controller.store.patch({ checkpointDiffSelectedFile: path }));
	}
	const pane = DOM.append(split, DOM.$('.knox-gui-diff-pane'));
	const fileHead = DOM.append(pane, DOM.$('.knox-gui-diff-file-head'));
	widget.appendFileIcon(fileHead, selected.relativePath, 14);
	DOM.append(fileHead, DOM.$('div.knox-gui-diff-file-name', { title: selected.relativePath }, selected.relativePath));
	if (selected.isBinary) {
		renderBinaryDiff(pane, state, selected);
		return;
	}
	const stats = DOM.append(fileHead, DOM.$('span.knox-gui-diff-file-stats'));
	DOM.append(stats, DOM.$('span.odp-text-green', undefined, `+${selected.additions}`));
	DOM.append(stats, DOM.$('span.odp-text-red', undefined, `-${selected.deletions}`));
	const lines = computeLineDiff(selected.oldContent ?? '', selected.newContent ?? '');
	const wordAlt = hunkWordAltRanges(lines);
	const view = DOM.append(pane, DOM.$(state.checkpointDiffWrap ? 'div.knox-gui-diff-hunks.wrap.pierre-diff-container' : 'div.knox-gui-diff-hunks.pierre-diff-container'));
	const gutter = (el: HTMLElement, value: number | null) => DOM.append(el, DOM.$('span.knox-gui-diff-gutter', undefined, value != null ? String(value) : ''));
	const renderRun = (block: HTMLElement, start: number, end: number) => {
		const run = lines.slice(start, end);
		if (state.checkpointDiffView === 'unified') {
			run.forEach((line, offset) => {
				const row = DOM.append(block, DOM.$(`div.knox-gui-diff-line.knox-gui-diff-${line.type}`));
				gutter(row, line.oldLineNum);
				gutter(row, line.newLineNum);
				DOM.append(row, DOM.$('span.knox-gui-diff-sign', undefined, line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '));
				paintDiffCode(widget, DOM.append(row, DOM.$('span.knox-gui-diff-code')), line.content, selected.relativePath, wordAlt[start + offset]);
			});
			return;
		}
		for (const pair of alignSplitDiffRows(run)) {
			const row = DOM.append(block, DOM.$('.knox-gui-diff-split-row'));
			for (const [side, index] of [['old', pair.left], ['new', pair.right]] as const) {
				const line = index === undefined ? undefined : run[index];
				if (!line) {
					DOM.append(row, DOM.$('span.knox-gui-diff-empty'));
					continue;
				}
				const cell = DOM.append(row, DOM.$(`span.knox-gui-diff-cell.knox-gui-diff-${line.type}`));
				gutter(cell, side === 'old' ? line.oldLineNum : line.newLineNum);
				paintDiffCode(widget, DOM.append(cell, DOM.$('span.knox-gui-diff-code')), line.content, selected.relativePath, wordAlt[start + index!]);
			}
		}
	};
	for (const segment of buildDiffSegments(lines)) {
		const key = `${selected.relativePath}:${segment.start}`;
		if (segment.kind === 'gap' && !widget.checkpointDiffExpandedGaps.has(key)) {
			const gap = DOM.append(view, DOM.$('button.knox-gui-diff-gap', { type: 'button' }));
			gap.setAttribute('data-testid', 'checkpoint-diff-gap');
			appendKnoxGuiSvg(gap, 'chevrons-up-down', 12);
			DOM.append(gap, DOM.$('span', undefined, t(state, 'linesHiddenExpand', { hidden: segment.end - segment.start })));
			widget.renderStore.add(DOM.addDisposableListener(gap, 'click', () => {
				widget.checkpointDiffExpandedGaps.add(key);
				widget.render();
			}));
			continue;
		}
		const block = DOM.append(view, DOM.$('.knox-gui-diff-hunk'));
		if (segment.kind === 'lines') {
			const run = lines.slice(segment.start, segment.end);
			const oldStart = run.find(line => line.oldLineNum != null)?.oldLineNum ?? 0;
			const newStart = run.find(line => line.newLineNum != null)?.newLineNum ?? 0;
			DOM.append(block, DOM.$('div.knox-gui-diff-hunk-head', undefined, `@@ -${oldStart} +${newStart} @@`));
		}
		renderRun(block, segment.start, segment.end);
	}
}

function renderBinaryDiff(pane: HTMLElement, state: IKnoxGuiState, file: IKnoxGuiCheckpointDiffFile): void {
	const grid = DOM.append(pane, DOM.$('.knox-gui-diff-binary'));
	grid.setAttribute('data-testid', 'checkpoint-diff-binary');
	const side = (title: string, content: string | null, encoding?: string) => {
		const card = DOM.append(grid, DOM.$('.knox-gui-diff-binary-card'));
		DOM.append(card, DOM.$('h4', undefined, title));
		const mime = checkpointImageMime(file.relativePath, encoding);
		if (mime && content) {
			const img = DOM.append(card, DOM.$<HTMLImageElement>('img.knox-gui-diff-binary-image'));
			img.src = `data:${mime};base64,${content}`;
			img.alt = file.relativePath;
			return;
		}
		const notice = DOM.append(card, DOM.$('.knox-gui-diff-binary-notice'));
		appendKnoxGuiSvg(notice, 'file-warning', 32);
		DOM.append(notice, DOM.$('p', undefined, t(state, 'binaryFileNotice')));
		const bytes = checkpointDiffContentBytes(content, encoding);
		if (bytes !== undefined) {
			DOM.append(notice, DOM.$('p.knox-gui-diff-binary-size', undefined, formatSnapshotSize(bytes)));
		}
	};
	if (file.status !== 'added') {
		side(t(state, 'previousVersion'), file.oldContent, file.oldEncoding);
	}
	if (file.status !== 'deleted') {
		side(t(state, 'currentVersion'), file.newContent, file.newEncoding);
	}
}

function paintDiffCode(widget: KnoxGuiWidget, el: HTMLElement, content: string, filepath: string, ranges: ReturnType<typeof hunkWordAltRanges>[number]): void {
	widget.paintHighlightedCode(el, languageIdFromFence('', filepath), content, filepath);
	wrapTextRanges(el, ranges, 'knox-gui-diff-word-alt');
}

function wrapTextRanges(root: HTMLElement, ranges: IKnoxGuiTextRange[] | undefined, className: string): void {
	if (!ranges?.length) {
		return;
	}
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	while (walker.nextNode()) {
		nodes.push(walker.currentNode as Text);
	}
	let offset = 0;
	for (const node of nodes) {
		const text = node.data;
		const from = offset;
		const to = offset + text.length;
		offset = to;
		const hits = ranges.filter(range => range.start < to && range.end > from);
		if (!hits.length || !node.parentNode) {
			continue;
		}
		const frag = document.createDocumentFragment();
		let cursor = 0;
		const local = hits
			.map(range => ({ start: Math.max(0, range.start - from), end: Math.min(text.length, range.end - from) }))
			.filter(range => range.end > range.start)
			.sort((a, b) => a.start - b.start);
		for (const hit of local) {
			if (hit.start > cursor) {
				frag.appendChild(document.createTextNode(text.slice(cursor, hit.start)));
			}
			const mark = document.createElement('span');
			mark.className = className;
			if (className === 'knox-gui-diff-word-alt') {
				mark.setAttribute('data-testid', 'knox-gui-diff-word-alt');
			}
			mark.textContent = text.slice(hit.start, hit.end);
			frag.appendChild(mark);
			cursor = hit.end;
		}
		if (cursor < text.length) {
			frag.appendChild(document.createTextNode(text.slice(cursor)));
		}
		node.parentNode.replaceChild(frag, node);
	}
}

export function renderFileTree(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, files: IKnoxGuiCheckpointDiffFile[], onSelect: (path: string) => void): void {
	const byPath = new Map(files.map(file => [file.relativePath, file]));
	const chip = (row: HTMLElement, label: string, tone: string) => DOM.append(row, DOM.$(`span.odp-chip.${tone}.knox-gui-file-tree-chip`, undefined, label));
	const renderNodes = (nodes: ReturnType<typeof buildCheckpointFileTree>, depth: number) => {
		for (const node of nodes) {
			const collapsed = node.isDirectory && widget.checkpointDiffCollapsedFolders.has(node.path);
			const row = DOM.append(parent, DOM.$(node.isDirectory ? '.knox-gui-file-tree-row.is-folder' : '.knox-gui-file-tree-row'));
			row.style.paddingLeft = `${(depth + (node.isDirectory ? 1 : 2)) * 12}px`;
			row.title = node.path;
			if (node.path === state.checkpointDiffSelectedFile) {
				row.classList.add('selected');
			}
			if (node.isDirectory) {
				appendKnoxGuiSvg(row, collapsed ? 'chevron-right' : 'chevron-down', 14).classList.add('knox-gui-file-tree-chevron');
			} else {
				widget.appendFileIcon(row, node.name, 14);
			}
			DOM.append(row, DOM.$('span.knox-gui-file-tree-name', undefined, node.name));
			const file = byPath.get(node.path);
			if (file && !node.isDirectory) {
				const stats = DOM.append(row, DOM.$('span.knox-gui-file-tree-stats'));
				if (file.isBinary) {
					chip(stats, 'BIN', 'odp-chip-yellow');
				}
				if (file.status === 'added') {
					chip(stats, 'A', 'odp-chip-green');
				} else if (file.status === 'deleted') {
					chip(stats, 'D', 'odp-chip-red');
				} else if (!file.isBinary) {
					if (file.additions) {
						DOM.append(stats, DOM.$('span.odp-text-green', undefined, `+${file.additions}`));
					}
					if (file.deletions) {
						DOM.append(stats, DOM.$('span.odp-text-red', undefined, `-${file.deletions}`));
					}
				}
			}
			widget.renderStore.add(DOM.addDisposableListener(row, 'click', () => {
				if (!node.isDirectory) {
					onSelect(node.path);
					return;
				}
				if (collapsed) {
					widget.checkpointDiffCollapsedFolders.delete(node.path);
				} else {
					widget.checkpointDiffCollapsedFolders.add(node.path);
				}
				widget.render();
			}));
			if (node.children && !collapsed) {
				renderNodes(node.children, depth + 1);
			}
		}
	};
	renderNodes(buildCheckpointFileTree(files.map(file => file.relativePath)), 0);
}
