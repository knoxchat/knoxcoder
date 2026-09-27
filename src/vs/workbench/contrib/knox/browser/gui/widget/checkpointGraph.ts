/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../knoxGuiWidget.js';
import { t } from './t.js';
import * as DOM from '../../../../../../base/browser/dom.js';
import {
	activeHeadId,
	buildCheckpointPathTree,
	CHECKPOINT_GRAPH_DETAILS_HEIGHT,
	CHECKPOINT_GRAPH_ROW_HEIGHT,
	CHECKPOINT_GRAPH_VERTEX_RADIUS,
	CHECKPOINT_GRAPH_WORKING_TREE_ID,
	checkpointAncestorIds,
	checkpointBranchIsFiltered,
	checkpointFilterAfterBranchToggle,
	checkpointGraphFilterFromUi,
	checkpointGraphGridColumns,
	checkpointGraphHeadsById,
	checkpointGraphLaneColor,
	checkpointGraphMatches,
	checkpointGraphRowTop,
	checkpointGraphWindow,
	checkpointKindClass,
	checkpointKindI18nKey,
	checkpointLaneNeighbor,
	checkpointThemeIsLight,
	drawCheckpointGraph,
	formatCheckpointGraphTime,
	layoutCheckpointLanes,
	remapCheckpointBranchColor,
	resolveCheckpointLaneColor,
	withWorkingTreeNode,
	type CheckpointGraphPathTreeNode,
	type KnoxCheckpointGraphColumn,
} from '../../../common/knoxGuiCheckpoints.js';
import { IKnoxGuiCheckpointBranch, IKnoxGuiCheckpointNode, IKnoxGuiState } from '../../../common/knoxGuiState.js';
import { knoxGuiIsMetaEquivalent } from '../../../common/knoxGuiInput.js';
import { KnoxGuiRoute } from '../../../common/knoxGuiProtocol.js';

type GraphNode = IKnoxGuiCheckpointNode & { workingTree?: boolean };
type GraphCompare = { kind: 'checkpoint'; id: string } | { kind: 'workspace' };

export function renderCheckpointGraph(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	const headId = state.checkpointHeadId ?? activeHeadId(state.checkpointBranches);
	const displayNodes = withWorkingTreeNode(state.checkpoints, headId, state.checkpointWorkingTreePaths, t(state, 'checkpointGraph.workingTree'));
	const prefs = state.checkpointGraphUi;
	const layout = layoutCheckpointLanes(displayNodes.map(node => ({ id: node.id, parents: node.parents })), headId);
	const openIndex = widget.checkpointGraphOpenId ? displayNodes.findIndex(node => node.id === widget.checkpointGraphOpenId) : -1;
	if (widget.checkpointGraphOpenId && openIndex < 0) {
		widget.checkpointGraphOpenId = null;
	}
	const docked = prefs.detailsLocation === 'dock';
	const expand = !docked && openIndex >= 0 ? { at: openIndex, y: CHECKPOINT_GRAPH_DETAILS_HEIGHT } : undefined;
	const drawing = drawCheckpointGraph(layout, expand);
	const range = checkpointGraphWindow(displayNodes.length, widget.checkpointGraphScrollTop, widget.checkpointGraphViewport, expand);
	const heads = checkpointGraphHeadsById(state.checkpointBranches);
	const ancestors = checkpointAncestorIds(state.checkpoints, headId ?? null);
	const columns = checkpointGraphGridColumns(drawing.width, prefs.hiddenColumns, prefs.columnWidths);
	if (widget.checkpointGraphPendingHead && headId) {
		const headIndex = displayNodes.findIndex(node => node.id === headId);
		if (headIndex >= 0) {
			widget.checkpointGraphPendingHead = false;
			widget.checkpointGraphOpenId = headId;
			const top = checkpointGraphRowTop(headIndex, expand);
			widget.checkpointGraphScrollTop = Math.max(0, top - Math.max(widget.checkpointGraphViewport, CHECKPOINT_GRAPH_ROW_HEIGHT * 8) / 2 + CHECKPOINT_GRAPH_ROW_HEIGHT / 2);
		}
	}
	const light = checkpointThemeIsLight();
	const hits = graphFindHits(displayNodes, heads, widget.checkpointGraphFindQuery);
	syncGraphCompare(widget, state);

	const root = DOM.append(body, DOM.$('.knox-gui-graph'));
	root.setAttribute('data-testid', 'checkpoint-graph');
	root.tabIndex = 0;
	root.setAttribute('role', 'table');
	DOM.append(root, DOM.$('h1.sr-only', undefined, t(state, 'checkpointGraph.title')));
	renderGraphControlBar(widget, root, state, displayNodes);
	if (widget.checkpointGraphSettingsOpen) {
		renderGraphSettings(widget, root, state);
	}
	const table = DOM.append(root, DOM.$('.knox-gui-graph-table'));
	if (widget.checkpointGraphFindOpen) {
		renderGraphFind(widget, table, state, hits.length);
	}
	renderGraphHeader(widget, table, state, columns, drawing.width);
	const scroller = DOM.append(table, DOM.$('.knox-gui-graph-scroll'));
	widget.listenerStore.add(DOM.addDisposableListener(scroller, 'scroll', () => {
		widget.checkpointGraphScrollTop = scroller.scrollTop;
		widget.checkpointGraphViewport = scroller.clientHeight;
		if (state.checkpointGraphHasMore && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 48) {
			void widget.controller.loadMoreCheckpoints();
		}
		widget.render();
	}));
	queueMicrotask(() => {
		if (Math.abs(scroller.scrollTop - widget.checkpointGraphScrollTop) > 1) {
			scroller.scrollTop = widget.checkpointGraphScrollTop;
		}
		widget.checkpointGraphViewport = scroller.clientHeight;
	});
	const canvas = DOM.append(scroller, DOM.$('.knox-gui-graph-canvas-wrap'));
	canvas.style.height = `${drawing.height}px`;
	renderGraphSvg(widget, canvas, state, drawing, displayNodes, heads, headId, light);
	for (let index = range.start; index < range.end; index += 1) {
		const node = displayNodes[index];
		if (!node) {
			continue;
		}
		const top = checkpointGraphRowTop(index, expand);
		renderGraphRow(widget, canvas, state, {
			node,
			top,
			columns,
			current: node.id === headId,
			muted: prefs.mute && !node.workingTree && !ancestors.has(node.id),
			found: hits[widget.checkpointGraphFindIndex] === index && widget.checkpointGraphFindQuery.trim().length > 0,
			open: node.id === widget.checkpointGraphOpenId,
			branches: heads.get(node.id) ?? [],
			light,
		});
		if (node.id === widget.checkpointGraphOpenId && !docked) {
			renderGraphDetails(widget, canvas, state, node, top + CHECKPOINT_GRAPH_ROW_HEIGHT, drawing.width, false);
		}
	}
	if (state.checkpointGraphHasMore || state.checkpointGraphLoadMoreError) {
		const more = DOM.append(scroller, DOM.$('.knox-gui-graph-more'));
		if (state.checkpointGraphLoadMoreError) {
			DOM.append(more, DOM.$('span', undefined, t(state, state.checkpointGraphLoadMoreError)));
		}
		if (state.checkpointGraphHasMore) {
			widget.chromeButton(more, {
				label: t(state, 'checkpointGraph.loadMore'),
				testId: 'checkpoint-graph-load-more',
				onClick: () => void widget.controller.loadMoreCheckpoints(),
			});
		}
	}
	if (docked && openIndex >= 0 && displayNodes[openIndex]) {
		const dock = DOM.append(table, DOM.$('.knox-gui-graph-dock'));
		renderGraphDetails(widget, dock, state, displayNodes[openIndex], 0, 0, true);
	}
	if (widget.checkpointGraphMenu) {
		renderGraphMenu(widget, root, state, displayNodes);
	}
	if (widget.checkpointGraphPrompt) {
		renderGraphPrompt(widget, root, state);
	}
}

