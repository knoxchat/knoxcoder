/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Composer and mention-list keyboard actions, IME, and meta-key helpers. */

export function mentionOptionId(index: number): string {
	return `mention-option-${index}`;
}

export function wrapMentionIndex(current: number, total: number, delta: number): number {
	if (total <= 0) {
		return 0;
	}
	return (current + delta + total) % total;
}

export type MentionListKeyAction =
	| { type: 'move'; index: number }
	| { type: 'select' }
	| { type: 'close' }
	| { type: 'ignore' };

export function mentionListKeyAction(key: string, selectedIndex: number, total: number): MentionListKeyAction {
	switch (key) {
		case 'ArrowUp':
			return { type: 'move', index: wrapMentionIndex(selectedIndex, total, -1) };
		case 'ArrowDown':
			return { type: 'move', index: wrapMentionIndex(selectedIndex, total, 1) };
		case 'Home':
			return { type: 'move', index: 0 };
		case 'End':
			return { type: 'move', index: Math.max(0, total - 1) };
		case 'Enter':
		case 'Tab':
			return { type: 'select' };
		case 'Escape':
			return { type: 'close' };
		case ' ':
			return total === 1 ? { type: 'select' } : { type: 'ignore' };
		default:
			return { type: 'ignore' };
	}
}

export type KnoxGuiComposerKeyAction =
	| { type: 'submit'; altKey: boolean }
	| { type: 'newline' }
	| { type: 'block-backspace' }
	| { type: 'accept-diffs' }
	| { type: 'reject-diffs' }
	| { type: 'history-prev' }
	| { type: 'history-next' }
	| { type: 'suggest'; action: MentionListKeyAction }
	| { type: 'exit-submenu' }
	| { type: 'undo' }
	| { type: 'redo' }
	| { type: 'ignore' };

export function knoxGuiIsMetaEquivalent(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
	return event.metaKey || event.ctrlKey;
}

/** How long after `compositionend` to ignore Enter/Tab so an IME confirm does not submit. */
export const KNOX_COMPOSER_IME_SUBMIT_GUARD_MS = 100;

/** CJK IME: `isComposing`, or `keyCode` 229 on the first keydown before composition has started. */
export function knoxGuiIsImeComposing(event: { isComposing?: boolean; keyCode?: number }): boolean {
	return Boolean(event.isComposing) || event.keyCode === 229;
}

export type KnoxGuiComposerKeyCtx = {
	suggestOpen: boolean;
	inSubmenu: boolean;
	isStreaming: boolean;
	caretAtStart: boolean;
	caretAtEnd: boolean;
	suggestSelected: number;
	suggestCount: number;
	/** Widget still owns an in-flight composition (`composerImeDepth > 0`). */
	imeActive?: boolean;
	/** Ignore Enter/Tab until this timestamp (ms since epoch). */
	imeIgnoreSubmitUntil?: number;
	/** Injected clock for tests; defaults to `Date.now()`. */
	now?: number;
};

export function knoxGuiComposerKeyAction(
	event: { key: string; shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean; isComposing?: boolean; keyCode?: number },
	ctx: KnoxGuiComposerKeyCtx,
): KnoxGuiComposerKeyAction {
	// IME composition (CJK candidate confirm etc.) must never submit, navigate or close pickers (ProseMirror ignores keys while composing).
	if (knoxGuiIsImeComposing(event) || ctx.imeActive) {
		return { type: 'ignore' };
	}
	// Some IMEs deliver the confirm Enter after compositionend, with isComposing false and keyCode 13.
	if ((event.key === 'Enter' || event.key === 'Tab') && (ctx.imeIgnoreSubmitUntil ?? 0) > (ctx.now ?? Date.now())) {
		return { type: 'ignore' };
	}
	const meta = knoxGuiIsMetaEquivalent(event);
	const key = event.key.toLowerCase();
	if (meta && !event.altKey && ((key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey))) {
		return { type: 'redo' };
	}
	if (meta && !event.altKey && key === 'z') {
		return { type: 'undo' };
	}
	if (event.key === 'Enter' && meta && event.shiftKey) {
		return { type: 'accept-diffs' };
	}
	if (event.key === 'Backspace' && meta && event.shiftKey) {
		return { type: 'reject-diffs' };
	}
	if (event.key === 'Backspace' && meta && !event.shiftKey) {
		return ctx.isStreaming ? { type: 'block-backspace' } : { type: 'ignore' };
	}
	if (event.key === 'Enter' && meta) {
		return { type: 'submit', altKey: event.altKey };
	}
	if (event.key === 'Enter' && event.altKey && !event.shiftKey) {
		return { type: 'submit', altKey: true };
	}
	if (ctx.suggestOpen) {
		if (event.key === 'ArrowLeft' && ctx.inSubmenu) {
			return { type: 'exit-submenu' };
		}
		const action = mentionListKeyAction(event.key, ctx.suggestSelected, ctx.suggestCount);
		if (action.type !== 'ignore') {
			return { type: 'suggest', action };
		}
		return { type: 'ignore' };
	}
	if (event.key === 'Enter') {
		return event.shiftKey ? { type: 'newline' } : { type: 'submit', altKey: event.altKey };
	}
	if (event.key === 'ArrowUp' && ctx.caretAtStart) {
		return { type: 'history-prev' };
	}
	if (event.key === 'ArrowDown' && ctx.caretAtEnd) {
		return { type: 'history-next' };
	}
	return { type: 'ignore' };
}
