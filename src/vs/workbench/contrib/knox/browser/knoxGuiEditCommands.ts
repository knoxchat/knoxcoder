/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getActiveElement } from '../../../../base/browser/dom.js';
import { MultiCommand, RedoCommand, SelectAllCommand, UndoCommand } from '../../../../editor/browser/editorExtensions.js';
import { KnoxEditCommand, runKnoxEditCommand } from './gui/widget/editCommands.js';

/**
 * Above the editor's `generic-dom-input-textarea` (1000) and `generic-dom` (0) fallbacks, which do not treat a
 * `contenteditable` as a text input and would run Select All / Undo / Redo on the active code editor instead.
 * Below the webview override, and the code editor's own implementation only applies when it has text focus.
 */
const KNOX_EDIT_PRIORITY = 20000;

function overrideForKnox(command: MultiCommand, kind: KnoxEditCommand): void {
	command.addImplementation(KNOX_EDIT_PRIORITY, 'knox-gui', () => runKnoxEditCommand(kind, getActiveElement()));
}

overrideForKnox(SelectAllCommand, 'selectAll');
overrideForKnox(UndoCommand, 'undo');
overrideForKnox(RedoCommand, 'redo');