export function onCheckpointGraphKeyDown(widget: KnoxGuiWidget, e: KeyboardEvent, state: IKnoxGuiState): boolean {
	if (state.route !== KnoxGuiRoute.CheckpointGraph || state.checkpointView !== 'graph') {
		return false;
	}
	const meta = knoxGuiIsMetaEquivalent(e);
	if (meta && e.key.toLowerCase() === 'f' && !e.shiftKey) {
		e.preventDefault();
		widget.checkpointGraphFindOpen = true;
		widget.render();
		queueMicrotask(() => widget.checkpointGraphFindInput?.focus());
		return true;
	}
	if (meta && e.key.toLowerCase() === 'r') {
		e.preventDefault();
		void widget.controller.loadCheckpoints();
		return true;
	}
	if (meta && e.key.toLowerCase() === 'h') {
		e.preventDefault();
		widget.checkpointGraphPendingHead = true;
		void widget.controller.ensureCheckpointHead().then(() => widget.render());
		return true;
	}
	if (e.key === 'Escape') {
		if (widget.checkpointGraphSettingsOpen) {
			widget.checkpointGraphSettingsOpen = false;
			widget.render();
			return true;
		}
		if (widget.checkpointGraphPrompt) {
			widget.checkpointGraphPrompt = null;
			widget.render();
			return true;
		}
		if (widget.checkpointGraphMenu) {
			widget.checkpointGraphMenu = null;
			widget.render();
			return true;
		}
		if (widget.checkpointGraphOpenId && widget.checkpointGraphFindOpen) {
			widget.checkpointGraphOpenId = null;
			widget.render();
			return true;
		}
		if (widget.checkpointGraphFindOpen) {
			widget.checkpointGraphFindOpen = false;
			widget.render();
			return true;
		}
		if (widget.checkpointGraphOpenId) {
			widget.checkpointGraphOpenId = null;
			widget.render();
			return true;
		}
	}
	if (!widget.checkpointGraphOpenId || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
		return false;
	}
	const direction = e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : null;
	if (!direction) {
		return false;
	}
	e.preventDefault();
	const headId = state.checkpointHeadId ?? activeHeadId(state.checkpointBranches);
	const displayNodes = withWorkingTreeNode(state.checkpoints, headId, state.checkpointWorkingTreePaths, t(state, 'checkpointGraph.workingTree'));
	const layout = layoutCheckpointLanes(displayNodes.map(node => ({ id: node.id, parents: node.parents })), headId);
	const currentIndex = displayNodes.findIndex(node => node.id === widget.checkpointGraphOpenId);
	const nextId = meta
		? checkpointLaneNeighbor(displayNodes, layout.nodes, widget.checkpointGraphOpenId, direction)
		: direction === 'up' ? displayNodes[currentIndex - 1]?.id : displayNodes[currentIndex + 1]?.id;
	if (nextId) {
		widget.checkpointGraphOpenId = nextId;
		widget.render();
	}
	return true;
}

function graphFindHits(nodes: readonly GraphNode[], heads: Map<string, IKnoxGuiCheckpointBranch[]>, query: string): number[] {
	if (!query.trim()) {
		return [];
	}
	const matched: number[] = [];
	nodes.forEach((node, index) => {
		const names = (heads.get(node.id) ?? []).map(branch => branch.name);
		if (checkpointGraphMatches(node, names, query)) {
			matched.push(index);
		}
	});
	return matched;
}

function syncGraphCompare(widget: KnoxGuiWidget, state: IKnoxGuiState): void {
	const compare: GraphCompare | null = widget.checkpointGraphCompare;
	const openId = widget.checkpointGraphOpenId;
	if (!compare || !openId || openId === CHECKPOINT_GRAPH_WORKING_TREE_ID) {
		widget.checkpointGraphComparePaths = null;
		widget.checkpointGraphCompareError = null;
		widget.checkpointGraphCompareKey = null;
		return;
	}
	const key = `${openId}:${compare.kind}:${compare.kind === 'checkpoint' ? compare.id : 'workspace'}`;
	if (widget.checkpointGraphCompareKey === key) {
		return;
	}
	widget.checkpointGraphCompareKey = key;
	widget.checkpointGraphComparePaths = null;
	widget.checkpointGraphCompareError = null;
	void (async () => {
		try {
			const payload = compare.kind === 'workspace'
				? { checkpointId: openId, compareToWorkspace: true }
				: { checkpointId: openId, compareToCheckpointId: compare.id };
			const result = await widget.controller.messenger.request<Record<string, unknown>>('computeCheckpointDiff', payload);
			const files = Array.isArray((result as { diff?: { files?: Array<{ relativePath?: string }> } })?.diff?.files)
				? (result as { diff: { files: Array<{ relativePath?: string }> } }).diff.files
				: [];
			if (widget.checkpointGraphCompareKey !== key) {
				return;
			}
			if (!files.length && result && (result as { success?: boolean }).success === false) {
				widget.checkpointGraphCompareError = 'failedToCompareCheckpoints';
				widget.checkpointGraphComparePaths = [];
			} else {
				widget.checkpointGraphComparePaths = files.map(file => String(file.relativePath ?? '')).filter(Boolean);
			}
			widget.render();
		} catch {
			if (widget.checkpointGraphCompareKey === key) {
				widget.checkpointGraphCompareError = 'failedToCompareCheckpoints';
				widget.checkpointGraphComparePaths = [];
				widget.render();
			}
		}
	})();
}

function clickGraphRow(widget: KnoxGuiWidget, event: { metaKey: boolean; ctrlKey: boolean }, id: string): void {
	if (event.metaKey || event.ctrlKey) {
		if (widget.checkpointGraphOpenId && widget.checkpointGraphOpenId !== id && id !== CHECKPOINT_GRAPH_WORKING_TREE_ID && widget.checkpointGraphOpenId !== CHECKPOINT_GRAPH_WORKING_TREE_ID) {
			widget.checkpointGraphCompare = { kind: 'checkpoint', id };
			widget.checkpointGraphArmCompare = false;
			widget.render();
		}
		return;
	}
	if (widget.checkpointGraphArmCompare && widget.checkpointGraphOpenId && widget.checkpointGraphOpenId !== id && id !== CHECKPOINT_GRAPH_WORKING_TREE_ID) {
		widget.checkpointGraphCompare = { kind: 'checkpoint', id };
		widget.checkpointGraphArmCompare = false;
		widget.render();
		return;
	}
	if (widget.checkpointGraphCompare) {
		widget.checkpointGraphCompare = null;
		widget.checkpointGraphArmCompare = false;
		widget.checkpointGraphOpenId = id;
		widget.render();
		return;
	}
	widget.checkpointGraphOpenId = widget.checkpointGraphOpenId === id ? null : id;
	widget.render();
}

