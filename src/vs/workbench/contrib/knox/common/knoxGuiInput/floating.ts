/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Mention panel placement without floating-ui. */

export const MENTION_FLOATING_OFFSET = 6;
export const MENTION_FLOATING_PADDING = 8;
export const MENTION_PANEL_MAX_WIDTH = 420;
export const MENTION_PANEL_MAX_HEIGHT_RATIO = 0.4;

export function preferredMentionPlacement(anchorBottom: number, viewportHeight: number): 'top' | 'bottom' {
	if (viewportHeight <= 0) {
		return 'bottom';
	}
	return viewportHeight - anchorBottom < viewportHeight / 3 ? 'top' : 'bottom';
}

/**
 * `getSuggestion.ts` floating-ui setup without the library: prefer the roomier
 * side, flip when the panel does not fit, shift inside the viewport, cap at
 * 420px wide and 40% of the viewport tall.
 */
export function mentionFloatingPosition(args: {
	anchor: { left: number; top: number; bottom: number };
	viewport: { width: number; height: number };
	contentHeight: number;
}): { left: number; top: number; width: number; maxHeight: number; placement: 'top' | 'bottom' } {
	const { anchor, viewport } = args;
	const pad = MENTION_FLOATING_PADDING;
	const width = Math.max(0, Math.min(viewport.width - pad * 2, MENTION_PANEL_MAX_WIDTH));
	const above = Math.max(0, anchor.top - MENTION_FLOATING_OFFSET - pad);
	const below = Math.max(0, viewport.height - anchor.bottom - MENTION_FLOATING_OFFSET - pad);
	const cap = Math.max(0, viewport.height * MENTION_PANEL_MAX_HEIGHT_RATIO);
	let placement = preferredMentionPlacement(anchor.bottom, viewport.height);
	const wanted = Math.min(args.contentHeight, cap);
	const room = placement === 'top' ? above : below;
	const other = placement === 'top' ? below : above;
	if (wanted > room && other > room) {
		placement = placement === 'top' ? 'bottom' : 'top';
	}
	const maxHeight = Math.min(placement === 'top' ? above : below, cap);
	const height = Math.min(args.contentHeight, maxHeight);
	const left = Math.max(pad, Math.min(anchor.left, viewport.width - pad - width));
	const top = placement === 'top' ? anchor.top - MENTION_FLOATING_OFFSET - height : anchor.bottom + MENTION_FLOATING_OFFSET;
	return { left, top, width, maxHeight, placement };
}
