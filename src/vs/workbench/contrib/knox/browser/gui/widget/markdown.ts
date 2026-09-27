/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../knoxGuiWidget.js';
import { t } from './t.js';
import * as DOM from '../../../../../../base/browser/dom.js';
import { renderMarkdown } from '../../../../../../base/browser/markdownRenderer.js';
import { MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { tokenizeToStringSync } from '../../../../../../editor/common/languages/textToHtmlTokenizer.js';
import { knoxGuiShowsEditResponseAcceptReject } from '../../../common/knoxGuiChrome.js';
import { appendKnoxGuiSvg, setKnoxGuiInnerHtml } from '../knoxGuiIcons.js';
import { IKnoxGuiHistoryItem, IKnoxGuiState } from '../../../common/knoxGuiState.js';
import {
	activityAnchorId,
	applyUiAfterAppliedTimeout,
	applyUiForState,
	APPLIED_PILL_MS,
	fenceApplyStreamId,
	fenceHasFileToolbar,
	formatReasoningTime,
	isTerminalCodeBlock,
	languageIdFromFence,
	looksLikeFilePath,
	pendingApplyStates,
} from '../../../common/knoxGuiTranscript.js';

export function appendMarkdown(widget: KnoxGuiWidget, parent: HTMLElement, source: string, store = widget.renderStore): void {
	const md = store.add(renderMarkdown(new MarkdownString(source, { supportHtml: false, isTrusted: false }), {
		actionHandler: href => { void widget.openerService.open(href); },
	}));
	parent.appendChild(md.element);
	for (const code of Array.from(md.element.querySelectorAll('code'))) {
		if (code.closest('pre')) {
			continue;
		}
		const text = code.textContent ?? '';
		if (!looksLikeFilePath(text)) {
			continue;
		}
		code.classList.add('knox-gui-symbol-link');
		code.setAttribute('role', 'button');
		code.tabIndex = 0;
		widget.hover(code as HTMLElement, text);
		store.add(DOM.addDisposableListener(code as HTMLElement, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			widget.controller.showFile(text.trim());
		}));
	}
}

export function renderCodeFence(widget: KnoxGuiWidget,
	parent: HTMLElement,
	state: IKnoxGuiState,
	item: IKnoxGuiHistoryItem,
	fence: { language: string; filepath?: string; range?: string; code: string; closed: boolean },
	fenceIndex: number,
	generating: boolean,
): void {
	const streamId = fenceApplyStreamId(item.id, fenceIndex);
	const fileToolbar = fenceHasFileToolbar(fence.filepath);
	const collapsed = widget.fenceCollapsed.has(streamId);
	const box = DOM.append(parent, DOM.$(fileToolbar ? '.knox-gui-code-block' : '.knox-gui-code-block.knox-gui-code-generic'));
	const toolbar = DOM.$('.knox-gui-code-toolbar');
	if (fileToolbar) {
		widget.chromeButton(toolbar, {
			svg: collapsed ? 'chevron-right' : 'chevron-down',
			svgSize: 12,
			title: collapsed ? t(state, 'expand') : t(state, 'collapse'),
			onClick: () => {
				if (collapsed) {
					widget.fenceCollapsed.delete(streamId);
				} else {
					widget.fenceCollapsed.add(streamId);
				}
				widget.render();
			},
		});
		widget.renderClickablePath(toolbar, fence.filepath!, { range: fence.range, showIcon: true });
	}
	const actions = DOM.append(toolbar, DOM.$(fileToolbar ? '.knox-gui-code-actions' : '.knox-gui-code-actions.knox-gui-code-hover'));
	if (generating) {
		DOM.append(actions, DOM.$('span.knox-gui-muted', undefined, t(state, 'generating')));
	} else {
		widget.chromeButton(actions, { svg: 'copy', svgSize: 14, title: t(state, 'copyText'), onClick: () => widget.controller.copyText(fence.code) });
		if (isTerminalCodeBlock(fence.language, fence.code)) {
			widget.chromeButton(actions, { svg: 'terminal', svgSize: 14, title: t(state, 'runInTerminal'), onClick: () => widget.controller.messenger.post('runCommand', { command: fence.code }) });
		} else {
			widget.renderApplyActions(actions, state, streamId, fence);
		}
		if (!fileToolbar) {
			widget.chromeButton(actions, { svg: 'file-input', svgSize: 14, title: t(state, 'insert'), onClick: () => widget.controller.messenger.post('insertAtCursor', { text: fence.code }) });
		}
	}
	const pre = !collapsed ? DOM.$('div.knox-gui-code-pre') as HTMLElement : undefined;
	if (pre) {
		if (state.codeWrap) {
			pre.classList.add('wrap');
		}
		widget.paintHighlightedCode(pre, fence.language, fence.code, fence.filepath);
	}
	const bottomToolbar = state.codeBlockToolbarPosition === 'bottom';
	if (bottomToolbar && pre) {
		box.appendChild(pre);
		box.appendChild(toolbar);
	} else {
		box.appendChild(toolbar);
		if (pre) {
			box.appendChild(pre);
		}
	}
}

