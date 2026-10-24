/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Terminal tool card: command head, ANSI tail, copy/stop, and in-place live patch. */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { appendKnoxGuiSvg, replaceKnoxGuiSvg } from '../../knoxGuiIcons.js';
import { setCollapseChevronExpanded } from '../controls.js';
import {
	DARK_TERMINAL_PALETTE,
	extractLogPathFromTerminalOutput,
	extractTerminalOutput,
	LIGHT_TERMINAL_PALETTE,
	takeTerminalTail,
	terminalBodyHeight,
	terminalCommandForTool,
	toolOutputText,
} from '../../../../common/knoxGuiTools.js';
import { IKnoxGuiState, IKnoxGuiToolCall } from '../../../../common/knoxGuiState.js';
import { knoxGuiHljsTokenColor } from '../../../../common/knoxGuiTheme.js';

export function renderTerminalTool(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
	const isLight = widget.isLightTheme();
	const card = DOM.append(parent, DOM.$('.knox-gui-term'));
	card.classList.toggle('light', isLight);
	card.setAttribute('data-testid', 'knox-gui-term');
	card.dataset.toolId = tool.id;
	// The transcript is rebuilt wholesale on most state changes; replaying the fade/slide
	// entrance each time made every terminal card flash. Animate only the first live mount.
	const live = tool.status === 'generating' || tool.status === 'generated' || tool.status === 'calling';
	if (live && !widget.termEntered.has(tool.id)) {
		card.classList.add('knox-gui-term-enter');
	}
	widget.termEntered.add(tool.id);
	const head = DOM.append(card, DOM.$('.knox-gui-term-head'));
	const left = DOM.append(head, DOM.$('.knox-gui-term-head-left'));
	widget.collapseChevron(left, {
		expanded: widget.cardExpanded(tool.id, true),
		title: t(state, 'collapse'),
		testId: 'xterm-collapse',
		onClick: () => widget.toggleCardExpanded(tool.id, true),
	});
	const icon = appendKnoxGuiSvg(left, 'square-terminal', 13);
	icon.classList.add('knox-gui-term-icon');
	DOM.append(left, DOM.$('span.knox-gui-term-title', undefined, t(state, 'terminal')));
	DOM.append(head, DOM.$('.knox-gui-term-head-right'));
	syncTerminalCard(widget, card, state, tool);
}