function renderGraphControlBar(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, displayNodes: readonly GraphNode[]): void {
	const bar = DOM.append(parent, DOM.$('.knox-gui-graph-bar'));
	const folders = state.checkpointWorkspaceFolders;
	if (folders.length > 1) {
		const select = DOM.append(bar, DOM.$('select.knox-gui-select')) as HTMLSelectElement;
		select.setAttribute('aria-label', t(state, 'checkpointGraph.workspace'));
		for (const folder of folders) {
			const option = DOM.append(select, DOM.$('option')) as HTMLOptionElement;
			option.value = folder.path;
			option.textContent = folder.name;
			if (folder.path === state.checkpointActiveWorkspace) {
				option.selected = true;
			}
		}
		widget.listenerStore.add(DOM.addDisposableListener(select, 'change', () => void widget.controller.setCheckpointWorkspace(select.value)));
	}
	const filter = checkpointGraphFilterFromUi(state.checkpointGraphUi);
	const details = DOM.append(bar, DOM.$('details.knox-gui-graph-branches'));
	const summary = DOM.append(details, DOM.$('summary'));
	summary.textContent = filter.activeBranchOnly
		? t(state, 'checkpointGraph.activeBranchOnly')
		: !filter.branchIds ? t(state, 'checkpointGraph.allBranches') : t(state, 'checkpointGraph.branches');
	const menu = DOM.append(details, DOM.$('.knox-gui-graph-branch-menu'));
	menu.setAttribute('data-testid', 'checkpoint-graph-branches');
	const all = DOM.append(menu, DOM.$('label.knox-gui-row'));
	const allBox = DOM.append(all, DOM.$('input')) as HTMLInputElement;
	allBox.type = 'checkbox';
	allBox.checked = !filter.activeBranchOnly && !filter.branchIds;
	widget.listenerStore.add(DOM.addDisposableListener(allBox, 'change', () => void widget.controller.setCheckpointBranchFilter({})));
	DOM.append(all, DOM.$('span', undefined, t(state, 'checkpointGraph.allBranches')));
	const active = DOM.append(menu, DOM.$('label.knox-gui-row'));
	const activeBox = DOM.append(active, DOM.$('input')) as HTMLInputElement;
	activeBox.type = 'checkbox';
	activeBox.checked = filter.activeBranchOnly === true;
	widget.listenerStore.add(DOM.addDisposableListener(activeBox, 'change', () => void widget.controller.setCheckpointBranchFilter({ activeBranchOnly: true })));
	DOM.append(active, DOM.$('span', undefined, t(state, 'checkpointGraph.activeBranchOnly')));
	const selected = new Set(filter.branchIds ?? []);
	for (const branch of state.checkpointBranches) {
		const row = DOM.append(menu, DOM.$('label.knox-gui-row'));
		const box = DOM.append(row, DOM.$('input')) as HTMLInputElement;
		box.type = 'checkbox';
		box.checked = !filter.activeBranchOnly && selected.has(branch.id);
		widget.listenerStore.add(DOM.addDisposableListener(box, 'change', () => {
			const next = new Set(filter.activeBranchOnly ? [] : selected);
			if (box.checked) {
				next.add(branch.id);
			} else {
				next.delete(branch.id);
			}
			void widget.controller.setCheckpointBranchFilter({ branchIds: [...next] });
		}));
		DOM.append(row, DOM.$('span', undefined, branch.name));
	}
	widget.chromeButton(bar, { label: t(state, 'checkpointGraph.refresh'), onClick: () => void widget.controller.loadCheckpoints() });
	widget.chromeButton(bar, {
		label: t(state, 'checkpointGraph.find'),
		onClick: () => {
			widget.checkpointGraphFindOpen = true;
			widget.render();
			queueMicrotask(() => widget.checkpointGraphFindInput?.focus());
		},
	});
	widget.chromeButton(bar, {
		label: state.checkpointGraphUi.mute ? t(state, 'checkpointGraph.mute') : t(state, 'checkpointGraph.muteOff'),
		testId: 'checkpoint-graph-mute',
		onClick: () => void widget.controller.saveCheckpointGraphUi({ mute: !state.checkpointGraphUi.mute }),
	});
	widget.chromeButton(bar, {
		label: t(state, 'checkpointGraph.settings'),
		onClick: () => {
			widget.checkpointGraphSettingsOpen = !widget.checkpointGraphSettingsOpen;
			widget.render();
		},
	});
	const openNode = displayNodes.find(node => node.id === widget.checkpointGraphOpenId);
	const compare = widget.checkpointGraphCompare;
	const compareLabel = compare && openNode
		? `${openNode.shortId || t(state, 'checkpointGraph.workingTree')} ↔ ${compare.kind === 'workspace' ? t(state, 'checkpointGraph.workspace') : displayNodes.find(node => node.id === compare.id)?.shortId ?? compare.id}`
		: widget.checkpointGraphArmCompare ? t(state, 'checkpointGraph.comparePick') : undefined;
	if (compareLabel) {
		const chip = DOM.append(bar, DOM.$('span.knox-gui-graph-compare'));
		chip.setAttribute('data-testid', 'checkpoint-graph-compare');
		DOM.append(chip, DOM.$('span', undefined, compareLabel));
		widget.chromeButton(chip, {
			label: t(state, 'checkpointGraph.compareClear'),
			onClick: () => {
				widget.checkpointGraphCompare = null;
				widget.checkpointGraphArmCompare = false;
				widget.render();
			},
		});
	}
}

function renderGraphSettings(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const panel = DOM.append(parent, DOM.$('.knox-gui-graph-settings'));
	panel.setAttribute('data-testid', 'checkpoint-graph-settings');
	const prefs = state.checkpointGraphUi;
	const details = DOM.append(panel, DOM.$('label'));
	DOM.append(details, DOM.$('span', undefined, t(state, 'checkpointGraph.detailsLocation')));
	const detailsSelect = DOM.append(details, DOM.$('select.knox-gui-select')) as HTMLSelectElement;
	for (const value of ['inline', 'dock'] as const) {
		const option = DOM.append(detailsSelect, DOM.$('option')) as HTMLOptionElement;
		option.value = value;
		option.textContent = t(state, value === 'inline' ? 'checkpointGraph.detailsInline' : 'checkpointGraph.detailsDock');
		if (prefs.detailsLocation === value) {
			option.selected = true;
		}
	}
	widget.listenerStore.add(DOM.addDisposableListener(detailsSelect, 'change', () => void widget.controller.saveCheckpointGraphUi({ detailsLocation: detailsSelect.value === 'dock' ? 'dock' : 'inline' })));
	const dates = DOM.append(panel, DOM.$('label'));
	DOM.append(dates, DOM.$('span', undefined, t(state, 'checkpointGraph.dateStyle')));
	const dateSelect = DOM.append(dates, DOM.$('select.knox-gui-select')) as HTMLSelectElement;
	for (const value of ['relative', 'absolute'] as const) {
		const option = DOM.append(dateSelect, DOM.$('option')) as HTMLOptionElement;
		option.value = value;
		option.textContent = t(state, value === 'relative' ? 'checkpointGraph.dateRelative' : 'checkpointGraph.dateAbsolute');
		if (prefs.dateStyle === value) {
			option.selected = true;
		}
	}
	widget.listenerStore.add(DOM.addDisposableListener(dateSelect, 'change', () => void widget.controller.saveCheckpointGraphUi({ dateStyle: dateSelect.value === 'absolute' ? 'absolute' : 'relative' })));
	widget.toggle(panel, t(state, 'checkpointGraph.mute'), prefs.mute, value => void widget.controller.saveCheckpointGraphUi({ mute: value }));
	const colors = DOM.append(panel, DOM.$('.knox-gui-graph-colors'));
	prefs.laneColors.forEach((color, index) => {
		const input = DOM.append(colors, DOM.$('input')) as HTMLInputElement;
		input.value = color;
		input.setAttribute('aria-label', `${t(state, 'checkpointGraph.colors')} ${index + 1}`);
		widget.listenerStore.add(DOM.addDisposableListener(input, 'change', () => {
			const next = prefs.laneColors.slice();
			next[index] = input.value;
			void widget.controller.saveCheckpointGraphUi({ laneColors: next });
		}));
	});
	widget.chromeButton(panel, {
		label: t(state, 'checkpointGraph.showConfiguration'),
		onClick: () => widget.controller.messenger.post('runCheckpointGraphAction', { action: 'showConfiguration' }),
	});
	widget.chromeButton(panel, {
		label: t(state, 'checkpointGraph.findClose'),
		onClick: () => {
			widget.checkpointGraphSettingsOpen = false;
			widget.render();
		},
	});
}

function renderGraphFind(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, count: number): void {
	const form = DOM.append(parent, DOM.$('form.knox-gui-graph-find'));
	form.setAttribute('data-testid', 'checkpoint-graph-find');
	widget.listenerStore.add(DOM.addDisposableListener(form, 'submit', e => {
		e.preventDefault();
		jumpGraphFind(widget, state, 1);
	}));
	const input = DOM.append(form, DOM.$('input')) as HTMLInputElement;
	input.value = widget.checkpointGraphFindQuery;
	input.setAttribute('aria-label', t(state, 'checkpointGraph.find'));
	widget.checkpointGraphFindInput = input;
	widget.listenerStore.add(DOM.addDisposableListener(input, 'input', () => {
		widget.checkpointGraphFindQuery = input.value;
		widget.checkpointGraphFindIndex = 0;
		widget.render();
	}));
	const index = count === 0 ? 0 : Math.min(widget.checkpointGraphFindIndex, count - 1) + 1;
	const countEl = DOM.append(form, DOM.$('span.knox-gui-muted'));
	countEl.setAttribute('data-testid', 'checkpoint-graph-find-count');
	countEl.textContent = t(state, 'checkpointGraph.findCount', { index, count });
	widget.chromeButton(form, { label: t(state, 'checkpointGraph.findPrevious'), onClick: () => jumpGraphFind(widget, state, -1) });
	widget.chromeButton(form, { label: t(state, 'checkpointGraph.findNext'), onClick: () => jumpGraphFind(widget, state, 1) });
	const open = DOM.append(form, DOM.$('label.knox-gui-row'));
	const box = DOM.append(open, DOM.$('input')) as HTMLInputElement;
	box.type = 'checkbox';
	box.checked = widget.checkpointGraphFindOpenDetails;
	widget.listenerStore.add(DOM.addDisposableListener(box, 'change', () => {
		widget.checkpointGraphFindOpenDetails = box.checked;
		widget.render();
	}));
	DOM.append(open, DOM.$('span', undefined, t(state, 'checkpointGraph.findOpenDetails')));
	widget.chromeButton(form, {
		label: t(state, 'checkpointGraph.findClose'),
		onClick: () => {
			widget.checkpointGraphFindOpen = false;
			widget.render();
		},
	});
}

