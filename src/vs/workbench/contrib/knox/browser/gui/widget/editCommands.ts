/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../../../base/common/lifecycle.js';

/**
 * Workbench Edit commands (`editor.action.selectAll`, `undo`, `redo`) only know `<input>` / `<textarea>`
 * as native text inputs. The Knox composer and history editors are `contenteditable`, so without help those
 * commands fall through to the active code editor (Cmd+A selected the open file instead of the prompt).
 * A widget registers itself as the host of its root element and answers for whatever is focused inside it.
 */
export type KnoxEditCommand = 'selectAll' | 'undo' | 'redo';

export interface IKnoxEditHost {
	/** @returns `true` when the command was handled inside the widget, `false` to let the workbench continue. */
	run(command: KnoxEditCommand, active: HTMLElement): boolean;
}

const hosts = new WeakMap<Element, IKnoxEditHost>();

export function registerKnoxEditHost(root: HTMLElement, host: IKnoxEditHost): IDisposable {
	hosts.set(root, host);
	return { dispose: () => { if (hosts.get(root) === host) { hosts.delete(root); } } };
}

/** Routes an Edit command to the Knox widget that owns the focused element, if any. */
export function runKnoxEditCommand(command: KnoxEditCommand, active: Element | null | undefined): boolean {
	if (!active) {
		return false;
	}
	const root = active.closest('.knox-gui');
	const host = root ? hosts.get(root) : undefined;
	return host ? host.run(command, active as HTMLElement) : false;
}

export function isNativeTextInput(element: Element): boolean {
	const tag = element.tagName.toLowerCase();
	return tag === 'input' || tag === 'textarea';
}

/** Selects everything inside `container` (what native Select All does for a contenteditable host). */
export function selectAllContents(container: HTMLElement): boolean {
	const doc = container.ownerDocument;
	const selection = doc.getSelection();
	if (!selection) {
		return false;
	}
	const range = doc.createRange();
	range.selectNodeContents(container);
	selection.removeAllRanges();
	selection.addRange(range);
	return true;
}