export function syncTerminalCard(widget: KnoxGuiWidget, card: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
	const args = tool.parsedArgs ?? {};
	const command = terminalCommandForTool(tool.name, args, (key, vars) => t(state, key, vars));
	const items = tool.outputItems?.length ? tool.outputItems : (tool.output ? [{ content: tool.output }] : []);
	const raw = extractTerminalOutput(items) || toolOutputText(items, tool.output);
	const { tail, truncated, hiddenLines } = takeTerminalTail(raw);
	const isLight = widget.isLightTheme();
	const palette = isLight ? LIGHT_TERMINAL_PALETTE : DARK_TERMINAL_PALETTE;
	const isStreaming = tool.status === 'calling' || tool.status === 'generating';
	const isDone = tool.status === 'done';
	const isCanceled = tool.status === 'canceled';
	const logPath = extractLogPathFromTerminalOutput(raw);
	const expanded = widget.cardExpanded(tool.id, true);
	const height = terminalBodyHeight(tail, Boolean(command));
	if ((widget.termPrevLen.get(tool.id) ?? 0) === 0 && raw.length > 0) {
		widget.termUserScrolled.delete(tool.id);
	}
	widget.termPrevLen.set(tool.id, raw.length);

	card.classList.toggle('light', isLight);
	card.classList.toggle('knox-gui-term-running', isStreaming);
	card.dataset.toolId = tool.id;

	const head = card.querySelector('.knox-gui-term-head') as HTMLElement | null;
	if (head) {
		head.classList.toggle('collapsed', !expanded);
	}
	const chevron = card.querySelector('[data-testid="xterm-collapse"]') as HTMLElement | null;
	if (chevron) {
		setCollapseChevronExpanded(chevron, expanded, expanded ? t(state, 'collapse') : t(state, 'expand'));
	}
	const title = card.querySelector('.knox-gui-term-title') as HTMLElement | null;
	if (title) {
		let hint = title.querySelector('.knox-gui-term-truncated') as HTMLElement | null;
		if (truncated) {
			if (!hint) {
				hint = DOM.append(title, DOM.$('span.knox-gui-term-truncated'));
				hint.setAttribute('data-testid', 'xterm-truncated');
			}
			hint.textContent = t(state, 'truncatedTerminalOutput', { lines: hiddenLines });
		} else {
			hint?.remove();
		}
	}

	const right = card.querySelector('.knox-gui-term-head-right') as HTMLElement | null;
	if (right) {
		syncTerminalBadge(right, state, isStreaming, isDone, isCanceled);
		// K-041: a running command can be stopped from its own card.
		const stop = right.querySelector('[data-testid="xterm-stop"]');
		if (isStreaming && !stop) {
			widget.chromeButton(right, {
				svg: 'x',
				svgSize: 14,
				label: t(state, 'stopCommand'),
				title: t(state, 'stopCommand'),
				testId: 'xterm-stop',
				extraClass: 'knox-gui-term-action',
				onClick: () => widget.controller.cancelTool(tool.id),
			});
		} else if (!isStreaming && stop) {
			stop.remove();
		}
		if (raw && !right.querySelector('[data-testid="xterm-copy-output"]')) {
			appendTerminalCopyAction(widget, right, state, {
				testId: 'xterm-copy-output',
				copyKey: `out:${tool.id}`,
				text: tool.output || raw,
				idleLabel: t(state, 'copy'),
				idleTitle: t(state, 'copyOutput'),
				showLabel: true,
			});
		}
		const copyOut = right.querySelector('[data-testid="xterm-copy-output"]') as HTMLElement | null;
		if (copyOut && raw) {
			copyOut.dataset.copyText = tool.output || raw;
		}
		if (logPath && !right.querySelector('[data-testid="xterm-open-full-log"]')) {
			widget.chromeButton(right, {
				svg: 'file-text',
				svgSize: 14,
				label: t(state, 'openFullLog'),
				title: t(state, 'openFullLog'),
				testId: 'xterm-open-full-log',
				extraClass: 'knox-gui-term-action',
				onClick: () => widget.controller.showFile(logPath),
			});
		}
		if (command && !right.querySelector('[data-testid="xterm-copy-command"]')) {
			appendTerminalCopyAction(widget, right, state, {
				testId: 'xterm-copy-command',
				copyKey: `cmd:${tool.id}`,
				text: command,
				idleLabel: t(state, 'copy'),
				idleTitle: t(state, 'copyCommand'),
				showLabel: false,
			});
		}
	}

	if (!expanded) {
		card.querySelector('.knox-gui-term-body')?.remove();
		return;
	}

	let body = card.querySelector('.knox-gui-term-body') as HTMLElement | null;
	if (!body) {
		body = DOM.append(card, DOM.$('.knox-gui-term-body'));
		bindTerminalScroll(widget, body, tool.id);
	}
	body.style.height = `${height}px`;
	body.classList.toggle('wrap', Boolean(state.codeWrap));
	let pre = body.querySelector('pre.knox-gui-term-pre') as HTMLElement | null;
	if (!pre) {
		pre = DOM.append(body, DOM.$('pre.knox-gui-term-pre'));
	}
	if (command) {
		let line = pre.querySelector('.knox-gui-term-prompt-line') as HTMLElement | null;
		if (!line) {
			line = DOM.append(pre, DOM.$('span.knox-gui-term-prompt-line'));
			// allow-any-unicode-next-line
			const prompt = DOM.append(line, DOM.$('span.knox-gui-term-prompt', undefined, '❯'));
			prompt.classList.add('hljs-title', 'function_');
			prompt.style.color = knoxGuiHljsTokenColor(state.vscTokenColors, ['.hljs-title.function_', '.hljs-built_in'], palette.green);
			const cmd = DOM.append(line, DOM.$('span.knox-gui-term-command', undefined, command));
			cmd.classList.add('hljs-string');
			cmd.style.color = knoxGuiHljsTokenColor(state.vscTokenColors, ['.hljs-string'], palette.foreground);
			cmd.setAttribute('data-testid', 'xterm-command');
		} else {
			const cmd = line.querySelector('[data-testid="xterm-command"]');
			if (cmd && cmd.textContent !== command) {
				cmd.textContent = command;
			}
		}
	}
	let out = pre.querySelector('.knox-gui-term-output') as HTMLElement | null;
	const cursor = pre.querySelector('.knox-gui-term-cursor') as HTMLElement | null;
	if (tail) {
		if (!out) {
			out = DOM.append(pre, DOM.$('span.knox-gui-term-output'));
			out.setAttribute('data-testid', 'xterm-output');
		}
		if (out.dataset.tail !== tail) {
			out.dataset.tail = tail;
			widget.appendAnsi(out, tail, palette);
		}
		cursor?.remove();
	} else {
		out?.remove();
		if (isStreaming && !cursor) {
			// allow-any-unicode-next-line
			DOM.append(pre, DOM.$('span.knox-gui-term-cursor', undefined, '▋'));
		} else if (!isStreaming) {
			cursor?.remove();
		}
	}
	queueMicrotask(() => {
		if (!body) {
			return;
		}
		if (widget.termUserScrolled.has(tool.id)) {
			body.scrollTop = widget.termScrollTop.get(tool.id) ?? 0;
		} else {
			body.scrollTop = body.scrollHeight;
			widget.termScrollTop.set(tool.id, body.scrollTop);
		}
	});
}