function jumpGraphFind(widget: KnoxGuiWidget, state: IKnoxGuiState, delta: number): void {
	const headId = state.checkpointHeadId ?? activeHeadId(state.checkpointBranches);
	const displayNodes = withWorkingTreeNode(state.checkpoints, headId, state.checkpointWorkingTreePaths, t(state, 'checkpointGraph.workingTree'));
	const hits = graphFindHits(displayNodes, checkpointGraphHeadsById(state.checkpointBranches), widget.checkpointGraphFindQuery);
	if (!hits.length) {
		return;
	}
	widget.checkpointGraphFindIndex = (widget.checkpointGraphFindIndex + delta + hits.length) % hits.length;
	const id = displayNodes[hits[widget.checkpointGraphFindIndex] ?? 0]?.id;
	if (id && widget.checkpointGraphFindOpenDetails) {
		widget.checkpointGraphOpenId = id;
	}
	widget.render();
}

function renderGraphHeader(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, columns: string, _svgWidth: number): void {
	const header = DOM.append(parent, DOM.$('.knox-gui-graph-header'));
	header.setAttribute('role', 'row');
	header.style.gridTemplateColumns = columns;
	widget.listenerStore.add(DOM.addDisposableListener(header, 'contextmenu', e => {
		e.preventDefault();
		widget.checkpointGraphMenu = { x: e.clientX, y: e.clientY, kind: 'column' };
		widget.render();
	}));
	DOM.append(header, DOM.$('div')).setAttribute('role', 'columnheader');
	const desc = DOM.append(header, DOM.$('div.knox-gui-graph-col', undefined, t(state, 'checkpointGraph.columns.description')));
	desc.setAttribute('role', 'columnheader');
	for (const column of (['date', 'kind', 'id'] as const).filter(item => !state.checkpointGraphUi.hiddenColumns.includes(item))) {
		const cell = DOM.append(header, DOM.$('div.knox-gui-graph-col', undefined, t(state, `checkpointGraph.columns.${column}`)));
		cell.setAttribute('role', 'columnheader');
		const handle = DOM.append(cell, DOM.$('span.knox-gui-graph-resize'));
		handle.setAttribute('role', 'separator');
		handle.setAttribute('data-testid', `checkpoint-graph-resize-${column}`);
		widget.listenerStore.add(DOM.addDisposableListener(handle, 'mousedown', e => beginColumnResize(widget, state, column, e)));
	}
}

function beginColumnResize(widget: KnoxGuiWidget, state: IKnoxGuiState, column: KnoxCheckpointGraphColumn, event: MouseEvent): void {
	event.preventDefault();
	const startX = event.clientX;
	const start = state.checkpointGraphUi.columnWidths[column];
	const move = (ev: MouseEvent) => {
		const width = Math.max(48, start + ev.clientX - startX);
		widget.controller.store.patch({
			checkpointGraphUi: { ...widget.controller.store.state.checkpointGraphUi, columnWidths: { ...widget.controller.store.state.checkpointGraphUi.columnWidths, [column]: width } },
		});
	};
	const up = () => {
		window.removeEventListener('mousemove', move);
		window.removeEventListener('mouseup', up);
		void widget.controller.saveCheckpointGraphUi({ columnWidths: widget.controller.store.state.checkpointGraphUi.columnWidths });
	};
	window.addEventListener('mousemove', move);
	window.addEventListener('mouseup', up);
}

function renderGraphSvg(
	widget: KnoxGuiWidget,
	parent: HTMLElement,
	state: IKnoxGuiState,
	drawing: ReturnType<typeof drawCheckpointGraph>,
	displayNodes: readonly GraphNode[],
	heads: Map<string, IKnoxGuiCheckpointBranch[]>,
	headId: string | undefined,
	light: boolean,
): void {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('width', String(drawing.width));
	svg.setAttribute('height', String(drawing.height));
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('data-testid', 'checkpoint-graph-svg');
	svg.classList.add('knox-gui-graph-svg');
	parent.appendChild(svg);
	for (const path of drawing.paths) {
		const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		el.setAttribute('d', path.d);
		el.setAttribute('fill', 'none');
		el.setAttribute('stroke', remapCheckpointBranchColor(resolveCheckpointLaneColor(path.colorIndex, state.checkpointGraphUi.laneColors), light));
		el.setAttribute('stroke-width', '2');
		el.setAttribute('stroke-linecap', 'round');
		el.setAttribute('stroke-linejoin', 'round');
		svg.appendChild(el);
	}
	for (const vertex of drawing.vertices) {
		const color = remapCheckpointBranchColor(resolveCheckpointLaneColor(vertex.colorIndex, state.checkpointGraphUi.laneColors), light);
		const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
		circle.setAttribute('cx', String(vertex.cx));
		circle.setAttribute('cy', String(vertex.cy));
		circle.setAttribute('r', String(CHECKPOINT_GRAPH_VERTEX_RADIUS));
		circle.setAttribute('fill', vertex.current ? 'var(--vscode-editor-background, var(--background))' : color);
		circle.setAttribute('stroke', color);
		circle.setAttribute('stroke-width', vertex.current ? '2' : '0');
		circle.setAttribute('data-testid', 'checkpoint-graph-vertex');
		if (vertex.current) {
			circle.setAttribute('data-current', 'true');
		}
		circle.style.pointerEvents = 'auto';
		widget.listenerStore.add(DOM.addDisposableListener(circle, 'mouseenter', ev => {
			const node = displayNodes.find(item => item.id === vertex.id);
			if (!node) {
				return;
			}
			const names = (heads.get(node.id) ?? []).map(branch => branch.name);
			showGraphHover(widget, ev.clientX, ev.clientY, [
				node.id === headId
					? t(state, 'checkpointGraph.hoverCurrent', { branch: names.join(', ') || t(state, 'checkpointGraph.hoverNone') })
					: t(state, 'checkpointGraph.hoverOther'),
				t(state, 'checkpointGraph.hoverBranches', { names: names.length ? names.join(', ') : t(state, 'checkpointGraph.hoverNone') }),
				t(state, 'checkpointGraph.hoverTags', { tags: node.tags.length ? node.tags.join(', ') : t(state, 'checkpointGraph.hoverNone') }),
			]);
		}));
		widget.listenerStore.add(DOM.addDisposableListener(circle, 'mouseleave', () => hideGraphHover(widget)));
		widget.listenerStore.add(DOM.addDisposableListener(circle, 'click', () => clickGraphRow(widget, { metaKey: false, ctrlKey: false }, vertex.id)));
		svg.appendChild(circle);
	}
}

function showGraphHover(widget: KnoxGuiWidget, x: number, y: number, lines: string[]): void {
	hideGraphHover(widget);
	const tip = DOM.append(widget.root, DOM.$('.knox-gui-graph-hover'));
	tip.setAttribute('data-testid', 'checkpoint-graph-hover');
	tip.style.left = `${x + 8}px`;
	tip.style.top = `${y + 8}px`;
	for (const line of lines) {
		DOM.append(tip, DOM.$('div', undefined, line));
	}
}

function hideGraphHover(widget: KnoxGuiWidget): void {
	widget.root.querySelectorAll('.knox-gui-graph-hover').forEach(el => el.remove());
}

