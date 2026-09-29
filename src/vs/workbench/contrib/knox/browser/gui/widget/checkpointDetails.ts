/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../knoxGuiWidget.js';
import { t } from './t.js';
import * as DOM from '../../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { appendKnoxGuiSvg } from '../knoxGuiIcons.js';
import { checkpointButton, checkpointDialogClose, checkpointDialogHeader, checkpointSelect } from './checkpoints/primitives.js';
import {
	buildCheckpointFileTree,
	checkpointDetailsDefaultTab,
	checkpointImageMime,
	checkpointTreeAncestors,
	clampCheckpointTreeWidth,
	compareCheckpointTargets,
	CHECKPOINT_TREE_WIDTH,
	diffFromCheckpointSnapshots,
	formatSnapshotSize,
	parseCheckpointDetails,
	parseCheckpointDiff,
	type IKnoxGuiCheckpointDetails,
	type IKnoxGuiCheckpointDetailsSnapshot,
	type IKnoxGuiCheckpointDetailsView,
	type IKnoxGuiCheckpointFileTreeNode,
	type KnoxCheckpointDetailsTab,
} from '../../../common/knoxGuiCheckpoints.js';
import { languageIdFromFence } from '../../../common/knoxGuiTranscript.js';
import { IKnoxGuiState } from '../../../common/knoxGuiState.js';

const TREE_EXPANDED_KEY = 'knox.gui.checkpointFileTreeExpanded';
const TREE_WIDTH_KEY = 'knox.gui.checkpointFileTreeWidth';

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

export async function openCheckpointDetails(widget: KnoxGuiWidget, checkpointId: string): Promise<void> {
	if (widget.checkpointDetails?.loading) {
		return;
	}
	const view: IKnoxGuiCheckpointDetailsView = {
		id: checkpointId,
		loading: true,
		tab: 'basic',
		expandedDirs: new Set(),
		compareTarget: 'previous',
		diffLoading: false,
		diffSeq: 0,
		wrap: false,
		copied: false,
	};
	widget.checkpointDetails = view;
	widget.render();
	try {
		const details = parseCheckpointDetails(await widget.controller.messenger.request<unknown>('getCheckpointDetails', { checkpointId }));
		if (widget.checkpointDetails !== view) {
			return;
		}
		if (!details) {
			widget.checkpointDetails = null;
			widget.render();
			return;
		}
		view.loading = false;
		view.details = details;
		view.tab = checkpointDetailsDefaultTab(details);
		const first = details.fileSnapshots[0];
		if (first) {
			view.selectedFile = first.relativePath;
			view.expandedDirs = new Set(checkpointTreeAncestors(first.relativePath));
		}
		widget.render();
		void loadCheckpointDetailsDiff(widget, view, 'previous');
	} catch {
		if (widget.checkpointDetails === view) {
			widget.checkpointDetails = null;
			widget.render();
		}
	}
}

/**
 * `CheckpointTableRow.tsx` `loadDiff`: the host reconstructs both sides;
 * `getPreviousCheckpoint` raw snapshots are the fallback for non-workspace
 * targets (K-12).
 */
export async function loadCheckpointDetailsDiff(widget: KnoxGuiWidget, view: IKnoxGuiCheckpointDetailsView, target: string): Promise<void> {
	const seq = ++view.diffSeq;
	view.compareTarget = target;
	view.diffLoading = true;
	view.diff = undefined;
	widget.render();
	const current = () => widget.checkpointDetails === view && view.diffSeq === seq;
	const fallback = async () => {
		if (target === 'workspace' || !view.details) {
			return;
		}
		try {
			const previous = parseCheckpointDetails(await widget.controller.messenger.request<unknown>('getPreviousCheckpoint', { checkpointId: view.id }));
			if (current() && previous) {
				view.diff = diffFromCheckpointSnapshots(previous, view.details);
			}
		} catch {
			// no fallback
		}
	};
	try {
		const payload = target === 'workspace'
			? { checkpointId: view.id, compareToWorkspace: true }
			: target !== 'previous'
				? { checkpointId: view.id, compareToCheckpointId: target }
				: { checkpointId: view.id };
		const result = asRecord(await widget.controller.messenger.request<unknown>('computeCheckpointDiff', payload));
		if (!current()) {
			return;
		}
		const raw = asRecord(result?.diff);
		if (result?.success && raw) {
			if (raw.oldCheckpoint) {
				const diff = parseCheckpointDiff(result);
				if (diff && target === 'workspace') {
					diff.newCheckpoint.description = t(widget.controller.store.state, 'currentWorkspaceOption');
				}
				view.diff = diff;
				widget.controller.store.patch({ checkpointDiffSelectedFile: diff?.files[0]?.relativePath });
			}
		} else {
			await fallback();
		}
	} catch {
		await fallback();
	} finally {
		if (current()) {
			view.diffLoading = false;
			widget.render();
		}
	}
}