export function paintHighlightedCode(widget: KnoxGuiWidget, pre: HTMLElement, language: string, code: string, filepath?: string): void {
	try {
		const requested = languageIdFromFence(language, filepath);
		const languageId = widget.languageService.getLanguageIdByLanguageName(requested)
			?? (widget.languageService.isRegisteredLanguageId(requested) ? requested : 'plaintext');
		widget.languageService.requestBasicLanguageFeatures(languageId);
		const html = tokenizeToStringSync(widget.languageService, code, languageId);
		setKnoxGuiInnerHtml(pre, html);
	} catch {
		pre.textContent = code;
	}
}

export function renderApplyActions(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, streamId: string, fence: { code: string; filepath?: string }): void {
	const apply = state.applyStates.find(item => item.streamId === streamId);
	let ui = applyUiForState(apply);
	if (ui.kind === 'applied' && !widget.appliedUntil.has(streamId)) {
		widget.appliedUntil.set(streamId, Date.now() + APPLIED_PILL_MS);
		window.setTimeout(() => widget.controller.store.patch({}), APPLIED_PILL_MS);
	}
	if (ui.kind !== 'applied') {
		widget.appliedUntil.delete(streamId);
	}
	ui = applyUiAfterAppliedTimeout(ui, widget.appliedUntil.get(streamId), Date.now());
	const postApply = () => widget.controller.messenger.post('applyToFile', {
		text: fence.code,
		streamId,
		filepath: fence.filepath,
		curSelectedModelTitle: state.modelTitle,
	});
	if (ui.kind === 'streaming') {
		const pill = DOM.append(parent, DOM.$('span.knox-gui-apply-pill'));
		pill.textContent = t(state, 'applyingChanges');
		DOM.append(pill, DOM.$('span.codicon.codicon-loading.codicon-modifier-spin'));
		return;
	}
	if (ui.kind === 'done') {
		const pill = DOM.append(parent, DOM.$('span.knox-gui-apply-pill'));
		pill.textContent = `${t(state, 'diffsRemaining', { count: ui.numDiffs })} ${t(state, 'remaining')}`;
		widget.chromeButton(pill, {
			svg: 'x',
			svgSize: 16,
			title: t(state, 'rejectAll'),
			testId: 'edit-reject-button',
			onClick: () => widget.controller.messenger.post('rejectDiff', { streamId, filepath: apply?.filepath ?? fence.filepath }),
		});
		widget.chromeButton(pill, {
			svg: 'check',
			svgSize: 16,
			title: t(state, 'acceptAll'),
			testId: 'edit-accept-button',
			onClick: () => widget.controller.messenger.post('acceptDiff', { streamId, filepath: apply?.filepath ?? fence.filepath }),
		});
		return;
	}
	if (ui.kind === 'applied') {
		const pill = DOM.append(parent, DOM.$('span.knox-gui-apply-pill'));
		pill.textContent = t(state, 'applied');
		appendKnoxGuiSvg(pill, 'check', 14);
		return;
	}
	widget.chromeButton(parent, {
		svg: 'list-plus',
		svgSize: 14,
		label: t(state, ui.kind === 'reapply' ? 'reApply' : 'apply'),
		title: t(state, ui.kind === 'reapply' ? 'reApply' : 'apply'),
		extraClass: 'knox-gui-apply',
		onClick: () => postApply(),
	});
}