function renderGraphRow(
	widget: KnoxGuiWidget,
	parent: HTMLElement,
	state: IKnoxGuiState,
	opts: { node: GraphNode; top: number; columns: string; current: boolean; muted: boolean; found: boolean; open: boolean; branches: IKnoxGuiCheckpointBranch[]; light: boolean },
): void {
	const row = DOM.append(parent, DOM.$('.knox-gui-graph-row'));
	row.setAttribute('role', 'row');
	row.setAttribute('data-testid', 'checkpoint-graph-row');
	row.setAttribute('data-current', opts.current ? 'true' : 'false');
	row.setAttribute('data-open', opts.open ? 'true' : 'false');
	row.setAttribute('data-muted', opts.muted ? 'true' : 'false');
	row.setAttribute('data-find', opts.found ? 'true' : 'false');
	row.setAttribute('aria-expanded', String(opts.open));
	if (opts.current) {
		row.classList.add('current');
	}
	if (opts.muted) {
		row.classList.add('muted');
	}
	if (opts.found) {
		row.classList.add('found');
	}
	row.style.height = `${CHECKPOINT_GRAPH_ROW_HEIGHT}px`;
	row.style.transform = `translateY(${opts.top}px)`;
	row.style.gridTemplateColumns = opts.columns;
	widget.listenerStore.add(DOM.addDisposableListener(row, 'click', e => clickGraphRow(widget, e, opts.node.id)));
	widget.listenerStore.add(DOM.addDisposableListener(row, 'contextmenu', e => {
		e.preventDefault();
		widget.checkpointGraphMenu = { x: e.clientX, y: e.clientY, kind: 'row', nodeId: opts.node.id };
		widget.render();
	}));
	DOM.append(row, DOM.$('div')).setAttribute('role', 'cell');
	const desc = DOM.append(row, DOM.$('div.knox-gui-graph-desc'));
	desc.setAttribute('role', 'cell');
	for (const branch of opts.branches) {
		const chip = DOM.append(desc, DOM.$('span.knox-gui-graph-branch', undefined, branch.name));
		chip.setAttribute('data-testid', 'checkpoint-graph-branch');
		chip.setAttribute('data-active', branch.isActive ? 'true' : 'false');
		chip.title = branch.name;
		if (branch.isActive) {
			const color = remapCheckpointBranchColor(branch.color || checkpointGraphLaneColor(0), opts.light);
			chip.style.color = color;
			chip.style.borderColor = color;
			chip.classList.add('active');
		}
		widget.listenerStore.add(DOM.addDisposableListener(chip, 'contextmenu', e => {
			e.preventDefault();
			e.stopPropagation();
			widget.checkpointGraphMenu = { x: e.clientX, y: e.clientY, kind: 'branch', branchId: branch.id };
			widget.render();
		}));
	}
	for (const tag of opts.node.tags) {
		const chip = DOM.append(desc, DOM.$('span.knox-gui-graph-tag', undefined, tag));
		chip.setAttribute('data-testid', 'checkpoint-graph-tag');
		chip.title = tag;
		widget.listenerStore.add(DOM.addDisposableListener(chip, 'contextmenu', e => {
			e.preventDefault();
			e.stopPropagation();
			widget.checkpointGraphMenu = { x: e.clientX, y: e.clientY, kind: 'tag', nodeId: opts.node.id, tag };
			widget.render();
		}));
	}
	const title = DOM.append(desc, DOM.$('span.knox-gui-graph-title', undefined, opts.node.description));
	title.title = opts.node.description;
	const when = formatCheckpointGraphTime(opts.node.created);
	if (!state.checkpointGraphUi.hiddenColumns.includes('date')) {
		const cell = DOM.append(row, DOM.$('div.knox-gui-muted', undefined, state.checkpointGraphUi.dateStyle === 'absolute' || !when.relativeKey ? when.absolute : t(state, when.relativeKey, when.count != null ? { count: when.count } : undefined)));
		cell.setAttribute('role', 'cell');
		cell.title = when.absolute;
	}
	if (!state.checkpointGraphUi.hiddenColumns.includes('kind')) {
		const cell = DOM.append(row, DOM.$('div'));
		cell.setAttribute('role', 'cell');
		if (opts.node.workingTree) {
			DOM.append(cell, DOM.$('span.knox-gui-muted', undefined, t(state, 'checkpointGraph.workingTree')));
		} else {
			DOM.append(cell, DOM.$(`span.knox-gui-cp-kind.${checkpointKindClass(opts.node.kind)}`, undefined, t(state, checkpointKindI18nKey(opts.node.kind))));
		}
	}
	if (!state.checkpointGraphUi.hiddenColumns.includes('id')) {
		const cell = DOM.append(row, DOM.$('div.knox-gui-mono', undefined, opts.node.shortId));
		cell.setAttribute('role', 'cell');
		if (!opts.node.workingTree) {
			cell.title = opts.node.id;
		}
	}
}

function renderGraphDetails(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, node: GraphNode, top: number, left: number, docked: boolean): void {
	const panel = DOM.append(parent, DOM.$(docked ? '.knox-gui-graph-details.docked' : '.knox-gui-graph-details'));
	panel.setAttribute('data-testid', 'checkpoint-graph-details');
	if (!docked) {
		panel.style.top = `${top}px`;
		panel.style.left = `${left}px`;
		panel.style.height = `${CHECKPOINT_GRAPH_DETAILS_HEIGHT}px`;
	}
	widget.listenerStore.add(DOM.addDisposableListener(panel, 'click', e => e.stopPropagation()));
	const when = formatCheckpointGraphTime(node.created);
	const dl = DOM.append(panel, DOM.$('dl.knox-gui-graph-dl'));
	addDetail(dl, t(state, 'checkpointGraph.details.description'), node.description);
	addDetail(dl, t(state, 'checkpointGraph.details.id'), node.workingTree ? t(state, 'checkpointGraph.hoverNone') : node.id);
	const kindDd = addDetail(dl, t(state, 'checkpointGraph.details.kind'), '');
	DOM.append(kindDd, DOM.$(`span.knox-gui-cp-kind.${node.workingTree ? '' : checkpointKindClass(node.kind)}`, undefined, node.workingTree ? t(state, 'checkpointGraph.workingTree') : t(state, checkpointKindI18nKey(node.kind))));
	DOM.append(kindDd, DOM.$('span.knox-gui-muted', undefined, t(state, 'checkpointGraph.details.tags')));
	DOM.append(kindDd, DOM.$('span', undefined, node.tags.length ? node.tags.join(', ') : t(state, 'checkpointGraph.details.noTags')));
	DOM.append(kindDd, DOM.$('span.knox-gui-muted', undefined, t(state, 'checkpointGraph.details.session')));
	DOM.append(kindDd, DOM.$('span.knox-gui-mono', undefined, node.sessionId || t(state, 'checkpointGraph.details.noSession')));
	const created = addDetail(dl, t(state, 'checkpointGraph.details.created'), when.absolute);
	DOM.append(created, DOM.$('span.knox-gui-muted', undefined, t(state, 'checkpointGraph.details.changes')));
	DOM.append(created, DOM.$('span', undefined, t(state, 'checkpointGraph.details.added', { count: node.fileChanges.added })));
	DOM.append(created, DOM.$('span', undefined, t(state, 'checkpointGraph.details.modified', { count: node.fileChanges.modified })));
	DOM.append(created, DOM.$('span', undefined, t(state, 'checkpointGraph.details.deleted', { count: node.fileChanges.deleted })));
	const filesHead = DOM.append(panel, DOM.$('.knox-gui-graph-files-head'));
	DOM.append(filesHead, DOM.$('h2', undefined, t(state, 'checkpointGraph.details.files')));
	widget.chromeButton(filesHead, {
		label: t(state, 'checkpointGraph.details.list'),
		selected: state.checkpointGraphUi.fileView === 'list',
		testId: 'checkpoint-graph-file-list',
		onClick: () => void widget.controller.saveCheckpointGraphUi({ fileView: 'list' }),
	});
	widget.chromeButton(filesHead, {
		label: t(state, 'checkpointGraph.details.tree'),
		selected: state.checkpointGraphUi.fileView === 'tree',
		testId: 'checkpoint-graph-view-tree',
		onClick: () => void widget.controller.saveCheckpointGraphUi({ fileView: 'tree' }),
	});
	const comparing = Boolean(widget.checkpointGraphCompare && widget.checkpointGraphOpenId === node.id);
	const paths = comparing ? widget.checkpointGraphComparePaths : node.changedPaths;
	const error = comparing ? widget.checkpointGraphCompareError : null;
	if (error) {
		DOM.append(panel, DOM.$('p.knox-gui-muted', undefined, t(state, error)));
	}
	if (paths === null) {
		DOM.append(panel, DOM.$('p.knox-gui-muted', undefined, t(state, 'checkpointGraph.loading')));
	} else if (!paths.length) {
		DOM.append(panel, DOM.$('p.knox-gui-muted', undefined, t(state, 'checkpointGraph.details.noFiles')));
	} else if (state.checkpointGraphUi.fileView === 'tree') {
		const tree = DOM.append(panel, DOM.$('ul.knox-gui-graph-file-tree'));
		tree.setAttribute('data-testid', 'checkpoint-graph-file-tree');
		renderPathTree(widget, state, tree, buildCheckpointPathTree(paths), node, 0);
	} else {
		const list = DOM.append(panel, DOM.$('ul.knox-gui-graph-files'));
		for (const path of paths) {
			const item = DOM.append(list, DOM.$('li'));
			const btn = DOM.append(item, DOM.$('button.knox-gui-graph-path', undefined, path)) as HTMLButtonElement;
			btn.type = 'button';
			btn.setAttribute('data-testid', 'checkpoint-graph-path');
			btn.title = path;
			widget.listenerStore.add(DOM.addDisposableListener(btn, 'click', () => openGraphPath(widget, state, node, path)));
			widget.listenerStore.add(DOM.addDisposableListener(btn, 'contextmenu', e => {
				e.preventDefault();
				e.stopPropagation();
				widget.checkpointGraphMenu = { x: e.clientX, y: e.clientY, kind: 'file', nodeId: node.id, path };
				widget.render();
			}));
		}
	}
}

