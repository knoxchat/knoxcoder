/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Subdirectory and repo-map tree cards (structure / summary tabs, ANSI preview). */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { appendKnoxGuiSvg } from '../../knoxGuiIcons.js';
import {
	capTreeTerminalLines,
	colorizeSummary,
	colorizeTreeStructure,
	DARK_TERMINAL_PALETTE,
	LIGHT_TERMINAL_PALETTE,
	repoMapOutput,
	repoMapToTreeColorized,
	subdirectoryFilterBadges,
	subdirectoryOutputParts,
	treePreviewLines,
	treeStatsFromPlain,
	treeThemeColors,
} from '../../../../common/knoxGuiTools.js';
import { IKnoxGuiState, IKnoxGuiToolCall } from '../../../../common/knoxGuiState.js';

export function renderSubdirectoryTool(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
	const args = tool.parsedArgs ?? {};
	const items = tool.outputItems?.length ? tool.outputItems : (tool.output ? [{ content: tool.output }] : []);
	const parts = subdirectoryOutputParts(items);
	const isLight = widget.isLightTheme();
	const theme = treeThemeColors(isLight);
	const retrieving = t(state, 'retrievingDirStructure');
	// allow-any-unicode-next-line
	const hasEnhanced = parts.summary.includes('Directory Analysis Summary') || parts.structure.includes('├──') || parts.structure.includes('└──');
	const tree = !parts.raw
		? { plain: retrieving, colorized: retrieving }
		: hasEnhanced
			? { plain: parts.raw, colorized: colorizeTreeStructure(parts.raw, isLight) }
			: repoMapToTreeColorized(parts.raw);
	const stats = treeStatsFromPlain(tree.plain, parts.summary);
	const badges = subdirectoryFilterBadges(args);
	const pathLabel = String(args.directory_path ?? args.path ?? '').trim() || '.';
	const shortDirName = pathLabel.split('/').filter(Boolean).pop() || pathLabel;
	const expanded = widget.cardExpanded(tool.id, false);
	const tab = widget.toolCardTab.get(tool.id) === 'summary' ? 'summary' : 'structure';
	const title = DOM.append(parent, DOM.$('.knox-gui-tool-kind-title.is-subdir'));
	appendKnoxGuiSvg(title, 'folder', 16).classList.add('knox-gui-tree-folder-icon');
	DOM.append(title, DOM.$('span.knox-gui-cyan', undefined, t(state, 'viewSubdirectory')));
	for (const badge of badges) {
		DOM.append(title, DOM.$('span.knox-gui-tool-badge', undefined, badge));
	}
	widget.renderTreeCard(parent, state, {
		id: tool.id,
		kind: 'subdirectory',
		expanded,
		theme,
		title: shortDirName,
		subtitle: pathLabel !== shortDirName && pathLabel !== '.' ? pathLabel : undefined,
		stats: tree.plain === retrieving ? undefined : stats,
		preview: treePreviewLines(tree.plain).text,
		colorized: tab === 'summary' && parts.summary ? colorizeSummary(parts.summary, isLight) : tree.colorized,
		toggleTestId: 'subdirectory-toggle',
		staticTestId: 'subdirectory-static',
		notice: expanded ? parts.notice : undefined,
		tabs: parts.summary && expanded ? { active: tab, onStructure: () => widget.setCardTab(tool.id, 'structure'), onSummary: () => widget.setCardTab(tool.id, 'summary') } : undefined,
	});
}

export function renderRepoMapTool(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
	const items = tool.outputItems?.length ? tool.outputItems : (tool.output ? [{ content: tool.output }] : []);
	const raw = repoMapOutput(items);
	const retrieving = t(state, 'retrievingRepoStructure');
	const tree = raw ? repoMapToTreeColorized(raw) : { plain: retrieving, colorized: `\x1b[90m${retrieving}\x1b[0m` };
	const stats = treeStatsFromPlain(tree.plain);
	const isLight = widget.isLightTheme();
	const theme = treeThemeColors(isLight);
	const expanded = widget.cardExpanded(tool.id, false);
	const title = DOM.append(parent, DOM.$('.knox-gui-tool-kind-title'));
	appendKnoxGuiSvg(title, 'folder-tree', 16);
	DOM.append(title, DOM.$('span.knox-gui-cyan', undefined, t(state, 'viewRepoStructure')));
	widget.renderTreeCard(parent, state, {
		id: tool.id,
		kind: 'repo-map',
		expanded,
		theme,
		title: t(state, 'repositoryStructure'),
		stats: stats.total > 0 ? stats : undefined,
		emptyHint: t(state, 'browsingEntireRepo'),
		preview: treePreviewLines(tree.plain).text,
		colorized: tree.colorized,
		toggleTestId: 'repo-map-toggle',
		staticTestId: 'repo-map-static',
		cardTestId: 'knox-gui-repo-map',
	});
}

