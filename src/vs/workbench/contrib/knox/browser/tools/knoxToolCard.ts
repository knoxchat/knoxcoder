/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { safeSetInnerHtml } from '../../../../../base/browser/domSanitize.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IKnoxTool, IKnoxToolCallState } from '../../common/knoxChatTypes.js';
import { appendKnoxGuiIcon, knoxGuiIconClass, knoxToolStatusIconName } from '../knoxGuiIcons.js';
import {
	knoxShouldShowToolParameters,
	knoxToolArgEntries,
	knoxToolStatusMessage,
} from '../../common/knoxToolCard.js';

export interface IKnoxToolUiState {
	argsExpanded: Set<string>;
	treeCollapsed: Set<string>;
	treeTab: Map<string, 'structure' | 'summary'>;
	askAnswers: Map<string, Record<string, string | string[]>>;
	askIndex: Map<string, number>;
	searchCollapsed: Set<string>;
	peekExpanded: Set<string>;
}

export function renderKnoxToolWrapper(
	parent: HTMLElement,
	state: IKnoxToolCallState,
	tool: IKnoxTool | undefined,
	ui: IKnoxToolUiState,
	hover: IHoverService,
	store: DisposableStore,
	onToggleArgs: () => void,
	renderBody: (host: HTMLElement) => void,
): void {
	const root = append(parent, $('.knox-tool-card'));
	const header = append(root, $('.knox-tool-header'));
	const left = append(header, $('.knox-tool-header-left'));

	const icon = append(left, $('span.knox-tool-status-icon'));
	icon.className = `${knoxGuiIconClass(knoxToolStatusIconName(state.status))} knox-tool-status-icon`;
	icon.setAttribute('aria-hidden', 'true');

	if (tool?.faviconUrl) {
		const img = append(left, $<HTMLImageElement>('img.knox-tool-favicon'));
		img.src = tool.faviconUrl;
		img.alt = localize('knox.toolIcon', "Tool icon");
	}

	const status = knoxToolStatusMessage(state, tool);
	const message = append(left, $('div.knox-tool-status-msg'));
	const knox = localize('knox', "Knox");
	const intro = status.intro ? ` ${status.intro} ` : ' ';
	const html = `<span class="knox-tool-knox">${escapeText(knox)}</span>${escapeText(intro)}<span class="knox-tool-status-body">${status.message}</span>`;
	safeSetInnerHtml(message, html, {
		allowedTags: { override: ['span', 'code', 'b', 'i', 'em', 'strong'] },
		allowedAttributes: { augment: ['class'] },
	});

	const showParams = knoxShouldShowToolParameters(state);
	const toolId = state.toolCallId || state.toolCall.id;
	if (showParams) {
		const expanded = ui.argsExpanded.has(toolId);
		const toggle = append(header, $<HTMLButtonElement>('button.knox-icon-button.knox-tool-args-toggle'));
		toggle.type = 'button';
		toggle.setAttribute('aria-expanded', String(expanded));
		const hint = expanded
			? localize('knox.hideParameters', "Hide parameters")
			: localize('knox.showParameters', "Show parameters");
		toggle.setAttribute('aria-label', hint);
		appendKnoxGuiIcon(toggle, expanded ? 'lucide-chevron-up' : 'lucide-chevron-down');
		store.add(hover.setupManagedHover(getDefaultHoverDelegate('mouse'), toggle, hint));
		store.add(addDisposableListener(toggle, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			if (ui.argsExpanded.has(toolId)) {
				ui.argsExpanded.delete(toolId);
			} else {
				ui.argsExpanded.add(toolId);
			}
			onToggleArgs();
		}));
	}

	if (showParams && ui.argsExpanded.has(toolId)) {
		const args = append(root, $('.knox-tool-args'));
		for (const [key, value] of knoxToolArgEntries(state)) {
			const row = append(args, $('.knox-tool-arg'));
			append(row, $('span.knox-tool-arg-key')).textContent = `${key}:`;
			append(row, $('code.knox-tool-arg-value')).textContent = value;
		}
	}

	const body = append(root, $('.knox-tool-body'));
	renderBody(body);
}

function escapeText(value: string): string {
	return value.replace(/[&<>"']/g, ch => {
		switch (ch) {
			case '&': return '&amp;';
			case '<': return '&lt;';
			case '>': return '&gt;';
			case '"': return '&quot;';
			default: return '&#39;';
		}
	});
}