function syncTerminalBadge(right: HTMLElement, state: IKnoxGuiState, isStreaming: boolean, isDone: boolean, isCanceled: boolean): void {
	const next = isStreaming ? 'running' : isDone ? 'done' : isCanceled ? 'canceled' : '';
	let badge = right.querySelector('.knox-gui-term-badge') as HTMLElement | null;
	if (!next) {
		badge?.remove();
		return;
	}
	if (badge?.dataset.kind === next) {
		return;
	}
	badge?.remove();
	badge = DOM.append(right, DOM.$(`.knox-gui-term-badge.knox-gui-term-badge-${next}`));
	badge.dataset.kind = next;
	right.insertBefore(badge, right.firstChild);
	if (isStreaming) {
		DOM.append(badge, DOM.$('span.knox-gui-term-pulse'));
		DOM.append(badge, DOM.$('span', undefined, t(state, 'running')));
	} else if (isDone) {
		appendKnoxGuiSvg(badge, 'check', 12);
		DOM.append(badge, DOM.$('span', undefined, t(state, 'toolUsed')));
	} else {
		appendKnoxGuiSvg(badge, 'x', 12);
		DOM.append(badge, DOM.$('span', undefined, t(state, 'toolCanceled')));
	}
}

function bindTerminalScroll(widget: KnoxGuiWidget, body: HTMLElement, toolId: string): void {
	if (body.dataset.scrollBound === '1') {
		return;
	}
	body.dataset.scrollBound = '1';
	widget.listenerStore.add(DOM.addDisposableListener(body, 'scroll', () => {
		const { scrollTop, scrollHeight, clientHeight } = body;
		const atBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 30;
		const last = widget.termScrollTop.get(toolId) ?? 0;
		if (scrollTop < last && !atBottom) {
			widget.termUserScrolled.add(toolId);
		} else if (atBottom) {
			widget.termUserScrolled.delete(toolId);
		}
		widget.termScrollTop.set(toolId, scrollTop);
	}));
}

function appendTerminalCopyAction(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, options: {
	testId: string;
	copyKey: string;
	text: string;
	idleLabel: string;
	idleTitle: string;
	showLabel: boolean;
}): void {
	const copied = (widget.termCopiedUntil.get(options.copyKey) ?? 0) > Date.now();
	const btn = DOM.append(parent, DOM.$(options.showLabel ? 'button.knox-gui-term-action' : 'button.knox-gui-term-copy')) as HTMLButtonElement;
	btn.type = 'button';
	btn.setAttribute('data-testid', options.testId);
	btn.dataset.copyText = options.text;
	btn.setAttribute('aria-label', copied ? t(state, 'copied') : options.idleTitle);
	const icon = appendKnoxGuiSvg(btn, copied ? 'check' : 'copy', 14);
	icon.classList.add('knox-gui-term-action-icon');
	if (options.showLabel) {
		DOM.append(btn, DOM.$('span.knox-gui-term-action-label', undefined, copied ? t(state, 'copied') : options.idleLabel));
	}
	widget.hover(btn, copied ? t(state, 'copied') : options.idleTitle);
	widget.listenerStore.add(DOM.addDisposableListener(btn, 'click', e => {
		e.stopPropagation();
		const text = btn.dataset.copyText || options.text;
		widget.controller.copyText(text);
		widget.termCopiedUntil.set(options.copyKey, Date.now() + 2000);
		replaceKnoxGuiSvg(btn, 'check', 14).classList.add('knox-gui-term-action-icon');
		const label = btn.querySelector('.knox-gui-term-action-label');
		if (label) {
			label.textContent = t(state, 'copied');
		}
		window.setTimeout(() => {
			if ((widget.termCopiedUntil.get(options.copyKey) ?? 0) <= Date.now()) {
				widget.termCopiedUntil.delete(options.copyKey);
				replaceKnoxGuiSvg(btn, 'copy', 14).classList.add('knox-gui-term-action-icon');
				if (label) {
					label.textContent = options.idleLabel;
				}
			}
		}, 2000);
	}));
}