function addDetail(dl: HTMLElement, label: string, value: string): HTMLElement {
	DOM.append(dl, DOM.$('dt.knox-gui-muted', undefined, label));
	return DOM.append(dl, DOM.$('dd', undefined, value));
}

function renderPathTree(widget: KnoxGuiWidget, state: IKnoxGuiState, parent: HTMLElement, nodes: CheckpointGraphPathTreeNode[], graphNode: GraphNode, depth: number): void {
	for (const node of nodes) {
		const item = DOM.append(parent, DOM.$('li'));
		if (node.children.length) {
			const open = widget.checkpointGraphExpandedFolders.has(node.path) || !widget.checkpointGraphExpandedFolders.size;
			const toggle = DOM.append(item, DOM.$('button.knox-gui-muted', undefined, `${open ? '▾' : '▸'} ${node.name}`)) as HTMLButtonElement;
			toggle.type = 'button';
			toggle.style.paddingLeft = `${depth * 12}px`;
			widget.listenerStore.add(DOM.addDisposableListener(toggle, 'click', () => {
				if (widget.checkpointGraphExpandedFolders.has(node.path)) {
					widget.checkpointGraphExpandedFolders.delete(node.path);
				} else {
					widget.checkpointGraphExpandedFolders.add(node.path);
				}
				widget.render();
			}));
			if (open) {
				const nested = DOM.append(item, DOM.$('ul'));
				renderPathTree(widget, state, nested, node.children, graphNode, depth + 1);
			}
		}
		if (node.file) {
			const btn = DOM.append(item, DOM.$('button.knox-gui-graph-path', undefined, node.name)) as HTMLButtonElement;
			btn.type = 'button';
			btn.setAttribute('data-testid', 'checkpoint-graph-path');
			btn.title = node.path;
			btn.style.paddingLeft = `${(depth + (node.children.length ? 1 : 0)) * 12}px`;
			widget.listenerStore.add(DOM.addDisposableListener(btn, 'click', () => openGraphPath(widget, state, graphNode, node.path)));
			widget.listenerStore.add(DOM.addDisposableListener(btn, 'contextmenu', e => {
				e.preventDefault();
				e.stopPropagation();
				widget.checkpointGraphMenu = { x: e.clientX, y: e.clientY, kind: 'file', nodeId: graphNode.id, path: node.path };
				widget.render();
			}));
		}
	}
}

function openGraphPath(widget: KnoxGuiWidget, state: IKnoxGuiState, node: GraphNode, path: string): void {
	const checkpointId = node.workingTree ? (state.checkpointHeadId ?? activeHeadId(state.checkpointBranches)) : node.id;
	if (!checkpointId) {
		return;
	}
	const compare = node.workingTree ? { kind: 'workspace' as const } : widget.checkpointGraphCompare ?? undefined;
	widget.controller.messenger.post('openCheckpointFileDiff', {
		checkpointId,
		relativePath: path,
		compareToCheckpointId: compare?.kind === 'checkpoint' ? compare.id : undefined,
		compareToWorkspace: compare?.kind === 'workspace',
	});
}

function renderGraphMenu(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, displayNodes: readonly GraphNode[]): void {
	const menu = widget.checkpointGraphMenu;
	if (!menu) {
		return;
	}
	const entries = graphMenuEntries(widget, state, displayNodes, menu);
	const backdrop = DOM.append(parent, DOM.$('button.knox-gui-graph-menu-backdrop')) as HTMLButtonElement;
	backdrop.type = 'button';
	backdrop.setAttribute('aria-label', t(state, 'checkpointGraph.findClose'));
	widget.listenerStore.add(DOM.addDisposableListener(backdrop, 'click', () => {
		widget.checkpointGraphMenu = null;
		widget.render();
	}));
	const panel = DOM.append(parent, DOM.$('.knox-gui-graph-menu'));
	panel.setAttribute('role', 'menu');
	panel.setAttribute('data-testid', 'checkpoint-graph-menu');
	panel.style.left = `${menu.x}px`;
	panel.style.top = `${menu.y}px`;
	for (const entry of entries) {
		if (entry.kind === 'divider') {
			DOM.append(panel, DOM.$('.knox-gui-graph-menu-sep'));
			continue;
		}
		const btn = DOM.append(panel, DOM.$('button.knox-gui-graph-menu-item')) as HTMLButtonElement;
		btn.type = 'button';
		btn.setAttribute('role', 'menuitem');
		DOM.append(btn, DOM.$('span', undefined, entry.label));
		if (entry.detail) {
			DOM.append(btn, DOM.$('span.knox-gui-muted', undefined, entry.detail));
		}
		widget.listenerStore.add(DOM.addDisposableListener(btn, 'click', () => {
			widget.checkpointGraphMenu = null;
			entry.run();
			widget.render();
		}));
	}
}