function closeDetails(widget: KnoxGuiWidget): void {
	widget.checkpointDetails = null;
	widget.render();
}

export function renderCheckpointDetailsDialog(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
	const view = widget.checkpointDetails;
	const details = view?.details;
	if (!view || !details) {
		return;
	}
	const overlay = DOM.append(parent, DOM.$('.knox-gui-text-dialog.knox-gui-checkpoint-details-overlay'));
	overlay.setAttribute('data-testid', 'knox-gui-checkpoint-details');
	overlay.setAttribute('role', 'presentation');
	widget.renderStore.add(DOM.addDisposableListener(overlay, 'click', () => closeDetails(widget)));
	const panel = DOM.append(overlay, DOM.$('.knox-gui-checkpoint-details-panel'));
	panel.setAttribute('role', 'dialog');
	panel.setAttribute('aria-modal', 'true');
	widget.renderStore.add(DOM.addDisposableListener(panel, 'click', e => e.stopPropagation()));
	checkpointDialogClose(widget, panel, t(state, 'close'), () => closeDetails(widget), '.knox-gui-checkpoint-details-close');
	checkpointDialogHeader(panel, t(state, 'checkpointDetails'), 'info').classList.add('knox-gui-checkpoint-details-head');
	const fileCount = details.fileSnapshots.length;
	const tabs = DOM.append(panel, DOM.$('.knox-gui-checkpoint-details-tabs'));
	tabs.setAttribute('role', 'tablist');
	const tabDefs: Array<{ id: KnoxCheckpointDetailsTab; svg: 'hash' | 'file' | 'git-compare'; full: string; short: string; disabled: boolean }> = [
		{ id: 'basic', svg: 'hash', full: t(state, 'basicInformation'), short: t(state, 'basic'), disabled: false },
		{ id: 'files', svg: 'file', full: `${t(state, 'fileSnapshots')} (${fileCount})`, short: `${t(state, 'files')} (${fileCount})`, disabled: fileCount === 0 },
		{ id: 'diff', svg: 'git-compare', full: t(state, 'compareChanges'), short: t(state, 'diff'), disabled: !view.diff && !view.diffLoading },
	];
	for (const def of tabDefs) {
		const tab = DOM.append(tabs, DOM.$('button.knox-gui-checkpoint-details-tab')) as HTMLButtonElement;
		tab.type = 'button';
		tab.setAttribute('role', 'tab');
		tab.setAttribute('aria-selected', String(view.tab === def.id));
		tab.setAttribute('data-testid', `checkpoint-details-tab-${def.id}`);
		tab.classList.toggle('selected', view.tab === def.id);
		tab.disabled = def.disabled;
		appendKnoxGuiSvg(tab, def.svg, 16);
		DOM.append(tab, DOM.$('span.knox-gui-tab-full', undefined, def.full));
		DOM.append(tab, DOM.$('span.knox-gui-tab-short', undefined, def.short));
		widget.renderStore.add(DOM.addDisposableListener(tab, 'click', () => {
			view.tab = def.id;
			widget.render();
		}));
	}
	const content = DOM.append(panel, DOM.$('.knox-gui-checkpoint-details-content'));
	if (view.tab === 'basic') {
		renderBasicTab(content, state, details);
	} else if (view.tab === 'files') {
		renderFilesTab(widget, content, state, view, details);
	} else {
		renderDiffTab(widget, content, state, view);
	}
	const actions = DOM.append(panel, DOM.$('.knox-gui-checkpoint-details-actions'));
	const restoring = state.checkpointDialog === 'restore' && state.checkpointRestoreId === view.id && state.checkpointRestoreLoading;
	const restore = checkpointButton(widget, actions, {
		svg: restoring ? 'loader-2' : 'rotate-ccw',
		label: restoring ? t(state, 'restoring') : t(state, 'restoreThisCheckpoint'),
		labelClass: restoring ? undefined : 'knox-gui-cpl-show-md',
		disabled: restoring,
		extraClass: restoring ? 'knox-gui-checkpoint-details-action is-spinning' : 'knox-gui-checkpoint-details-action',
		testId: 'checkpoint-details-restore',
		onClick: () => void widget.controller.openRestorePreview(view.id),
	});
	if (!restoring) {
		DOM.append(restore, DOM.$('span.knox-gui-cpl-hide-md', undefined, t(state, 'restore')));
	}
	const memory = checkpointButton(widget, actions, {
		svg: 'brain',
		label: t(state, 'restoreWithMemory'),
		labelClass: 'knox-gui-cpl-show-sm',
		ariaLabel: t(state, 'restoreWithMemory'),
		disabled: restoring,
		extraClass: 'knox-gui-checkpoint-details-action',
		onClick: () => void widget.controller.openRestorePreview(view.id, true),
	});
	widget.hover(memory, `${t(state, 'restoreWithMemory')}\n${t(state, 'restoreWithMemoryTooltip')}`);
	checkpointButton(widget, actions, {
		label: t(state, 'close'),
		variant: 'ghost',
		onClick: () => closeDetails(widget),
	});
}

