/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** File-path chrome: themed file icons and clickable paths that open the editor. */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { getIconClasses } from '../../../../../../../editor/common/services/getIconClasses.js';
import { FileKind } from '../../../../../../../platform/files/common/files.js';
import { parseCodeFenceRange, splitDisplayPath } from '../../../../common/knoxGuiTranscript.js';

/** `FileIcon.tsx`: icon from the active file icon theme, by file name and language. */
export function appendFileIcon(widget: KnoxGuiWidget, parent: HTMLElement, filepath: string, size = 16, folder = false): HTMLElement {
	const icon = DOM.append(parent, DOM.$('span.knox-gui-file-icon'));
	icon.style.width = `${size}px`;
	icon.style.height = `${size}px`;
	icon.setAttribute('aria-hidden', 'true');
	try {
		const resource = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(filepath) ? URI.parse(filepath) : URI.file(filepath);
		icon.classList.add(...getIconClasses(widget.modelService, widget.languageService, resource, folder ? FileKind.FOLDER : FileKind.FILE));
	} catch {
		icon.classList.add(folder ? 'folder-icon' : 'file-icon');
	}
	return icon;
}

export function renderClickablePath(widget: KnoxGuiWidget, parent: HTMLElement, filepath: string, options?: { range?: string; startLine?: number; endLine?: number; showIcon?: boolean }): void {
	const btn = DOM.append(parent, DOM.$('button.knox-gui-code-file')) as HTMLButtonElement;
	btn.type = 'button';
	btn.setAttribute('data-testid', 'clickable-file-path');
	widget.hover(btn, filepath);
	if (options?.showIcon) {
		appendFileIcon(widget, btn, filepath);
	}
	const { dir, name } = splitDisplayPath(filepath);
	if (dir) {
		DOM.append(btn, DOM.$('span.knox-gui-path-dir', undefined, dir));
	}
	DOM.append(btn, DOM.$('span.knox-gui-path-name', undefined, name));
	if (options?.range) {
		DOM.append(btn, DOM.$('span.knox-gui-path-range', undefined, options.range));
	}
	const parsed = parseCodeFenceRange(options?.range);
	const startLine = options?.startLine ?? parsed?.startLine;
	const endLine = options?.endLine ?? parsed?.endLine;
	widget.listenerStore.add(DOM.addDisposableListener(btn, 'click', () => widget.controller.showFile(filepath, { startLine, endLine })));
}