function graphMenuEntries(
	widget: KnoxGuiWidget,
	state: IKnoxGuiState,
	displayNodes: readonly GraphNode[],
	menu: NonNullable<KnoxGuiWidget['checkpointGraphMenu']>,
): Array<{ kind: 'action'; id: string; label: string; detail?: string; run: () => void } | { kind: 'divider'; id: string }> {
	if (menu.kind === 'column') {
		return (['date', 'kind', 'id'] as const).map(column => ({
			kind: 'action' as const,
			id: column,
			label: t(state, state.checkpointGraphUi.hiddenColumns.includes(column) ? `checkpointGraph.columns.show.${column}` : `checkpointGraph.columns.hide.${column}`),
			run: () => {
				const hidden = state.checkpointGraphUi.hiddenColumns.includes(column)
					? state.checkpointGraphUi.hiddenColumns.filter(item => item !== column)
					: [...state.checkpointGraphUi.hiddenColumns, column];
				void widget.controller.saveCheckpointGraphUi({ hiddenColumns: hidden });
			},
		}));
	}
	if (menu.kind === 'row') {
		const node = displayNodes.find(item => item.id === menu.nodeId);
		if (!node) {
			return [];
		}
		if (node.workingTree) {
			const headId = state.checkpointHeadId ?? activeHeadId(state.checkpointBranches);
			return [
				{ kind: 'action', id: 'create', label: t(state, 'checkpointGraph.menu.createCheckpoint'), run: () => widget.controller.messenger.post('runCheckpointGraphAction', { action: 'createCheckpoint' }) },
				...(headId ? [
					{ kind: 'divider' as const, id: 'd-reset' },
					{ kind: 'action' as const, id: 'resetTree', label: t(state, 'checkpointGraph.menu.resetWorkingTree'), run: () => { widget.checkpointGraphPrompt = { kind: 'resetTree', checkpointId: headId }; } },
				] : []),
			];
		}
		return [
			{ kind: 'action', id: 'restore', label: t(state, 'checkpointGraph.menu.restore'), run: () => void widget.controller.openRestorePreview(node.id, false) },
			{ kind: 'action', id: 'restoreFiles', label: t(state, 'checkpointGraph.menu.restoreFiles'), run: () => void widget.controller.openRestorePreview(node.id, false) },
			{ kind: 'action', id: 'restoreMemory', label: t(state, 'checkpointGraph.menu.restoreMemory'), run: () => void widget.controller.openRestorePreview(node.id, true) },
			{ kind: 'divider', id: 'd1' },
			{ kind: 'action', id: 'diffWorkspace', label: t(state, 'checkpointGraph.menu.diffWorkspace'), run: () => { widget.checkpointGraphOpenId = node.id; widget.checkpointGraphCompare = { kind: 'workspace' }; } },
			{ kind: 'action', id: 'compare', label: t(state, 'checkpointGraph.menu.compare'), run: () => { widget.checkpointGraphOpenId = node.id; widget.checkpointGraphArmCompare = true; } },
			{ kind: 'divider', id: 'd2' },
			{ kind: 'action', id: 'branch', label: t(state, 'checkpointGraph.menu.createBranch'), run: () => { widget.checkpointGraphPrompt = { kind: 'branch', baseId: node.id }; widget.checkpointGraphPromptValue = ''; } },
			{ kind: 'action', id: 'addTag', label: t(state, 'checkpointGraph.menu.addTag'), run: () => { widget.checkpointGraphPrompt = { kind: 'addTag', checkpointId: node.id }; widget.checkpointGraphPromptValue = ''; } },
			{ kind: 'divider', id: 'd3' },
			{ kind: 'action', id: 'pin', label: t(state, node.pinned ? 'checkpointGraph.menu.unpin' : 'checkpointGraph.menu.pin'), run: () => void widget.controller.pinCheckpoint(node.id, !node.pinned) },
			{ kind: 'action', id: 'copyId', label: t(state, 'checkpointGraph.menu.copyId'), run: () => widget.controller.messenger.post('copyText', { text: node.id }) },
			{ kind: 'action', id: 'copyDescription', label: t(state, 'checkpointGraph.menu.copyDescription'), run: () => widget.controller.messenger.post('copyText', { text: node.description }) },
			{ kind: 'action', id: 'export', label: t(state, 'checkpointGraph.menu.export'), run: () => widget.controller.messenger.post('exportCheckpoint', { checkpointId: node.id }) },
			{ kind: 'divider', id: 'd4' },
			{ kind: 'action', id: 'delete', label: t(state, 'checkpointGraph.menu.delete'), run: () => { widget.checkpointGraphPrompt = { kind: 'delete', id: node.id }; } },
		];
	}
	if (menu.kind === 'file' && menu.path && menu.nodeId) {
		const node = displayNodes.find(item => item.id === menu.nodeId);
		if (!node) {
			return [];
		}
		const comparing = Boolean(widget.checkpointGraphCompare);
		const path = menu.path;
		const entries: Array<{ kind: 'action'; id: string; label: string; run: () => void } | { kind: 'divider'; id: string }> = [
			{ kind: 'action', id: 'viewDiff', label: t(state, 'checkpointGraph.menu.viewDiff'), run: () => openGraphPath(widget, state, node, path) },
		];
		if (!node.workingTree) {
			entries.push({ kind: 'action', id: 'viewAtRevision', label: t(state, 'checkpointGraph.menu.viewAtRevision'), run: () => widget.controller.messenger.post('openCheckpointFileAtRevision', { checkpointId: node.id, relativePath: path }) });
			if (!comparing) {
				entries.push({ kind: 'action', id: 'diffWorking', label: t(state, 'checkpointGraph.menu.diffWorking'), run: () => widget.controller.messenger.post('openCheckpointFileDiff', { checkpointId: node.id, relativePath: path, compareToWorkspace: true }) });
			}
		}
		entries.push({ kind: 'action', id: 'openFile', label: t(state, 'checkpointGraph.menu.openFile'), run: () => widget.controller.messenger.post('openCheckpointWorkingFile', { relativePath: path }) });
		if (!node.workingTree && !comparing) {
			entries.push({ kind: 'divider', id: 'd-reset' });
			entries.push({ kind: 'action', id: 'resetFile', label: t(state, 'checkpointGraph.menu.resetFile'), run: () => { widget.checkpointGraphPrompt = { kind: 'resetFile', checkpointId: node.id, path }; } });
		}
		entries.push(
			{ kind: 'divider', id: 'd-copy' },
			{ kind: 'action', id: 'copyRelative', label: t(state, 'checkpointGraph.menu.copyRelativePath'), run: () => widget.controller.messenger.post('copyCheckpointFilePath', { relativePath: path, absolute: false }) },
			{ kind: 'action', id: 'copyAbsolute', label: t(state, 'checkpointGraph.menu.copyAbsolutePath'), run: () => widget.controller.messenger.post('copyCheckpointFilePath', { relativePath: path, absolute: true }) },
		);
		return entries;
	}
	if (menu.kind === 'branch' && menu.branchId) {
		const branch = state.checkpointBranches.find(item => item.id === menu.branchId);
		if (!branch) {
			return [];
		}
		const filter = checkpointGraphFilterFromUi(state.checkpointGraphUi);
		const filtered = checkpointBranchIsFiltered(branch, filter);
		const entries: Array<{ kind: 'action'; id: string; label: string; detail?: string; run: () => void }> = [];
		if (!branch.isActive) {
			entries.push({ kind: 'action', id: 'switch', label: t(state, 'checkpointGraph.menu.switchBranch'), detail: t(state, 'checkpointGraph.menu.switchHint'), run: () => void widget.controller.switchCheckpointBranch(branch.id) });
			if (state.checkpointBranches.some(item => item.isActive)) {
				const target = state.checkpointBranches.find(item => item.isActive);
				entries.push({ kind: 'action', id: 'merge', label: t(state, 'checkpointGraph.menu.merge'), run: () => { if (target) { widget.checkpointGraphPrompt = { kind: 'merge', sourceId: branch.id, targetId: target.id }; } } });
			}
		}
		if (!branch.isActive && branch.name !== 'main') {
			entries.push({ kind: 'action', id: 'delete', label: t(state, 'checkpointGraph.menu.deleteBranch'), run: () => void (async () => {
				const response = await widget.controller.messenger.request<{ success?: boolean; message?: string }>('deleteCheckpointBranch', { branchId: branch.id });
				if (response && response.success === false && response.message) {
					widget.checkpointGraphPrompt = { kind: 'notice', message: response.message };
					widget.render();
				} else {
					void widget.controller.loadCheckpoints();
				}
			})() });
		}
		entries.push({ kind: 'action', id: 'rename', label: t(state, 'checkpointGraph.menu.renameBranch'), run: () => { widget.checkpointGraphPrompt = { kind: 'rename', branchId: branch.id, name: branch.name }; widget.checkpointGraphPromptValue = branch.name; } });
		entries.push({
			kind: 'action',
			id: filtered ? 'unselect' : 'select',
			label: t(state, filtered ? 'checkpointGraph.menu.unselectBranch' : 'checkpointGraph.menu.selectBranch'),
			run: () => void widget.controller.setCheckpointBranchFilter(checkpointFilterAfterBranchToggle(branch, filter, state.checkpointBranches)),
		});
		entries.push({ kind: 'action', id: 'copy', label: t(state, 'checkpointGraph.menu.copyBranch'), run: () => widget.controller.messenger.post('copyText', { text: branch.name }) });
		return entries;
	}
	if (menu.kind === 'tag' && menu.tag && menu.nodeId) {
		const tag = menu.tag;
		const checkpointId = menu.nodeId;
		return [
			{ kind: 'action', id: 'copy', label: t(state, 'checkpointGraph.menu.copyTag'), run: () => widget.controller.messenger.post('copyText', { text: tag }) },
			{ kind: 'action', id: 'delete', label: t(state, 'checkpointGraph.menu.deleteTag'), run: () => { widget.checkpointGraphPrompt = { kind: 'deleteTag', checkpointId, tag }; } },
		];
	}
	return [];
}