export function renderReasoning(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, index: number): void {
	const thinking = item.thinking?.trim();
	if (!thinking) {
		return;
	}
	const collapsed = item.thinkingCollapsed === true;
	const wrap = DOM.append(parent, DOM.$('.knox-gui-reasoning'));
	wrap.id = activityAnchorId(`reasoning:${item.id}`);
	const header = DOM.append(wrap, DOM.$('button.knox-gui-reasoning-header')) as HTMLButtonElement;
	header.type = 'button';
	DOM.append(header, DOM.$(`span.codicon.${collapsed ? 'codicon-chevron-right' : 'codicon-chevron-down'}`));
	const label = item.thinkingActive
		? t(state, 'thinkingEllipsis')
		: `${t(state, 'thinking')}${formatReasoningTime(item.thinkingStartAt, item.thinkingEndAt) ? ` (${formatReasoningTime(item.thinkingStartAt, item.thinkingEndAt)})` : ''}`;
	DOM.append(header, DOM.$('span', undefined, label));
	if (item.thinkingActive) {
		header.classList.add('thinking');
	}
	widget.renderStore.add(DOM.addDisposableListener(header, 'click', () => widget.toggleThinking(item, !collapsed)));
	if (!collapsed) {
		const body = DOM.append(wrap, DOM.$('.knox-gui-reasoning-body'));
		if (item.thinkingActive) {
			body.classList.add('knox-gui-reasoning-live');
		}
		if (item.redactedThinking) {
			DOM.append(body, DOM.$('.knox-gui-muted', undefined, t(state, 'thinkingDeletedSecurity')));
		} else if (state.markdownFormatting !== false) {
			widget.appendMarkdown(body, thinking);
		} else {
			DOM.append(body, DOM.$('pre', undefined, thinking));
		}
		if (item.thinkingActive) {
			queueMicrotask(() => {
				body.scrollTop = body.scrollHeight;
			});
		}
	}
	void index;
}

export function toggleThinking(widget: KnoxGuiWidget, item: IKnoxGuiHistoryItem, collapsed: boolean): void {
	const history = widget.controller.store.state.history.map(row => row.id === item.id ? { ...row, thinkingCollapsed: collapsed } : row);
	widget.controller.store.patch({ history });
}

export function renderThinkingPeekBlock(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, index: number, inProgress: boolean): void {
	const wrap = DOM.append(parent, DOM.$('.knox-gui-thinking-peek'));
	wrap.setAttribute('data-testid', 'thinking-block-peek');
	wrap.id = activityAnchorId(`thinking:${item.id}`);
	const open = item.thinkingCollapsed !== true;
	const chip = DOM.append(wrap, DOM.$('button.knox-gui-thinking-chip')) as HTMLButtonElement;
	chip.type = 'button';
	const label = inProgress
		? t(state, item.redactedThinking ? 'hiddenThinking' : 'thinking')
		: item.redactedThinking
			? t(state, 'hiddenThinking')
			: `${t(state, 'thinkingResult')}${formatReasoningTime(item.thinkingStartAt, item.thinkingEndAt) ? ` ${t(state, 'forDuration', { time: formatReasoningTime(item.thinkingStartAt, item.thinkingEndAt) })}` : ''}`;
	chip.append(label);
	DOM.append(chip, DOM.$(`span.codicon.${open ? 'codicon-chevron-down' : 'codicon-chevron-right'}`));
	widget.renderStore.add(DOM.addDisposableListener(chip, 'click', () => widget.toggleThinking(item, open)));
	if (open) {
		const body = DOM.append(wrap, DOM.$('.knox-gui-thinking-peek-body'));
		if (item.redactedThinking) {
			DOM.append(body, DOM.$('.knox-gui-muted', undefined, t(state, 'thinkingDeletedSecurity')));
		} else {
			widget.appendMarkdown(body, item.content || item.thinking || '');
		}
	}
	void index;
}

export function renderResponseActions(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, index: number, truncated: boolean): void {
	const pending = pendingApplyStates(state.applyStates);
	if (knoxGuiShowsEditResponseAcceptReject(state.mode, state.isStreaming, pending.length > 0)) {
		widget.renderAcceptRejectAll(parent, state, { singleRange: false });
	}
	const row = DOM.append(parent, DOM.$('.knox-gui-msg-actions'));
	if (item.checkpointId) {
		widget.chromeButton(row, {
			icon: 'codicon-history',
			title: t(state, 'restoreCheckpointHint', { id: item.checkpointId.slice(0, 8) }),
			testId: `checkpoint-restore-button-${index}`,
			onClick: (_btn, event) => widget.controller.restoreCheckpoint(item.checkpointId!, Boolean(event?.shiftKey)),
		});
	} else if (!state.isStreaming && !widget.checkpointFetched.has(item.id)) {
		widget.checkpointFetched.add(item.id);
		void widget.controller.ensureCheckpoint(item, index);
	}
	if (truncated) {
		widget.chromeButton(row, {
			icon: 'codicon-fold-down',
			title: t(state, 'knoxGeneration'),
			onClick: () => widget.controller.continueGeneration(),
		});
	}
	widget.chromeButton(row, {
		svg: 'trash',
		svgSize: 14,
		title: t(state, 'delete'),
		testId: `delete-button-${index}`,
		extraClass: 'knox-gui-delete-orange',
		onClick: () => widget.controller.deleteMessage(index),
	});
	widget.chromeButton(row, {
		svg: 'copy',
		svgSize: 14,
		title: t(state, 'copyText'),
		onClick: () => widget.controller.copyText(item.content),
	});
}