export function renderTreeCard(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, options: {
	id: string;
	kind?: 'subdirectory' | 'repo-map';
	expanded: boolean;
	theme: ReturnType<typeof treeThemeColors>;
	title: string;
	subtitle?: string;
	stats?: { files: number; folders: number; total: number; size?: string };
	emptyHint?: string;
	preview: string;
	colorized: string;
	toggleTestId: string;
	staticTestId: string;
	cardTestId?: string;
	notice?: string;
	tabs?: { active: string; onStructure: () => void; onSummary: () => void };
}): HTMLElement {
	const card = DOM.append(parent, DOM.$('.knox-gui-tree-card'));
	if (options.cardTestId) {
		card.setAttribute('data-testid', options.cardTestId);
	}
	card.style.background = options.theme.background;
	card.style.borderColor = options.theme.border;
	const head = DOM.append(card, DOM.$('.knox-gui-tree-head'));
	head.style.background = `linear-gradient(135deg, ${options.theme.backgroundGradientStart} 0%, ${options.theme.backgroundGradientEnd} 100%)`;
	widget.collapseChevron(head, {
		expanded: options.expanded,
		title: options.expanded ? t(state, 'collapse') : t(state, 'expand'),
		testId: options.toggleTestId,
		onClick: () => widget.toggleCardExpanded(options.id, false),
	});
	const meta = DOM.append(head, DOM.$('.knox-gui-tree-meta'));
	if (options.kind === 'subdirectory') {
		appendKnoxGuiSvg(meta, 'folder', 14).classList.add('knox-gui-tree-folder-icon');
	}
	const name = DOM.append(meta, DOM.$('span.knox-gui-tree-title', undefined, options.title));
	name.style.color = options.kind === 'repo-map' ? options.theme.foreground : options.theme.accent;
	if (options.subtitle) {
		const sub = DOM.append(meta, DOM.$('code.knox-gui-tree-sub', undefined, options.subtitle));
		sub.style.color = options.theme.foregroundMuted;
	}
	const statsEl = DOM.append(meta, DOM.$('span.knox-gui-tree-stats'));
	statsEl.style.color = options.theme.foregroundMuted;
	if (options.stats && options.stats.total > 0) {
		statsEl.textContent = `• ${t(state, 'foldersFolders', { folders: options.stats.folders, files: options.stats.files })}${options.stats.size ? ` • ${options.stats.size}` : ''}`;
	} else if (options.emptyHint) {
		statsEl.textContent = options.emptyHint;
	}
	if (options.tabs) {
		const tabs = DOM.append(head, DOM.$('.knox-gui-tree-tabs'));
		const structure = DOM.append(tabs, DOM.$('button', undefined, t(state, 'structureTab'))) as HTMLButtonElement;
		structure.type = 'button';
		structure.classList.toggle('selected', options.tabs.active === 'structure');
		widget.renderStore.add(DOM.addDisposableListener(structure, 'click', options.tabs.onStructure));
		const summary = DOM.append(tabs, DOM.$('button', undefined, t(state, 'summaryTab'))) as HTMLButtonElement;
		summary.type = 'button';
		summary.classList.toggle('selected', options.tabs.active === 'summary');
		widget.renderStore.add(DOM.addDisposableListener(summary, 'click', options.tabs.onSummary));
	}
	if (!options.expanded) {
		const preview = DOM.append(card, DOM.$('pre.knox-gui-tree-preview', undefined, options.preview));
		preview.setAttribute('data-testid', options.staticTestId);
		preview.style.color = options.theme.foreground;
		return card;
	}
	const body = DOM.append(card, DOM.$(options.kind === 'repo-map' ? 'pre.knox-gui-tree-body.is-repo-map' : 'pre.knox-gui-tree-body'));
	body.style.color = options.theme.foreground;
	// LazyColorizedTree.tsx: xterm with 5000-line scrollback; repo map 300px, subdirectory 350px.
	widget.appendAnsi(body, capTreeTerminalLines(options.colorized, options.kind === 'repo-map' ? 300 : 350), widget.isLightTheme() ? LIGHT_TERMINAL_PALETTE : DARK_TERMINAL_PALETTE);
	if (options.notice) {
		const notice = DOM.append(card, DOM.$('.knox-gui-tree-notice', undefined, options.notice));
		if (widget.isLightTheme()) {
			notice.classList.add('is-light');
		}
	}
	return card;
}