function field(parent: HTMLElement, label: string, extraClass = ''): HTMLElement {
	const wrap = DOM.append(parent, DOM.$(`.knox-gui-checkpoint-details-field${extraClass}`));
	DOM.append(wrap, DOM.$('div.knox-gui-checkpoint-details-label', undefined, label));
	return wrap;
}

function renderBasicTab(parent: HTMLElement, state: IKnoxGuiState, details: IKnoxGuiCheckpointDetails): void {
	const scroll = DOM.append(parent, DOM.$('.knox-gui-checkpoint-details-basic'));
	scroll.setAttribute('data-testid', 'checkpoint-details-basic');
	const grid = DOM.append(scroll, DOM.$('.knox-gui-checkpoint-details-grid'));
	DOM.append(field(grid, 'ID'), DOM.$('div.knox-gui-checkpoint-details-value.knox-gui-mono', undefined, details.id));
	const created = DOM.append(field(grid, t(state, 'created')), DOM.$('div.knox-gui-checkpoint-details-inline'));
	appendKnoxGuiSvg(created, 'clock', 16);
	created.append(new Date(details.created).toLocaleString());
	const description = DOM.append(field(grid, t(state, 'description')), DOM.$('div.knox-gui-checkpoint-details-value'));
	renderDescription(description, state, details.description);
	const workspace = DOM.append(field(grid, t(state, 'workspacePath')), DOM.$('div.knox-gui-checkpoint-details-value.knox-gui-mono.knox-gui-checkpoint-details-inline'));
	appendKnoxGuiSvg(workspace, 'folder-open', 16);
	workspace.append(details.workspacePath || t(state, 'notAvailable'));
	if (details.messageId) {
		DOM.append(field(grid, t(state, 'messageId'), '.is-wide'), DOM.$('div.knox-gui-checkpoint-details-value.knox-gui-mono', undefined, details.messageId));
	}
	const context = details.conversationContext;
	if (context) {
		DOM.append(scroll, DOM.$('.knox-gui-cpl-separator'));
		const section = DOM.append(scroll, DOM.$('.knox-gui-checkpoint-details-context'));
		const title = DOM.append(section, DOM.$('h3'));
		appendKnoxGuiSvg(title, context.role === 'user' ? 'user' : 'bot', 16);
		title.append(t(state, context.role === 'user' ? 'userContext' : 'aiContext'));
		DOM.append(section, DOM.$('p.knox-gui-checkpoint-details-message', undefined, context.messageContent));
		const meta = DOM.append(section, DOM.$('.knox-gui-checkpoint-details-meta'));
		DOM.append(meta, DOM.$('span', undefined, t(state, 'messageNumber', { number: context.index + 1 })));
		DOM.append(meta, DOM.$('span', undefined, '•'));
		DOM.append(meta, DOM.$('span', undefined, `${t(state, 'timestamp')}: ${new Date(context.timestamp).toLocaleString()}`));
	}
}

