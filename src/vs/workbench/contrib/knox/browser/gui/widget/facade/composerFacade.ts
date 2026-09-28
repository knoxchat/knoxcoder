/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { KnoxGuiPanelsFacade } from './panelsFacade.js';
import { IKnoxGuiDocCaret, IKnoxGuiInputBlock, KnoxGuiInlineNode } from '../../../../common/knoxGuiInput.js';
import { IKnoxGuiState, IKnoxGuiSuggestItem } from '../../../../common/knoxGuiState.js';
import * as knoxGuiComposerView from '../composer.js';

/** Composer input, suggest picker, drag/drop, images, caret and doc IO (`widget/composer.ts`). */
export abstract class KnoxGuiComposerFacade extends KnoxGuiPanelsFacade {
	onDragOver(this: KnoxGuiWidget, event: DragEvent): void {
		knoxGuiComposerView.onDragOver(this, event);
	}

	onDragLeave(this: KnoxGuiWidget, event: DragEvent): void {
		knoxGuiComposerView.onDragLeave(this, event);
	}

	showDropOverlay(this: KnoxGuiWidget): void {
		knoxGuiComposerView.showDropOverlay(this);
	}

	hideDropOverlay(this: KnoxGuiWidget): void {
		knoxGuiComposerView.hideDropOverlay(this);
	}

	onDrop(this: KnoxGuiWidget, event: DragEvent): void {
		knoxGuiComposerView.onDrop(this, event);
	}

	renderComposer(this: KnoxGuiWidget, state: IKnoxGuiState): void {
		knoxGuiComposerView.renderComposer(this, state);
	}

	placeCaretAtEndOf(this: KnoxGuiWidget, editor: HTMLElement): void {
		knoxGuiComposerView.placeCaretAtEndOf(this, editor);
	}

	renderAcceptRejectAll(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, options?: { singleRange?: boolean }): void {
		knoxGuiComposerView.renderAcceptRejectAll(this, parent, state, options);
	}

	renderChatPermissionBar(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiComposerView.renderChatPermissionBar(this, parent, state);
	}

	syncInput(this: KnoxGuiWidget, state: IKnoxGuiState): void {
		knoxGuiComposerView.syncInput(this, state);
	}

	renderSuggest(this: KnoxGuiWidget, wrap: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiComposerView.renderSuggest(this, wrap, state);
	}

	renderSuggestItem(this: KnoxGuiWidget, list: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiSuggestItem, index: number, selected: boolean): void {
		knoxGuiComposerView.renderSuggestItem(this, list, state, item, index, selected);
	}

	renderInput(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiComposerView.renderInput(this, parent, state);
	}

	renderModelSelect(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, source = 'main'): void {
		knoxGuiComposerView.renderModelSelect(this, parent, state, source);
	}

	renderReasoningSelect(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, source = 'main'): void {
		knoxGuiComposerView.renderReasoningSelect(this, parent, state, source);
	}

	onEditorKeyDown(this: KnoxGuiWidget, e: KeyboardEvent, state?: IKnoxGuiState): void {
		knoxGuiComposerView.onEditorKeyDown(this, e, state);
	}

	submitFromComposer(this: KnoxGuiWidget, altKey: boolean): void {
		knoxGuiComposerView.submitFromComposer(this, altKey);
	}

	insertAddContext(this: KnoxGuiWidget): void {
		knoxGuiComposerView.insertAddContext(this);
	}

	stepInputHistory(this: KnoxGuiWidget, delta: number): void {
		knoxGuiComposerView.stepInputHistory(this, delta);
	}

	caretAtEdge(this: KnoxGuiWidget, edge: 'start' | 'end'): boolean {
		return knoxGuiComposerView.caretAtEdge(this, edge);
	}

	onEditorPaste(this: KnoxGuiWidget, event: ClipboardEvent, state: IKnoxGuiState): void {
		knoxGuiComposerView.onEditorPaste(this, event, state);
	}

	insertPlainText(editor: HTMLElement, text: string): void {
		knoxGuiComposerView.insertPlainText(editor, text);
	}

	readImageFile(this: KnoxGuiWidget, file: File): void {
		knoxGuiComposerView.readImageFile(this, file);
	}

	addImages(this: KnoxGuiWidget, images: ReadonlyArray<{ name: string; imageUrl: string }>): void {
		knoxGuiComposerView.addImages(this, images);
	}

	paintInputDoc(this: KnoxGuiWidget, editor: HTMLElement, doc: IKnoxGuiInputBlock[], onChange?: (doc: IKnoxGuiInputBlock[]) => void): void {
		knoxGuiComposerView.paintInputDoc(this, editor, doc, onChange);
	}

	appendInline(this: KnoxGuiWidget, parent: HTMLElement, node: KnoxGuiInlineNode): void {
		knoxGuiComposerView.appendInline(this, parent, node);
	}

	readInputDoc(this: KnoxGuiWidget, editor: HTMLElement): IKnoxGuiInputBlock[] {
		return knoxGuiComposerView.readInputDoc(this, editor);
	}

	readInlines(this: KnoxGuiWidget, node: Node): KnoxGuiInlineNode[] {
		return knoxGuiComposerView.readInlines(this, node);
	}

	syncPlaceholder(this: KnoxGuiWidget, editor: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiComposerView.syncPlaceholder(this, editor, state);
	}

	placeCaretAtStart(this: KnoxGuiWidget): void {
		knoxGuiComposerView.placeCaretAtStart(this);
	}

	placeCaretAtEnd(this: KnoxGuiWidget): void {
		knoxGuiComposerView.placeCaretAtEnd(this);
	}

	caretDocPosition(this: KnoxGuiWidget, editor: HTMLElement): IKnoxGuiDocCaret | undefined {
		return knoxGuiComposerView.caretDocPosition(this, editor);
	}

	placeCaretAtDocPosition(this: KnoxGuiWidget, editor: HTMLElement, caret: IKnoxGuiDocCaret): void {
		knoxGuiComposerView.placeCaretAtDocPosition(this, editor, caret);
	}

	caretClientRect(this: KnoxGuiWidget): { left: number; top: number; bottom: number } | undefined {
		return knoxGuiComposerView.caretClientRect(this);
	}

	paintTypedMention(this: KnoxGuiWidget, state: IKnoxGuiState): void {
		knoxGuiComposerView.paintTypedMention(this, state);
	}

	renderCodeToEditCard(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiComposerView.renderCodeToEditCard(this, parent, state);
	}

	async refreshAddFileHits(this: KnoxGuiWidget, query: string): Promise<void> {
		return knoxGuiComposerView.refreshAddFileHits(this, query);
	}

	renderContextPeek(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiComposerView.renderContextPeek(this, parent, state);
	}

	renderImageThumbnails(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void {
		knoxGuiComposerView.renderImageThumbnails(this, parent, state);
	}

	renderThumb(this: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, url: string, name: string, alt: string, onRemove: () => void): void {
		knoxGuiComposerView.renderThumb(this, parent, state, url, name, alt, onRemove);
	}

	showImagePreview(this: KnoxGuiWidget, anchor: HTMLElement, url: string): void {
		knoxGuiComposerView.showImagePreview(this, anchor, url);
	}

	hideImagePreview(this: KnoxGuiWidget): void {
		knoxGuiComposerView.hideImagePreview(this);
	}
}
