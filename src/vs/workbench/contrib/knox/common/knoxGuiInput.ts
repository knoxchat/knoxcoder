/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Composer input helpers: document model, mentions/slash, submit gating,
 * images, history, and undo. Implementations live in `knoxGuiInput/`;
 * this file is the public surface used by the GUI controller, widgets, and tests.
 */

export { isSingleRangeEdit, isSingleRangeEditOrInsertion, shouldSendEditPrompt } from './knoxGuiEdit.js';
export {
	knoxGuiCodeBlockTitle,
	knoxGuiCodeBlockOpenAction,
	knoxGuiNewestCodeBlockIndex,
	emptyInputDoc,
	cloneInputDoc,
	inputDocIsEmpty,
	mentionChipLabel,
	slashCommandBareName,
	slashCommandTitle,
	inputDocToPlainText,
	inputDocFromPlainText,
	KNOX_GUI_CHIP_CHAR,
	paragraphTextBefore,
	docEndCaret,
	extractMentionsFromDoc,
	extractSlashFromDoc,
	mentionContextProviderName,
	knoxGuiCodeToEditTitle,
	type KnoxGuiInlineNode,
	type IKnoxGuiInputParagraph,
	type IKnoxGuiInputCodeBlock,
	type KnoxGuiCodeBlockOpenAction,
	type IKnoxGuiInputBlock,
	type IKnoxGuiDocCaret,
} from './knoxGuiInput/doc.js';
export * from './knoxGuiInput/commands.js';
export * from './knoxGuiInput/mutate.js';
export * from './knoxGuiInput/submit.js';
export * from './knoxGuiInput/mentions.js';
export * from './knoxGuiInput/slash.js';
export * from './knoxGuiInput/keys.js';
export * from './knoxGuiInput/floating.js';
export * from './knoxGuiInput/images.js';
export * from './knoxGuiInput/history.js';
export * from './knoxGuiInput/undo.js';