/** `formatDescription`: JSON is pretty-printed, JSON-ish text shown raw. */
function renderDescription(parent: HTMLElement, state: IKnoxGuiState, description: string): void {
	if (!description) {
		parent.textContent = t(state, 'noDescriptionAvailable');
		return;
	}
	try {
		const formatted = JSON.stringify(JSON.parse(description), null, 2);
		const label = DOM.append(parent, DOM.$('div.knox-gui-checkpoint-details-json-label'));
		appendKnoxGuiSvg(label, 'hash', 12);
		label.append(t(state, 'formattedJson'));
		DOM.append(parent, DOM.$('pre.knox-gui-checkpoint-json', undefined, formatted));
		return;
	} catch {
		// not JSON
	}
	if (description.includes('"type"') || description.includes('"text"') || description.startsWith('{')) {
		const label = DOM.append(parent, DOM.$('div.knox-gui-checkpoint-details-json-label'));
		appendKnoxGuiSvg(label, 'info', 12);
		label.append(t(state, 'rawContentInvalidJson'));
		DOM.append(parent, DOM.$('pre.knox-gui-checkpoint-json.is-raw', undefined, description));
		return;
	}
	parent.textContent = description;
}

function treeExpanded(widget: KnoxGuiWidget): boolean {
	return widget.controller.storageService.getBoolean(TREE_EXPANDED_KEY, StorageScope.PROFILE, true);
}

function renderFilesTab(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, view: IKnoxGuiCheckpointDetailsView, details: IKnoxGuiCheckpointDetails): void {
	if (!details.fileSnapshots.length) {
		const empty = DOM.append(parent, DOM.$('.knox-gui-checkpoint-details-empty'));
		appendKnoxGuiSvg(empty, 'file', 48);
		DOM.append(empty, DOM.$('p', undefined, t(state, 'noFileSnapshots')));
		return;
	}
	const frame = DOM.append(parent, DOM.$('.knox-gui-checkpoint-snapshots'));
	frame.setAttribute('data-testid', 'checkpoint-details-files');
	const selected = details.fileSnapshots.find(file => file.relativePath === view.selectedFile);
	const setExpanded = (value: boolean) => {
		widget.controller.storageService.store(TREE_EXPANDED_KEY, value, StorageScope.PROFILE, StorageTarget.MACHINE);
		widget.render();
	};
	if (!treeExpanded(widget)) {
		frame.classList.add('is-collapsed');
		const rail = DOM.append(frame, DOM.$('.knox-gui-checkpoint-tree-rail'));
		treeToggle(widget, rail, 'panel-left-open', t(state, 'expandFileTree'), 'checkpoint-tree-expand', () => setExpanded(true));
		const right = DOM.append(frame, DOM.$('.knox-gui-checkpoint-snapshot-viewer'));
		if (selected) {
			renderSnapshotViewer(widget, right, state, view, selected);
		} else {
			renderViewerEmpty(right, t(state, 'clickPanelToExpandTree'));
		}
		return;
	}
	const left = DOM.append(frame, DOM.$('.knox-gui-checkpoint-tree-pane'));
	const stored = widget.controller.storageService.getNumber(TREE_WIDTH_KEY, StorageScope.PROFILE, CHECKPOINT_TREE_WIDTH.default);
	left.style.width = `${Math.max(CHECKPOINT_TREE_WIDTH.min, Math.min(CHECKPOINT_TREE_WIDTH.max, stored))}px`;
	const treeHead = DOM.append(left, DOM.$('.knox-gui-checkpoint-tree-head'));
	DOM.append(treeHead, DOM.$('span', undefined, `${t(state, 'fileTree')} (${details.fileSnapshots.length} ${t(state, 'files')})`));
	treeToggle(widget, treeHead, 'panel-left-close', t(state, 'collapseFileTree'), 'checkpoint-tree-collapse', () => setExpanded(false));
	const tree = DOM.append(left, DOM.$('.knox-gui-checkpoint-snapshot-tree'));
	tree.setAttribute('role', 'tree');
	DOM.append(tree, DOM.$('div.knox-gui-checkpoint-tree-count', undefined, t(state, 'fileCount', { count: details.fileSnapshots.length })));
	renderSnapshotTree(widget, tree, view, buildCheckpointFileTree(details.fileSnapshots.map(file => file.relativePath)), 0);
	const splitter = DOM.append(frame, DOM.$('.knox-gui-checkpoint-splitter'));
	splitter.setAttribute('role', 'separator');
	splitter.setAttribute('aria-orientation', 'vertical');
	splitter.setAttribute('data-testid', 'checkpoint-tree-splitter');
	widget.renderStore.add(DOM.addDisposableListener(splitter, 'mousedown', (e: MouseEvent) => {
		e.preventDefault();
		const doc = frame.ownerDocument;
		const drag = new DisposableStore();
		widget.renderStore.add(drag);
		splitter.classList.add('is-dragging');
		doc.body.style.cursor = 'col-resize';
		doc.body.style.userSelect = 'none';
		let width = left.getBoundingClientRect().width;
		drag.add(DOM.addDisposableListener(doc, 'mousemove', (move: MouseEvent) => {
			const rect = frame.getBoundingClientRect();
			width = clampCheckpointTreeWidth(move.clientX - rect.left, rect.width);
			left.style.width = `${width}px`;
		}));
		drag.add(DOM.addDisposableListener(doc, 'mouseup', () => {
			splitter.classList.remove('is-dragging');
			doc.body.style.cursor = '';
			doc.body.style.userSelect = '';
			widget.controller.storageService.store(TREE_WIDTH_KEY, Math.round(width), StorageScope.PROFILE, StorageTarget.MACHINE);
			drag.dispose();
		}));
	}));
	const right = DOM.append(frame, DOM.$('.knox-gui-checkpoint-snapshot-viewer'));
	if (selected) {
		renderSnapshotViewer(widget, right, state, view, selected);
	} else {
		const empty = renderViewerEmpty(right, t(state, 'selectFileFromTree'));
		DOM.append(empty, DOM.$('p.knox-gui-checkpoint-details-hint', undefined, t(state, 'resizeFileTree')));
	}
}

