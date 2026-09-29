/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Composer: drag/drop, shell + collapse dock, caret, @ / slash picker, input, model and
 * reasoning selects, key handling, images, input-doc IO and code-to-edit.
 * Implementations live in `widget/composer/`; this file is the public surface used by
 * `knoxGuiWidget.ts`, `facade/composerFacade.ts` and `chat/historyEditor.ts`.
 */

export { onDragOver, onDragLeave, showDropOverlay, hideDropOverlay, onDrop } from './composer/dragDrop.js';
export { renderComposer, KNOX_COMPOSER_TOGGLE_MS, setComposerCollapsed } from './composer/layout.js';
export { renderAcceptRejectAll, renderChatPermissionBar, renderContextPeek } from './composer/bars.js';
export { placeCaretAtEndOf, caretDocPosition, placeCaretAtDocPosition, caretClientRect, caretAtEdge, placeCaretAtStart, placeCaretAtEnd } from './composer/caret.js';
export { paintTypedMention, renderSuggest, renderSuggestItem } from './composer/suggest.js';
export { syncInput, renderInput, syncPlaceholder } from './composer/input.js';
export { renderModelSelect, renderReasoningSelect } from './composer/selects.js';
export { insertAddContext, onEditorKeyDown, submitFromComposer, stepInputHistory, stepComposerUndo, insertPlainText, onEditorPaste } from './composer/editing.js';
export { readImageFile, addImages, renderImageAttach, renderImageThumbnails, renderThumb, showImagePreview, hideImagePreview } from './composer/attachments.js';
export { paintInputDoc, appendInline, readInputDoc, readInlines } from './composer/inputDoc.js';
export { renderCodeToEditCard, refreshAddFileHits } from './composer/codeToEdit.js';
