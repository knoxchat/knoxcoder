/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass } from '../knoxGuiIcons.js';
import { IMarkdownRendererService } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { IKnoxReasoning } from '../../common/knoxChatTypes.js';
import { renderKnoxMarkdown } from './knoxMarkdown.js';

const COLLAPSED_LINES = 12;

export function renderKnoxReasoning(
	container: HTMLElement,
	reasoning: IKnoxReasoning | undefined,
	markdownRenderer: IMarkdownRendererService,
	store: DisposableStore,
	collapsedRef: { value: boolean },
	onToggle: () => void,
): void {
	clearNode(container);
	const text = reasoning?.text?.trim() ?? '';
	if (!text) {
		container.classList.add('hidden');
		return;
	}
	container.classList.remove('hidden');

	const streaming = reasoning?.active === true;
	const lineCount = text.split('\n').length;
	const long = lineCount > COLLAPSED_LINES;
	const collapsed = collapsedRef.value;
	let timeLabel = '';
	if (reasoning?.endAt) {
		const startAt = reasoning.startAt || reasoning.endAt;
		timeLabel = `${((reasoning.endAt - startAt) / 1000).toFixed(1)}s`;
	}

	const header = append(container, $<HTMLButtonElement>('button.knox-reasoning-header'));
	header.type = 'button';
	const title = streaming
		? localize('knox.thinking', "Thinking")
		: timeLabel
			? localize('knox.thinkingTimed', "Thinking ({0})", timeLabel)
			: localize('knox.thinking', "Thinking");
	append(header, $('span.knox-reasoning-title')).textContent = title;
	if (streaming) {
		header.classList.add('streaming');
	}
	const chevron = append(header, $('span.knox-reasoning-chevron'));
	chevron.className = knoxGuiIconClass(collapsed ? 'lucide-chevron-down' : 'lucide-chevron-up');
	store.add(addDisposableListener(header, 'click', e => {
		e.preventDefault();
		e.stopPropagation();
		collapsedRef.value = !collapsedRef.value;
		onToggle();
	}));

	if (collapsed) {
		const hidden = append(container, $('div.knox-reasoning-hidden'));
		hidden.textContent = localize('knox.thinkingHidden', "Thinking content hidden");
		return;
	}

	const body = append(container, $('div.knox-reasoning-body'));
	if (long) {
		body.classList.add('scrollable');
	}
	renderKnoxMarkdown(body, text, markdownRenderer, store, { fillInIncompleteTokens: streaming });
	if (streaming) {
		body.scrollTop = body.scrollHeight;
	}
	if (long) {
		append(container, $('div.knox-reasoning-more')).textContent = localize('knox.scrollToSeeMore', "Scroll to see more");
	}
}