function treeToggle(widget: KnoxGuiWidget, parent: HTMLElement, svg: 'panel-left-open' | 'panel-left-close', title: string, testId: string, onClick: () => void): void {
	const button = DOM.append(parent, DOM.$('button.knox-gui-checkpoint-tree-toggle', { type: 'button', title, 'aria-label': title, 'data-testid': testId }));
	appendKnoxGuiSvg(button, svg, 16);
	widget.renderStore.add(DOM.addDisposableListener(button, 'click', onClick));
}

function renderViewerEmpty(parent: HTMLElement, text: string): HTMLElement {
	parent.classList.add('is-empty');
	const empty = DOM.append(parent, DOM.$('.knox-gui-checkpoint-details-empty'));
	appendKnoxGuiSvg(empty, 'file', 32);
	DOM.append(empty, DOM.$('p', undefined, text));
	return empty;
}

function renderSnapshotTree(widget: KnoxGuiWidget, parent: HTMLElement, view: IKnoxGuiCheckpointDetailsView, nodes: IKnoxGuiCheckpointFileTreeNode[], depth: number): void {
	for (const node of nodes) {
		const open = view.expandedDirs.has(node.path);
		const row = DOM.append(parent, DOM.$('.knox-gui-checkpoint-tree-row'));
		row.setAttribute('role', 'treeitem');
		row.setAttribute('data-path', node.path);
		row.style.paddingLeft = `${depth * 12 + 4}px`;
		if (node.isDirectory) {
			row.setAttribute('aria-expanded', String(open));
			appendKnoxGuiSvg(row, open ? 'chevron-down' : 'chevron-right', 12).classList.add('knox-gui-checkpoint-tree-chevron');
			appendKnoxGuiSvg(row, open ? 'folder-open' : 'folder', 12).classList.add('knox-gui-checkpoint-tree-folder');
		} else {
			DOM.append(row, DOM.$('span.knox-gui-checkpoint-tree-spacer'));
			widget.appendFileIcon(row, node.name, 12);
			if (node.path === view.selectedFile) {
				row.classList.add('selected');
				row.setAttribute('aria-selected', 'true');
			}
		}
		DOM.append(row, DOM.$('span.knox-gui-checkpoint-tree-name', undefined, node.name));
		widget.renderStore.add(DOM.addDisposableListener(row, 'click', () => {
			if (node.isDirectory) {
				if (open) {
					view.expandedDirs.delete(node.path);
				} else {
					view.expandedDirs.add(node.path);
				}
			} else {
				view.selectedFile = node.path;
			}
			widget.render();
		}));
		if (node.isDirectory && open && node.children) {
			renderSnapshotTree(widget, parent, view, node.children, depth + 1);
		}
	}
}

