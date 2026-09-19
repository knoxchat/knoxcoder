/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { IntervalTimer } from '../../../../../base/common/async.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass } from '../knoxGuiIcons.js';
import { IMarkdownRendererService } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { IKnoxReasoning } from '../../common/knoxChatTypes.js';
import { knoxNls } from '../../common/knoxI18n.js';
import { renderKnoxMarkdown } from './knoxMarkdown.js';

const COLLAPSED_LINES = 12;

export interface IKnoxReasoningPaintOptions {
	reasoning?: IKnoxReasoning;
	text?: string;
	redacted?: boolean;
	inProgress?: boolean;
}

export function knoxFormatThinkingElapsed(ms: number): string {
	return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

/**
 * Native `ThinkingBlockPeek`: collapsed by default, live elapsed while
 * `inProgress`, redacted/security copy, and in-place chevron toggle (no list
 * refresh).
 */
export function renderKnoxReasoning(
	container: HTMLElement,
	options: IKnoxReasoningPaintOptions,
	markdownRenderer: IMarkdownRendererService,
	store: DisposableStore,
	collapsedRef: { value: boolean },
	onToggle: () => void,
): void {
	const local = new DisposableStore();
	store.add(local);

	const paint = (): void => {
		local.clear();
		clearNode(container);

		const redacted = options.redacted === true;
		const text = (options.text ?? options.reasoning?.text ?? '').trim();
		if (!text && !redacted && !options.inProgress) {
			container.classList.add('hidden');
			return;
		}
		container.classList.remove('hidden');

		const streaming = options.inProgress === true || options.reasoning?.active === true;
		const lineCount = text.split('\n').length;
		const long = !redacted && lineCount > COLLAPSED_LINES;
		const collapsed = collapsedRef.value;
		const startAt = options.reasoning?.startAt || Date.now();
		const endAt = options.reasoning?.endAt;
		let elapsed = '';
		if (streaming) {
			elapsed = knoxFormatThinkingElapsed(Date.now() - startAt);
		} else if (endAt) {
			elapsed = knoxFormatThinkingElapsed(endAt - (options.reasoning?.startAt || endAt));
		}

		const header = append(container, $<HTMLButtonElement>('button.knox-reasoning-header'));
		header.type = 'button';
		header.setAttribute('data-testid', 'thinking-block-peek');
		header.setAttribute('aria-expanded', String(!collapsed));
		if (streaming) {
			header.classList.add('streaming');
		}
		const title = append(header, $('span.knox-reasoning-title'));
		title.textContent = thinkingTitle(streaming, redacted, elapsed);
		const chevron = append(header, $('span.knox-reasoning-chevron'));
		chevron.className = knoxGuiIconClass(collapsed ? 'lucide-chevron-down' : 'lucide-chevron-up');
		local.add(addDisposableListener(header, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			collapsedRef.value = !collapsedRef.value;
			onToggle();
			paint();
		}));

		if (streaming) {
			const timer = new IntervalTimer();
			timer.cancelAndSet(() => {
				title.textContent = thinkingTitle(true, redacted, knoxFormatThinkingElapsed(Date.now() - startAt));
			}, 200);
			local.add(timer);
		}

		if (collapsed) {
			const hidden = append(container, $('div.knox-reasoning-hidden'));
			hidden.textContent = localize('knox.thinkingHidden', "Thinking content hidden");
			return;
		}

		const body = append(container, $('div.knox-reasoning-body'));
		if (redacted) {
			body.classList.add('knox-reasoning-redacted');
			body.textContent = knoxNls('thinkingDeletedSecurity');
			return;
		}
		if (long) {
			body.classList.add('scrollable');
		}
		renderKnoxMarkdown(body, text, markdownRenderer, local, { fillInIncompleteTokens: streaming });
		if (streaming) {
			body.scrollTop = body.scrollHeight;
		}
		if (long) {
			append(container, $('div.knox-reasoning-more')).textContent = localize('knox.scrollToSeeMore', "Scroll to see more");
		}
	};

	paint();
}

function thinkingTitle(streaming: boolean, redacted: boolean, elapsed: string): string {
	if (streaming) {
		const label = redacted ? knoxNls('hiddenThinking') : knoxNls('thinking');
		return elapsed ? `${label} ${elapsed}` : label;
	}
	if (redacted) {
		return knoxNls('hiddenThinking');
	}
	const result = knoxNls('thinkingResult');
	return elapsed ? knoxNls('thinkingResultTime', { time: elapsed }, `${result} ${elapsed}`) : result;
}
