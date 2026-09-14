/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass } from '../knoxGuiIcons.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IKnoxContextItem } from '../../common/knoxChatTypes.js';
import { IKnoxGuiBridge } from '../../common/knoxGuiProtocol.js';
import { knoxAsArgsRecord } from '../../common/knoxStreamingToolCode.js';
import {
	IKnoxRepoTreeNode,
	knoxDirectoryFilterBadges,
	knoxExtractDirectoryContents,
	knoxExtractRepoMapContent,
	knoxParseTreeText,
	knoxRepoTreeStats,
	knoxShortDirectoryName,
} from '../../common/knoxRepoTree.js';
import { knoxShowFile } from '../markdown/knoxClickablePath.js';
import { IKnoxToolUiState } from './knoxToolCard.js';

export function renderKnoxRepoTreeCard(
	parent: HTMLElement,
	kind: 'viewSubdirectory' | 'viewRepoMap',
	parsedArgs: unknown,
	outputItems: readonly IKnoxContextItem[],
	toolId: string,
	ui: IKnoxToolUiState,
	services: {
		bridge: IKnoxGuiBridge;
		workspace: IWorkspaceContextService;
		hover: IHoverService;
	},
	store: DisposableStore,
	onDidChangeHeight: () => void,
): void {
	const args = knoxAsArgsRecord(parsedArgs);
	const directoryPath = typeof args?.directory_path === 'string' ? args.directory_path : '';
	const contents = kind === 'viewSubdirectory'
		? knoxExtractDirectoryContents(outputItems)
		: { structure: knoxExtractRepoMapContent(outputItems), summary: '', notice: '', enhanced: false };
	const retrieving = kind === 'viewSubdirectory'
		? localize('knox.retrievingDirStructure', "Retrieving directory structure...")
		: localize('knox.retrievingRepoStructure', "Retrieving repository structure...");
	const nodes = contents.structure ? knoxParseTreeText(contents.structure) : [];
	const stats = knoxRepoTreeStats(nodes, contents.summary);
	const expanded = !ui.treeCollapsed.has(toolId);
	const tab = ui.treeTab.get(toolId) ?? 'structure';

	const root = append(parent, $('.knox-tree-card'));
	const titleRow = append(root, $('.knox-tree-title'));
	append(titleRow, $('span')).className = knoxGuiIconClass(kind === 'viewSubdirectory' ? 'folder' : 'tree');
	append(titleRow, $('span.knox-tree-title-label')).textContent = kind === 'viewSubdirectory'
		? localize('knox.viewSubdirectory', "View Subdirectory")
		: localize('knox.viewRepoStructure', "View Repo Structure");
	if (kind === 'viewSubdirectory') {
		for (const badge of knoxDirectoryFilterBadges({
			directoryPath,
			depth: typeof args?.depth === 'number' ? args.depth : undefined,
			fileTypes: Array.isArray(args?.fileTypes) ? args.fileTypes.filter((v): v is string => typeof v === 'string') : undefined,
			pattern: typeof args?.pattern === 'string' ? args.pattern : undefined,
			includeStats: args?.includeStats === true,
			includeGitStatus: args?.includeGitStatus === true,
		})) {
			append(titleRow, $('span.knox-tree-badge')).textContent = badge;
		}
	}

	const panel = append(root, $('.knox-tree-panel'));
	const header = append(panel, $('.knox-tree-header'));
	const meta = append(header, $('.knox-tree-meta'));
	if (kind === 'viewSubdirectory') {
		append(meta, $('span.knox-tree-name')).textContent = knoxShortDirectoryName(directoryPath);
		append(meta, $('code.knox-tree-path')).textContent = directoryPath || '/';
	} else {
		append(meta, $('span.knox-tree-name')).textContent = localize('knox.repositoryStructure', "Repository Structure");
	}
	const statsText = stats.total > 0
		? localize('knox.foldersFiles', "{0} folders, {1} files", stats.folders, stats.files)
		: (kind === 'viewRepoMap' ? localize('knox.browsingEntireRepo', "Browsing entire repository") : '');
	if (statsText) {
		append(meta, $('span.knox-tree-stats')).textContent = stats.size ? `${statsText} • ${stats.size}` : statsText;
	}

	const actions = append(header, $('.knox-tree-actions'));
	if (contents.summary) {
		const tabs = append(actions, $('.knox-tree-tabs'));
		const structureBtn = tabButton(tabs, localize('knox.structureTab', "Structure"), tab === 'structure', () => {
			ui.treeTab.set(toolId, 'structure');
			onDidChangeHeight();
		}, store);
		tabButton(tabs, localize('knox.summaryTab', "Summary"), tab === 'summary', () => {
			ui.treeTab.set(toolId, 'summary');
			onDidChangeHeight();
		}, store);
		structureBtn.setAttribute('aria-pressed', String(tab === 'structure'));
	}

	const chevron = append(actions, $<HTMLButtonElement>('button.knox-icon-button'));
	chevron.type = 'button';
	const expandHint = expanded
		? localize('knox.collapse', "Collapse")
		: localize('knox.expand', "Expand");
	chevron.setAttribute('aria-label', expandHint);
	append(chevron, $('span')).className = knoxGuiIconClass(expanded ? 'lucide-chevron-down' : 'lucide-chevron-right');
	store.add(services.hover.setupManagedHover(getDefaultHoverDelegate('mouse'), chevron, expandHint));
	store.add(addDisposableListener(chevron, 'click', e => {
		e.preventDefault();
		e.stopPropagation();
		if (ui.treeCollapsed.has(toolId)) {
			ui.treeCollapsed.delete(toolId);
		} else {
			ui.treeCollapsed.add(toolId);
		}
		onDidChangeHeight();
	}));

	if (!expanded) {
		return;
	}

	const body = append(panel, $('.knox-tree-body'));
	if (tab === 'summary' && contents.summary) {
		append(body, $('pre.knox-tree-summary')).textContent = contents.summary;
	} else if (!nodes.length) {
		append(body, $('div.knox-tree-empty')).textContent = retrieving;
	} else {
		const list = append(body, $('ul.knox-tree-list'));
		for (const node of nodes) {
			renderNode(list, node, services, store);
		}
	}

	if (contents.notice) {
		append(panel, $('div.knox-tree-notice')).textContent = contents.notice;
	}
}