/** `CodeViewer.tsx`: header actions, highlighted content or binary preview, footer metadata. */
function renderSnapshotViewer(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, view: IKnoxGuiCheckpointDetailsView, file: IKnoxGuiCheckpointDetailsSnapshot): void {
	parent.setAttribute('data-testid', 'checkpoint-code-viewer');
	const isBinary = file.encoding === 'base64';
	const head = DOM.append(parent, DOM.$('.knox-gui-checkpoint-viewer-head'));
	const name = DOM.append(head, DOM.$('.knox-gui-checkpoint-viewer-name'));
	widget.appendFileIcon(name, file.relativePath, 16);
	DOM.append(name, DOM.$('span.knox-gui-checkpoint-viewer-path', { title: file.relativePath }, file.relativePath));
	const tools = DOM.append(head, DOM.$('.knox-gui-checkpoint-viewer-tools'));
	const restoring = view.restoringFile === file.relativePath;
	checkpointButton(widget, tools, {
		svg: restoring ? 'loader-2' : 'rotate-ccw',
		title: t(state, 'restoreThisFile'),
		ariaLabel: t(state, 'restoreThisFile'),
		disabled: restoring,
		variant: 'ghost',
		size: 'xxs',
		extraClass: restoring ? 'is-spinning' : undefined,
		testId: 'checkpoint-restore-file',
		onClick: () => void restoreSnapshotFile(widget, view, file.relativePath),
	});
	if (!isBinary) {
		checkpointButton(widget, tools, {
			svg: view.wrap ? 'type' : 'wrap-text',
			title: t(state, view.wrap ? 'disableTextWrapping' : 'enableTextWrapping'),
			ariaLabel: t(state, view.wrap ? 'disableTextWrapping' : 'enableTextWrapping'),
			selected: view.wrap,
			variant: 'ghost',
			size: 'xxs',
			extraClass: view.wrap ? 'odp-chip-blue' : undefined,
			onClick: () => {
				view.wrap = !view.wrap;
				widget.render();
			},
		});
		checkpointButton(widget, tools, {
			svg: view.copied ? 'check' : 'copy',
			title: t(state, view.copied ? 'copiedToClipboard' : 'copyToClipboard'),
			ariaLabel: t(state, view.copied ? 'copiedToClipboard' : 'copyToClipboard'),
			variant: 'ghost',
			size: 'xxs',
			extraClass: view.copied ? 'odp-chip-green' : undefined,
			onClick: () => {
				widget.controller.copyText(file.content);
				view.copied = true;
				widget.render();
				setTimeout(() => {
					if (widget.checkpointDetails === view) {
						view.copied = false;
						widget.render();
					}
				}, 3000);
			},
		});
	}
	if (isBinary) {
		const body = DOM.append(parent, DOM.$('.knox-gui-checkpoint-viewer-binary'));
		const mime = checkpointImageMime(file.relativePath, file.encoding);
		if (mime) {
			const img = DOM.append(body, DOM.$('img')) as HTMLImageElement;
			img.src = `data:${mime};base64,${file.content}`;
			img.alt = file.relativePath;
			DOM.append(body, DOM.$('p.knox-gui-muted', undefined, t(state, 'binaryImagePreview', { size: formatSnapshotSize(file.size) })));
		} else {
			appendKnoxGuiSvg(body, 'file-warning', 40);
			DOM.append(body, DOM.$('p', undefined, t(state, 'binaryFileNotice')));
			DOM.append(body, DOM.$('p.knox-gui-muted', undefined, t(state, 'binaryFileSize', { size: formatSnapshotSize(file.size) })));
		}
	} else {
		const pre = DOM.append(parent, DOM.$(view.wrap ? 'pre.knox-gui-checkpoint-viewer-code.wrap' : 'pre.knox-gui-checkpoint-viewer-code'));
		widget.paintHighlightedCode(pre, languageIdFromFence('', file.relativePath), file.content, file.relativePath);
	}
	const foot = DOM.append(parent, DOM.$('.knox-gui-checkpoint-viewer-foot'));
	DOM.append(foot, DOM.$('span', undefined, isBinary ? t(state, 'binaryLabel') : (file.relativePath.split('.').pop()?.toLowerCase() || 'plaintext')));
	const meta = DOM.append(foot, DOM.$('span.knox-gui-checkpoint-viewer-meta'));
	DOM.append(meta, DOM.$('span', undefined, `${t(state, 'size')}: `));
	DOM.append(meta, DOM.$('span.knox-gui-mono', undefined, formatSnapshotSize(file.size)));
	const modified = new Date(file.lastModified);
	DOM.append(meta, DOM.$('span', undefined, ` ${t(state, 'modifiedLabel')}: `));
	DOM.append(meta, DOM.$('span.knox-gui-mono', undefined, isNaN(modified.getTime()) ? '' : `${modified.toLocaleDateString()} ${modified.toLocaleTimeString(undefined, { hour12: false })}`));
}

