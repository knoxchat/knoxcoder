/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * K-041: noisy tool results (long reads, greps, directory listings) start collapsed
 * once the call finishes, so the transcript shows the one-line summary instead of
 * pages of output. Edits, shell output, questions and short results stay open.
 */

import type { IKnoxGuiToolCall } from './knoxGuiState.js';
import { classifyAgentActivityKind } from './knoxGuiTranscript.js';

export const KNOX_TOOL_AUTO_COLLAPSE_LINES = 12;
export const KNOX_TOOL_AUTO_COLLAPSE_CHARS = 1500;

function outputText(call: IKnoxGuiToolCall): string {
	const items = call.outputItems?.map(item => item.content).filter(Boolean).join('\n');
	return items || call.output || '';
}

export function knoxGuiToolAutoCollapses(call: IKnoxGuiToolCall): boolean {
	if (call.status !== 'done') {
		return false;
	}
	const kind = classifyAgentActivityKind(call.name, call.parsedArgs);
	if (kind !== 'read' && kind !== 'search' && kind !== 'other') {
		return false;
	}
	const text = outputText(call);
	if (!text) {
		return false;
	}
	return text.length > KNOX_TOOL_AUTO_COLLAPSE_CHARS || text.split('\n').length > KNOX_TOOL_AUTO_COLLAPSE_LINES;
}

/**
 * Whether the body is collapsed right now. A user choice always wins: `userExpanded`
 * (opened a collapsed card) over `userCollapsed` over the automatic rule.
 */
export function knoxGuiToolBodyCollapsed(call: IKnoxGuiToolCall, user: { expanded: boolean; collapsed: boolean }): boolean {
	if (user.expanded) {
		return false;
	}
	return user.collapsed || Boolean(call.collapsed) || knoxGuiToolAutoCollapses(call);
}

/** Next explicit user state when the chevron is clicked on a card that is currently `showing` its body. */
export function knoxGuiToolToggle(showing: boolean): { expanded: boolean; collapsed: boolean } {
	return showing ? { expanded: false, collapsed: true } : { expanded: true, collapsed: false };
}
