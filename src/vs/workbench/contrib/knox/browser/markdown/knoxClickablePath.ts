/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IKnoxGuiBridge } from '../../common/knoxGuiProtocol.js';
import { knoxGuiIconClass } from '../knoxGuiIcons.js';
import {
	IKnoxOpenFileLines,
	IKnoxSymbolWithRange,
	knoxParseDisplayRange,
	knoxResolveWorkspaceUri,
	knoxTruncateSymbolPreview,
	splitDisplayPath,
} from '../../common/knoxMarkdown.js';
import { IKnoxRangeInFile } from '../../common/knoxResolveInput.js';

function workspaceFolders(workspace: IWorkspaceContextService): URI[] {
	return workspace.getWorkspace().folders.map(folder => folder.uri);
}

export function knoxShowFile(
	bridge: IKnoxGuiBridge,
	workspace: IWorkspaceContextService,
	filepath: string,
	lines?: IKnoxOpenFileLines,
): void {
	const trimmed = filepath.trim();
	if (!trimmed) {
		return;
	}
	const uri = knoxResolveWorkspaceUri(trimmed, workspaceFolders(workspace));
	if (!uri) {
		return;
	}
	if (lines?.startLine != null && lines.startLine > 0) {
		const startLine = lines.startLine - 1;
		const endLine = lines.endLine != null && lines.endLine > 0 ? lines.endLine - 1 : startLine;
		void bridge.post('showLines', { filepath: uri, startLine, endLine }).catch(() => { });
		return;
	}
	void bridge.post('showFile', { filepath: uri }).catch(() => { });
}

export function knoxShowSymbol(
	bridge: IKnoxGuiBridge,
	symbol: IKnoxSymbolWithRange,
): void {
	void bridge.post('showLines', {
		filepath: symbol.filepath,
		startLine: symbol.range.start.line,
		endLine: symbol.range.end.line,
	}).catch(() => { });
}

export function renderKnoxClickableFilePath(
	parent: HTMLElement,
	filepath: string,
	options: {
		range?: string;
		showIcon?: boolean;
		startLine?: number;
		endLine?: number;
	},
	bridge: IKnoxGuiBridge,
	workspace: IWorkspaceContextService,
	store: DisposableStore,
): HTMLElement {
	const button = append(parent, $<HTMLButtonElement>('button.knox-file-path'));
	button.type = 'button';
	button.title = filepath;
	button.setAttribute('data-testid', 'clickable-file-path');
	if (options.showIcon) {
		const icon = append(button, $('span.knox-file-path-icon'));
		icon.className = `knox-file-path-icon ${knoxGuiIconClass('files')}`;
	}
	const { dir, name } = splitDisplayPath(filepath);
	if (dir) {
		append(button, $('span.knox-file-path-dir')).textContent = dir;
	}
	append(button, $('span.knox-file-path-name')).textContent = name;
	if (options.range) {
		append(button, $('span.knox-file-path-range')).textContent = options.range;
	}
	const parsed = knoxParseDisplayRange(options.range);
	store.add(addDisposableListener(button, 'click', e => {
		e.preventDefault();
		e.stopPropagation();
		knoxShowFile(bridge, workspace, filepath, {
			startLine: options.startLine ?? parsed.startLine,
			endLine: options.endLine ?? parsed.endLine,
		});
	}));
	return button;
}

export function renderKnoxFilenameLink(
	parent: HTMLElement,
	rif: IKnoxRangeInFile,
	bridge: IKnoxGuiBridge,
	workspace: IWorkspaceContextService,
	hover: IHoverService,
	store: DisposableStore,
): HTMLElement {
	const span = append(parent, $('span.knox-inline-link.knox-filename-link'));
	span.setAttribute('role', 'link');
	span.tabIndex = 0;
	const icon = append(span, $('span'));
	icon.className = knoxGuiIconClass('files');
	const { name } = splitDisplayPath(rif.filepath);
	append(span, $('span.knox-inline-link-label')).textContent = name;
	const relative = knoxResolveWorkspaceUri(rif.filepath, workspaceFolders(workspace));
	store.add(hover.setupManagedHover(getDefaultHoverDelegate('mouse'), span, relative || rif.filepath));
	const open = () => knoxShowFile(bridge, workspace, rif.filepath, {
		startLine: rif.range.start.line + 1,
		endLine: rif.range.end.line + 1,
	});
	store.add(addDisposableListener(span, 'click', e => {
		e.preventDefault();
		e.stopPropagation();
		open();
	}));
	store.add(addDisposableListener(span, 'keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			e.stopPropagation();
			open();
		}
	}));
	return span;
}

export function renderKnoxSymbolLink(
	parent: HTMLElement,
	symbol: IKnoxSymbolWithRange,
	content: string,
	bridge: IKnoxGuiBridge,
	hover: IHoverService,
	store: DisposableStore,
): HTMLElement {
	const span = append(parent, $('span.knox-inline-link.knox-symbol-link'));
	span.setAttribute('role', 'link');
	span.tabIndex = 0;
	const code = append(span, $('code.knox-symbol-code'));
	code.textContent = content;
	store.add(hover.setupManagedHover(
		getDefaultHoverDelegate('mouse'),
		span,
		knoxTruncateSymbolPreview(symbol.content) || symbol.filepath,
	));
	const open = () => knoxShowSymbol(bridge, symbol);
	store.add(addDisposableListener(span, 'click', e => {
		e.preventDefault();
		e.stopPropagation();
		open();
	}));
	store.add(addDisposableListener(span, 'keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			e.stopPropagation();
			open();
		}
	}));
	return span;
}