async function restoreSnapshotFile(widget: KnoxGuiWidget, view: IKnoxGuiCheckpointDetailsView, relativePath: string): Promise<void> {
	if (view.restoringFile) {
		return;
	}
	view.restoringFile = relativePath;
	widget.render();
	try {
		await widget.controller.messenger.request('restoreCheckpointFiles', { checkpointId: view.id, relativePaths: [relativePath] });
	} catch {
		// the host reports failures
	} finally {
		setTimeout(() => {
			view.restoringFile = undefined;
			if (widget.checkpointDetails === view) {
				widget.render();
			}
		}, 1500);
	}
}

function renderDiffTab(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, view: IKnoxGuiCheckpointDetailsView): void {
	const wrap = DOM.append(parent, DOM.$('.knox-gui-checkpoint-details-diff'));
	const controls = DOM.append(wrap, DOM.$('.knox-gui-checkpoint-details-compare'));
	DOM.append(controls, DOM.$('span.knox-gui-checkpoint-details-compare-label', undefined, t(state, 'compareAgainst')));
	const select = checkpointSelect(controls, '.knox-gui-checkpoint-details-compare-select');
	select.setAttribute('data-testid', 'checkpoint-compare-target');
	select.disabled = view.diffLoading;
	const options: Array<[string, string]> = [
		['previous', t(state, 'previousCheckpointOption')],
		['workspace', t(state, 'currentWorkspaceOption')],
		...compareCheckpointTargets(state.checkpointCompareCatalog.length ? state.checkpointCompareCatalog : state.checkpointListItems.length ? state.checkpointListItems : state.checkpoints, view.id).map((cp): [string, string] => {
			const description = cp.description || cp.id;
			return [cp.id, description.length > 48 ? `${description.slice(0, 48)}…` : description];
		}),
	];
	for (const [value, label] of options) {
		const option = DOM.append(select, DOM.$('option')) as HTMLOptionElement;
		option.value = value;
		option.textContent = label;
		option.selected = value === view.compareTarget;
	}
	widget.renderStore.add(DOM.addDisposableListener(select, 'change', () => void loadCheckpointDetailsDiff(widget, view, select.value)));
	if (view.diffLoading) {
		const loading = DOM.append(wrap, DOM.$('.knox-gui-checkpoint-details-empty'));
		DOM.append(loading, DOM.$('span.knox-gui-checkpoint-details-spinner'));
		DOM.append(loading, DOM.$('p', undefined, t(state, 'loadingPreviousCheckpoint')));
		return;
	}
	if (!view.diff) {
		const empty = DOM.append(wrap, DOM.$('.knox-gui-checkpoint-details-empty'));
		empty.setAttribute('data-testid', 'checkpoint-details-no-previous');
		appendKnoxGuiSvg(empty, 'git-compare', 48);
		DOM.append(empty, DOM.$('p.knox-gui-checkpoint-details-strong', undefined, t(state, 'noPreviousCheckpoint')));
		DOM.append(empty, DOM.$('p.knox-gui-checkpoint-details-hint', undefined, t(state, 'firstCheckpointInHistory')));
		return;
	}
	widget.renderDiffViewer(DOM.append(wrap, DOM.$('.knox-gui-checkpoint-details-diff-body')), state, view.diff);
}