function renderGraphPrompt(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const prompt = widget.checkpointGraphPrompt;
	if (!prompt) {
		return;
	}
	if (prompt.kind === 'notice') {
		const dialog = widget.modal(parent, 'checkpoint-graph-dialog');
		DOM.append(dialog, DOM.$('h2', undefined, t(state, 'checkpointGraph.conflictsTitle')));
		const list = DOM.append(dialog, DOM.$('ul.knox-gui-mono'));
		for (const path of (prompt.message ?? '').split('\n').filter(Boolean)) {
			DOM.append(list, DOM.$('li', undefined, path));
		}
		widget.chromeButton(dialog, { label: t(state, 'checkpointGraph.findClose'), onClick: () => { widget.checkpointGraphPrompt = null; widget.render(); } });
		return;
	}
	const titles: Record<Exclude<typeof prompt.kind, 'notice'>, string> = {
		delete: t(state, 'checkpointGraph.deleteTitle'),
		branch: t(state, 'checkpointGraph.createBranchTitle'),
		merge: t(state, 'checkpointGraph.mergeTitle'),
		resetFile: t(state, 'checkpointGraph.resetFileTitle'),
		resetTree: t(state, 'checkpointGraph.resetWorkingTreeTitle'),
		rename: t(state, 'checkpointGraph.renameBranchTitle'),
		addTag: t(state, 'checkpointGraph.addTagTitle'),
		deleteTag: t(state, 'checkpointGraph.deleteTagTitle'),
	};
	const bodies: Partial<Record<Exclude<typeof prompt.kind, 'notice'>, string>> = {
		delete: t(state, 'checkpointGraph.deleteBody'),
		merge: t(state, 'checkpointGraph.mergeBody'),
		resetFile: t(state, 'checkpointGraph.resetFileBody', { path: prompt.path ?? '' }),
		resetTree: t(state, 'checkpointGraph.resetWorkingTreeBody'),
		deleteTag: t(state, 'checkpointGraph.deleteTagBody', { tag: prompt.tag ?? '' }),
	};
	const confirmLabels: Record<Exclude<typeof prompt.kind, 'notice'>, string> = {
		delete: t(state, 'checkpointGraph.menu.delete'),
		branch: t(state, 'checkpointGraph.menu.createBranch'),
		merge: t(state, 'checkpointGraph.menu.merge'),
		resetFile: t(state, 'checkpointGraph.menu.resetFile'),
		resetTree: t(state, 'checkpointGraph.menu.resetWorkingTree'),
		rename: t(state, 'checkpointGraph.menu.renameBranch'),
		addTag: t(state, 'checkpointGraph.menu.addTag'),
		deleteTag: t(state, 'checkpointGraph.menu.deleteTag'),
	};
	const needsValue = prompt.kind === 'branch' || prompt.kind === 'rename' || prompt.kind === 'addTag';
	const dialog = widget.modal(parent, 'checkpoint-graph-dialog');
	DOM.append(dialog, DOM.$('h2', undefined, titles[prompt.kind]));
	const bodyText = bodies[prompt.kind];
	if (bodyText) {
		DOM.append(dialog, DOM.$('p.knox-gui-muted', undefined, bodyText));
	}
	let input: HTMLInputElement | undefined;
	if (needsValue) {
		input = DOM.append(dialog, DOM.$('input')) as HTMLInputElement;
		input.value = widget.checkpointGraphPromptValue || prompt.name || '';
		input.setAttribute('aria-label', titles[prompt.kind]);
		widget.listenerStore.add(DOM.addDisposableListener(input, 'input', () => { widget.checkpointGraphPromptValue = input!.value; }));
	}
	const actions = DOM.append(dialog, DOM.$('.knox-gui-row'));
	widget.chromeButton(actions, { label: t(state, 'checkpointGraph.cancel'), onClick: () => { widget.checkpointGraphPrompt = null; widget.render(); } });
	widget.chromeButton(actions, {
		label: confirmLabels[prompt.kind],
		onClick: () => {
			const value = (input?.value ?? widget.checkpointGraphPromptValue).trim();
			const current = widget.checkpointGraphPrompt;
			widget.checkpointGraphPrompt = null;
			if (!current) {
				widget.render();
				return;
			}
			runGraphPrompt(widget, current, value);
			widget.render();
		},
	});
}

function runGraphPrompt(widget: KnoxGuiWidget, prompt: NonNullable<KnoxGuiWidget['checkpointGraphPrompt']>, value: string): void {
	if (prompt.kind === 'delete' && prompt.id) {
		void widget.controller.deleteSelectedCheckpoints([prompt.id]);
		if (widget.checkpointGraphOpenId === prompt.id) {
			widget.checkpointGraphOpenId = null;
		}
		return;
	}
	if (prompt.kind === 'branch' && prompt.baseId && value) {
		void widget.controller.createCheckpointBranch(value, prompt.baseId);
		return;
	}
	if (prompt.kind === 'merge' && prompt.sourceId && prompt.targetId) {
		void (async () => {
			const response = await widget.controller.messenger.request<{ success?: boolean; message?: string; conflicts?: Array<{ path?: string }> }>('mergeCheckpointBranches', {
				sourceBranchId: prompt.sourceId,
				targetBranchId: prompt.targetId,
			});
			if (response?.conflicts?.length) {
				widget.checkpointGraphPrompt = { kind: 'notice', message: response.conflicts.map(conflict => conflict.path ?? '').filter(Boolean).join('\n') };
				widget.render();
				return;
			}
			if (response && response.success === false && response.message) {
				widget.checkpointGraphPrompt = { kind: 'notice', message: response.message };
				widget.render();
				return;
			}
			void widget.controller.loadCheckpoints();
		})();
		return;
	}
	if (prompt.kind === 'resetFile' && prompt.checkpointId && prompt.path) {
		widget.controller.messenger.post('restoreCheckpointFiles', { checkpointId: prompt.checkpointId, relativePaths: [prompt.path] });
		return;
	}
	if (prompt.kind === 'resetTree' && prompt.checkpointId) {
		widget.controller.messenger.post('restoreCheckpoint', { checkpointId: prompt.checkpointId, rewindMemory: false });
		return;
	}
	if (prompt.kind === 'rename' && prompt.branchId && value) {
		void (async () => {
			const response = await widget.controller.messenger.request<{ success?: boolean; message?: string }>('renameCheckpointBranch', { branchId: prompt.branchId, name: value });
			if (response && response.success === false && response.message) {
				widget.checkpointGraphPrompt = { kind: 'notice', message: response.message };
				widget.render();
			} else {
				void widget.controller.loadCheckpoints();
			}
		})();
		return;
	}
	if (prompt.kind === 'addTag' && prompt.checkpointId && value) {
		void (async () => {
			const response = await widget.controller.messenger.request<{ success?: boolean; message?: string }>('setCheckpointTag', { checkpointId: prompt.checkpointId, tag: value, present: true });
			if (response && response.success === false && response.message) {
				widget.checkpointGraphPrompt = { kind: 'notice', message: response.message };
				widget.render();
			} else {
				void widget.controller.loadCheckpoints();
			}
		})();
		return;
	}
	if (prompt.kind === 'deleteTag' && prompt.checkpointId && prompt.tag) {
		void (async () => {
			const response = await widget.controller.messenger.request<{ success?: boolean; message?: string }>('setCheckpointTag', { checkpointId: prompt.checkpointId, tag: prompt.tag, present: false });
			if (response && response.success === false && response.message) {
				widget.checkpointGraphPrompt = { kind: 'notice', message: response.message };
				widget.render();
			} else {
				void widget.controller.loadCheckpoints();
			}
		})();
	}
}