function tabButton(
	parent: HTMLElement,
	label: string,
	active: boolean,
	onClick: () => void,
	store: DisposableStore,
): HTMLButtonElement {
	const button = append(parent, $<HTMLButtonElement>('button.knox-tree-tab'));
	button.type = 'button';
	button.textContent = label;
	button.classList.toggle('active', active);
	store.add(addDisposableListener(button, 'click', e => {
		e.preventDefault();
		e.stopPropagation();
		onClick();
	}));
	return button;
}

function renderNode(
	parent: HTMLElement,
	node: IKnoxRepoTreeNode,
	services: {
		bridge: IKnoxGuiBridge;
		workspace: IWorkspaceContextService;
	},
	store: DisposableStore,
): void {
	const item = append(parent, $('li.knox-tree-node'));
	const row = append(item, $('span.knox-tree-row'));
	append(row, $('span')).className = knoxGuiIconClass(node.isDirectory ? 'folder' : 'files');
	const label = append(row, node.isDirectory ? $('span.knox-tree-dir') : $<HTMLButtonElement>('button.knox-tree-file'));
	label.textContent = node.isDirectory ? `${node.name}/` : node.name;
	if (!node.isDirectory) {
		const button = label as HTMLButtonElement;
		button.type = 'button';
		button.title = node.path;
		store.add(addDisposableListener(button, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			knoxShowFile(services.bridge, services.workspace, node.path);
		}));
	}
	if (node.gitStatus) {
		const git = append(row, $('span.knox-tree-git'));
		git.textContent = `[${node.gitStatus}]`;
		const statusClass = node.gitStatus === '?' ? 'unknown' : node.gitStatus.toLowerCase();
		git.classList.add(`knox-tree-git-${statusClass}`);
	}
	if (node.detail) {
		append(row, $('span.knox-tree-detail')).textContent = node.detail;
	}
	if (node.children.length) {
		const children = append(item, $('ul.knox-tree-list'));
		for (const child of node.children) {
			renderNode(children, child, services, store);
		}
	}
}
