/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../knoxGuiWidget.js';
import { t } from './t.js';
import * as DOM from '../../../../../../base/browser/dom.js';
import { MarkdownRenderOptions } from '../../../../../../base/browser/markdownRenderer.js';
import { MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { scheduleTranscriptStick } from './chrome.js';
import { escape } from '../../../../../../base/common/strings.js';
import { tokenizeToStringSync } from '../../../../../../editor/common/languages/textToHtmlTokenizer.js';
import { knoxGuiMetaKeyLabel, knoxGuiShowsEditResponseAcceptReject } from '../../../common/knoxGuiChrome.js';
import { isMacintosh } from '../../../../../../base/common/platform.js';
import { appendKnoxGuiSvg, replaceKnoxGuiSvg, setKnoxGuiInnerHtml } from '../knoxGuiIcons.js';
import { setCollapseChevronExpanded } from './controls.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { IKnoxGuiHistoryItem, IKnoxGuiState, IKnoxGuiSymbol } from '../../../common/knoxGuiState.js';
import {
	activityAnchorId,
	applyUiAfterAppliedTimeout,
	applyUiForState,
	APPLIED_PILL_MS,
	CODE_LINE_HEIGHT_PX,
	DEFAULT_COLLAPSED_CODE_LINES,
	fenceApplyStreamId,
	fenceHasFileToolbar,
	formatReasoningTime,
	isTerminalCodeBlock,
	languageIdFromFence,
	IKnoxGuiFileRef,
	IKnoxGuiPastFileInfo,
	KNOX_EMPTY_PAST_FILE_INFO,
	knoxGuiMatchCodeToSymbolOrFile,
	knoxGuiPastFileInfo,
	knoxGuiInitialCodeBlockExpanded,
	knoxGuiShouldAutoExpandGeneratingCodeBlock,
	knoxGuiSplitTokenizedLines,
	knoxGuiTerminalCommand,
	knoxGuiSymbolTooltip,
	KnoxGuiCodeLineAnchor,
	MAX_EXPANDED_CODE_LINES,
	parseCodeFenceRange,
	pendingApplyStates,
	IKnoxGuiMarkdownFenceBlock,
	splitMarkdownBlocks,
	visibleCodeLineRange,
} from '../../../common/knoxGuiTranscript.js';

/**
 * `MarkdownBlock.tsx`: `gfm` + `breaks`, link targets as tooltips, and inline
 * code that names a symbol or file from earlier context becomes a link.
 */
export function appendMarkdown(widget: KnoxGuiWidget, parent: HTMLElement, source: string, store = widget.renderStore, fileInfo: IKnoxGuiPastFileInfo = KNOX_EMPTY_PAST_FILE_INFO, streaming = false, target?: HTMLElement): HTMLElement {
	const options: MarkdownRenderOptions = {
		actionHandler: href => { void widget.openerService.open(href); },
		markedOptions: { gfm: true, breaks: true },
		// Remend already closed the live block (`streamSegments`); filling again fights native marked.
		fillInIncompleteTokens: streaming,
		codeBlockRendererSync: (language, value) => highlightMarkdownFence(widget, language, value),
		asyncRenderCallback: () => {
			if (widget.autoScrollEnabled) {
				scheduleTranscriptStick(widget);
			}
		},
	};
	const markdown = new MarkdownString(source, { supportHtml: false, isTrusted: false });
	const md = store.add(widget.markdownRendererService.render(markdown, options, target));
	md.element.classList.add('rendered-markdown', 'styled-markdown-preview');
	if (!target) {
		parent.appendChild(md.element);
	}
	decorateRenderedMarkdown(widget, md.element, store, fileInfo);
	return md.element;
}

function decorateRenderedMarkdown(widget: KnoxGuiWidget, element: HTMLElement, store: DisposableStore, fileInfo: IKnoxGuiPastFileInfo): void {
	for (const anchor of Array.from(element.querySelectorAll('a'))) {
		const href = anchor.getAttribute('data-href') ?? anchor.getAttribute('href');
		if (href) {
			anchor.removeAttribute('title');
			widget.hover(anchor as HTMLElement, href);
		}
	}
	for (const code of Array.from(element.querySelectorAll('code'))) {
		if (code.closest('pre')) {
			continue;
		}
		const text = code.textContent ?? '';
		const match = knoxGuiMatchCodeToSymbolOrFile(text, fileInfo);
		if (match?.kind === 'symbol') {
			renderSymbolLink(widget, code as HTMLElement, match.symbol, store);
		} else if (match?.kind === 'file') {
			renderFilenameLink(widget, code as HTMLElement, match.ref, store);
		}
	}
}

/** Re-run native markdown into the existing `.rendered-markdown` node (StyledMarkdownPreview last-block update). */
export function patchLiveMarkdown(widget: KnoxGuiWidget, node: ChildNode, source: string, store: DisposableStore, fileInfo: IKnoxGuiPastFileInfo, streaming: boolean): boolean {
	if (!(node instanceof HTMLElement) || !node.classList.contains('rendered-markdown')) {
		return false;
	}
	store.clear();
	appendMarkdown(widget, node.parentElement ?? node, source, store, fileInfo, streaming, node);
	return true;
}

/** Native editor tokenizer (`EditorMarkdownCodeBlockRenderer`) for fences left in markdown prose. */
function highlightMarkdownFence(widget: KnoxGuiWidget, languageAlias: string, value: string): HTMLElement {
	const pre = document.createElement('pre');
	pre.className = 'knox-gui-md-fence monaco-tokenized-source';
	pre.setAttribute('data-code-lang', languageAlias || '');
	pre.classList.toggle('wrap', widget.controller.store.state.codeWrap);
	widget.paintHighlightedCode(pre, languageAlias, value);
	return pre;
}

/** `SymbolLink.tsx`: link-colored code; click reveals the symbol range, tooltip shows its source. */
function renderSymbolLink(widget: KnoxGuiWidget, code: HTMLElement, symbol: IKnoxGuiSymbol, store: DisposableStore): void {
	const link = DOM.$('span.knox-gui-symbol-link');
	link.setAttribute('role', 'button');
	link.tabIndex = 0;
	code.replaceWith(link);
	link.appendChild(code);
	const tip = DOM.$('pre.knox-gui-symbol-tip', undefined, knoxGuiSymbolTooltip(symbol));
	store.add(widget.hoverService.setupDelayedHover(link, { content: tip }));
	store.add(DOM.addDisposableListener(link, 'click', e => {
		e.preventDefault();
		e.stopPropagation();
		widget.controller.messenger.post('showLines', { filepath: symbol.filepath, startLine: symbol.range.start.line, endLine: symbol.range.end.line });
	}));
}

/** `FilenameLink.tsx`: file icon and underlined basename; tooltip is the workspace-relative path. */
function renderFilenameLink(widget: KnoxGuiWidget, code: HTMLElement, ref: IKnoxGuiFileRef, store: DisposableStore): void {
	const link = DOM.$('span.knox-gui-filename-link');
	link.setAttribute('role', 'button');
	link.tabIndex = 0;
	widget.appendFileIcon(link, ref.filepath, 20);
	DOM.append(link, DOM.$('span.knox-gui-filename-link-name', undefined, ref.filepath.split('/').pop() ?? ref.filepath));
	code.replaceWith(link);
	widget.hover(link, `/${relativeToWorkspace(ref.filepath, widget.controller.workspaceDirectory)}`);
	store.add(DOM.addDisposableListener(link, 'click', e => {
		e.preventDefault();
		e.stopPropagation();
		widget.controller.showFile(ref.filepath, { startLine: ref.startLine + 1, endLine: ref.endLine + 1 });
	}));
}

function relativeToWorkspace(filepath: string, workspace: string): string {
	const dir = workspace.replace(/\/$/, '');
	return dir && filepath.startsWith(`${dir}/`) ? filepath.slice(dir.length + 1) : filepath.split('/').pop() ?? filepath;
}

export function renderCodeFence(widget: KnoxGuiWidget,
	parent: HTMLElement,
	state: IKnoxGuiState,
	item: IKnoxGuiHistoryItem,
	fence: { language: string; filepath?: string; range?: string; code: string; closed: boolean },
	fenceIndex: number,
	generating: boolean,
): void {
	renderCodeFenceBlock(widget, parent, state, { streamId: fenceApplyStreamId(item.id, fenceIndex), fence, generating, anchor: 'end' });
}

export interface IKnoxGuiFenceBlockOptions {
	streamId: string;
	fence: { language: string; filepath?: string; range?: string; code: string };
	generating: boolean;
	anchor: KnoxGuiCodeLineAnchor;
	/** `StepContainerPreToolbar` `expanded` prop: `false` keeps a file block collapsed until opened. */
	expanded?: boolean;
}

/**
 * A fence with a file path gets `StepContainerPreToolbar` (chevron, file info, Copy and
 * Run or Apply; "Generated N lines" while generating). Other fences get the
 * `StepContainerPreActionButtons` hover toolbar: Run, Apply, Insert, Copy.
 */
export function renderCodeFenceBlock(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, options: IKnoxGuiFenceBlockOptions): void {
	const { streamId, fence, generating } = options;
	if (!fenceHasFileToolbar(fence.filepath)) {
		renderHoverCodeBlock(widget, parent, state, options);
		return;
	}
	const override = widget.fenceExpanded.get(streamId);
	const expanded = override ?? knoxGuiInitialCodeBlockExpanded(fence.code, options.expanded);
	const box = DOM.append(parent, DOM.$('.knox-gui-code-block'));
	box.setAttribute('data-testid', 'step-container-pre-toolbar');
	box.dataset.streamId = streamId;
	box.dataset.language = fence.language;
	if (fence.filepath) {
		box.dataset.filepath = fence.filepath;
	}
	if (fence.range) {
		box.dataset.range = fence.range;
	}
	const toolbar = DOM.append(box, DOM.$('.knox-gui-code-toolbar'));
	toolbar.classList.toggle('expanded', expanded);
	toolbar.style.fontSize = `${state.fontSize - 2}px`;
	const left = DOM.append(toolbar, DOM.$('.knox-gui-code-toolbar-file'));
	widget.collapseChevron(left, {
		expanded,
		title: expanded ? t(state, 'collapse') : t(state, 'expand'),
		onClick: () => {
			const open = widget.fenceExpanded.get(streamId) ?? knoxGuiInitialCodeBlockExpanded(readFenceFromBox(box).code, options.expanded);
			widget.fenceExpanded.set(streamId, !open);
			applyFenceExpanded(widget, box, state, !open, options);
		},
	});
	widget.renderClickablePath(left, fence.filepath!, { range: fence.range, showIcon: true });
	const actions = DOM.append(toolbar, DOM.$('.knox-gui-code-actions'));
	if (generating) {
		const lines = fence.code.split('\n').length;
		const count = lines === 1 ? 1 : lines - 1;
		DOM.append(actions, DOM.$('span.knox-gui-generating-lines', undefined, t(state, count === 1 ? 'generatedLines' : 'generatedLines_plural', { count })));
	} else {
		renderCopyFeedbackButton(widget, actions, state, `code:${streamId}`, fence.code, true);
		if (isTerminalCodeBlock(fence.language, fence.code)) {
			widget.chromeButton(actions, {
				svg: 'terminal',
				svgSize: 14,
				label: t(state, 'run'),
				extraClass: 'knox-gui-run-terminal knox-gui-2xs-hide',
				onClick: () => widget.controller.messenger.post('runCommand', { command: fence.code }),
			});
		} else {
			widget.renderApplyActions(actions, state, streamId, fence);
		}
	}
	if (expanded) {
		widget.renderCodeLines(box, state, fence.language, fence.code, fence.filepath, { key: streamId, range: fence.range, generating, anchor: options.anchor });
	}
}

function readFenceFromBox(box: HTMLElement): { language: string; filepath?: string; range?: string; code: string } {
	const scroll = box.querySelector('.knox-gui-code-scroll') as HTMLElement | null;
	return {
		language: box.dataset.language ?? '',
		filepath: box.dataset.filepath,
		range: box.dataset.range,
		code: scroll?.dataset.code ?? '',
	};
}

function applyFenceExpanded(widget: KnoxGuiWidget, box: HTMLElement, state: IKnoxGuiState, expanded: boolean, options: IKnoxGuiFenceBlockOptions): void {
	const toolbar = box.querySelector('.knox-gui-code-toolbar') as HTMLElement | null;
	toolbar?.classList.toggle('expanded', expanded);
	const chevron = box.querySelector('.knox-gui-collapse-chevron') as HTMLElement | null;
	if (chevron) {
		setCollapseChevronExpanded(chevron, expanded, expanded ? t(state, 'collapse') : t(state, 'expand'));
	}
	const scroll = box.querySelector('.knox-gui-code-scroll') as HTMLElement | null;
	if (scroll) {
		scroll.hidden = !expanded;
		return;
	}
	if (!expanded) {
		return;
	}
	const fence = readFenceFromBox(box);
	widget.renderCodeLines(box, state, fence.language, fence.code || options.fence.code, fence.filepath, {
		key: options.streamId,
		range: fence.range ?? options.fence.range,
		generating: options.generating,
		anchor: options.anchor,
	});
}

function renderHoverCodeBlock(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, options: IKnoxGuiFenceBlockOptions): void {
	const { streamId, fence, generating } = options;
	const box = DOM.append(parent, DOM.$('.knox-gui-code-block.knox-gui-code-generic'));
	box.setAttribute('data-testid', 'step-container-pre-action-buttons');
	box.dataset.streamId = streamId;
	box.dataset.language = fence.language;
	if (fence.filepath) {
		box.dataset.filepath = fence.filepath;
	}
	if (fence.range) {
		box.dataset.range = fence.range;
	}
	const bottom = state.codeBlockToolbarPosition === 'bottom';
	widget.renderCodeLines(box, state, fence.language, fence.code, fence.filepath, { key: streamId, range: fence.range, generating, anchor: options.anchor });
	if (generating) {
		return;
	}
	const actions = DOM.append(box, DOM.$(bottom ? '.knox-gui-code-actions.knox-gui-code-hover.bottom' : '.knox-gui-code-actions.knox-gui-code-hover'));
	if (isTerminalCodeBlock(fence.language, fence.code)) {
		widget.chromeButton(actions, { svg: 'terminal', svgSize: 16, title: t(state, 'runInTerminal'), onClick: () => widget.controller.messenger.post('runCommand', { command: knoxGuiTerminalCommand(fence.code) }) });
	}
	widget.chromeButton(actions, {
		svg: 'list-plus',
		svgSize: 16,
		title: t(state, 'apply'),
		onClick: () => widget.controller.messenger.post('applyToFile', { streamId, text: fence.code, curSelectedModelTitle: state.modelTitle }),
	});
	widget.chromeButton(actions, { svg: 'file-input', svgSize: 16, title: t(state, 'insert'), onClick: () => widget.controller.messenger.post('insertAtCursor', { text: fence.code }) });
	renderCopyFeedbackButton(widget, actions, state, `code:${streamId}`, fence.code, false);
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

export interface IKnoxGuiCodeLinesOptions {
	/** Keys the scroll-follow and window state across re-renders. */
	key: string;
	range?: string;
	generating: boolean;
	anchor?: KnoxGuiCodeLineAnchor;
}

/**
 * `SyntaxHighlightedPre.tsx`: numbered lines (base from the fence range), 12 visible lines
 * before scrolling, at most 400 lines in the DOM, a streaming cursor, and tail follow while
 * generating until the user scrolls up. End-anchored blocks pin to the end once and page
 * the 400-line window when scrolled to an edge.
 */
function paintCodeLineWindow(widget: KnoxGuiWidget, container: HTMLElement, state: IKnoxGuiState, language: string, code: string, filepath: string | undefined, options: IKnoxGuiCodeLinesOptions): { start: number; end: number; lineCount: number; anchor: KnoxGuiCodeLineAnchor; windowShift: number } {
	const { key, generating } = options;
	container.setAttribute('data-streaming', String(generating));
	container.classList.toggle('wrap', state.codeWrap);
	container.classList.toggle('generating', generating);
	if (generating && !widget.codeGenerating.has(key)) {
		widget.codeGenerating.add(key);
		widget.codeUserScrolled.delete(key);
		widget.codeWindowShift.delete(key);
		widget.codePinned.delete(key);
	} else if (!generating) {
		widget.codeGenerating.delete(key);
	}
	let lines: string[];
	try {
		const requested = languageIdFromFence(language, filepath);
		const languageId = widget.languageService.getLanguageIdByLanguageName(requested)
			?? (widget.languageService.isRegisteredLanguageId(requested) ? requested : 'plaintext');
		widget.languageService.requestBasicLanguageFeatures(languageId);
		lines = knoxGuiSplitTokenizedLines(tokenizeToStringSync(widget.languageService, code, languageId));
	} catch {
		lines = code.split('\n').map(line => escape(line));
	}
	const lineCount = lines.length;
	const anchor: KnoxGuiCodeLineAnchor = generating || options.anchor === 'end' ? 'end' : 'start';
	const windowShift = widget.codeWindowShift.get(key) ?? 0;
	const { start, end } = visibleCodeLineRange(lineCount, { isGenerating: generating, isExpanded: !generating, anchor, windowShift });
	const base = parseCodeFenceRange(options.range)?.startLine ?? 1;
	if (generating || end - start > DEFAULT_COLLAPSED_CODE_LINES) {
		container.style.maxHeight = `${DEFAULT_COLLAPSED_CODE_LINES * CODE_LINE_HEIGHT_PX}px`;
	} else {
		container.style.maxHeight = '';
	}
	let linesRoot = container.querySelector('.knox-gui-code-lines') as HTMLElement | null;
	if (!linesRoot) {
		linesRoot = DOM.append(container, DOM.$('.knox-gui-code-lines'));
	}
	const prevStart = Number(container.dataset.lineStart ?? Number.NaN);
	const prevEnd = Number(container.dataset.lineEnd ?? Number.NaN);
	const existing = Array.from(linesRoot.children) as HTMLElement[];
	const canPatch = existing.length === Math.max(0, prevEnd - prevStart)
		&& prevStart === start
		&& prevEnd <= end
		&& prevEnd > prevStart;
	if (canPatch) {
		if (prevEnd > start) {
			paintCodeLine(existing[prevEnd - start - 1], base, prevEnd - 1, lines[prevEnd - 1], generating && prevEnd === lineCount);
		}
		for (let i = prevEnd; i < end; i++) {
			const row = document.createElement('div');
			paintCodeLine(row, base, i, lines[i], generating && i === lineCount - 1);
			linesRoot.appendChild(row);
		}
	} else {
		let html = '';
		for (let i = start; i < end; i++) {
			html += codeLineMarkup(base, i, lines[i], generating && i === lineCount - 1);
		}
		setKnoxGuiInnerHtml(linesRoot, html);
	}
	container.dataset.lineStart = String(start);
	container.dataset.lineEnd = String(end);
	container.dataset.lineCount = String(lineCount);
	container.dataset.code = code;
	if (generating && !widget.codeUserScrolled.has(key)) {
		container.scrollTop = container.scrollHeight;
		widget.codeScrollTop.set(key, container.scrollTop);
	}
	return { start, end, lineCount, anchor, windowShift };
}

function codeLineMarkup(base: number, index: number, html: string, cursor: boolean): string {
	const cursorHtml = cursor ? '<span class="knox-gui-streaming-cursor"></span>' : '';
	return `<div class="knox-gui-code-line" data-line="${base + index}"><span class="knox-gui-line-number">${base + index}</span><span class="knox-gui-line-content">${html || '&nbsp;'}${cursorHtml}</span></div>`;
}

function paintCodeLine(row: HTMLElement, base: number, index: number, html: string, cursor: boolean): void {
	row.className = 'knox-gui-code-line';
	row.dataset.line = String(base + index);
	setKnoxGuiInnerHtml(row, `<span class="knox-gui-line-number">${base + index}</span><span class="knox-gui-line-content">${html || '&nbsp;'}${cursor ? '<span class="knox-gui-streaming-cursor"></span>' : ''}</span>`);
}

export function renderCodeLines(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, language: string, code: string, filepath: string | undefined, options: IKnoxGuiCodeLinesOptions): HTMLElement {
	const { key, generating } = options;
	const container = DOM.append(parent, DOM.$('div.knox-gui-code-pre.knox-gui-code-scroll'));
	container.setAttribute('data-testid', 'syntax-highlighted-pre');
	const { start, end, lineCount, anchor, windowShift } = paintCodeLineWindow(widget, container, state, language, code, filepath, options);
	let ignoreScroll = false;
	let lastScrollTop = container.scrollTop;
	const setTop = (top: number) => {
		ignoreScroll = true;
		container.scrollTop = top;
		lastScrollTop = container.scrollTop;
		widget.codeScrollTop.set(key, container.scrollTop);
		queueMicrotask(() => { ignoreScroll = false; });
	};
	const adjust = widget.codeScrollAdjust.get(key);
	if (adjust !== undefined) {
		widget.codeScrollAdjust.delete(key);
		setTop((widget.codeScrollTop.get(key) ?? 0) + adjust);
	} else if (generating && !widget.codeUserScrolled.has(key)) {
		setTop(container.scrollHeight);
	} else if (!generating && anchor === 'end' && !widget.codePinned.has(key) && !widget.codeUserScrolled.has(key)) {
		widget.codePinned.add(key);
		setTop(container.scrollHeight);
	} else if (widget.codeScrollTop.has(key) && container.scrollTop === 0) {
		setTop(widget.codeScrollTop.get(key)!);
	}
	widget.listenerStore.add(DOM.addDisposableListener(container, 'scroll', () => {
		if (ignoreScroll) {
			return;
		}
		const { scrollTop, scrollHeight, clientHeight } = container;
		const atBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 30;
		widget.codeScrollTop.set(key, scrollTop);
		if (generating) {
			if (scrollTop < lastScrollTop && !atBottom) {
				widget.codeUserScrolled.add(key);
			} else if (atBottom) {
				widget.codeUserScrolled.delete(key);
			}
			lastScrollTop = scrollTop;
			return;
		}
		widget.codeUserScrolled.add(key);
		lastScrollTop = scrollTop;
		if (anchor !== 'end') {
			return;
		}
		const liveCount = Number(container.dataset.lineCount ?? lineCount);
		const liveShift = widget.codeWindowShift.get(key) ?? windowShift;
		const liveStart = Number(container.dataset.lineStart ?? start);
		const liveEnd = Number(container.dataset.lineEnd ?? end);
		const windowSize = Math.min(liveCount, MAX_EXPANDED_CODE_LINES);
		const maxShift = Math.max(0, liveCount - windowSize);
		const step = DEFAULT_COLLAPSED_CODE_LINES * 4;
		const next = liveStart > 0 && scrollTop < 8
			? Math.min(maxShift, liveShift + step)
			: liveEnd < liveCount && atBottom ? Math.max(0, liveShift - step) : liveShift;
		if (next !== liveShift) {
			widget.codeWindowShift.set(key, next);
			widget.codeScrollAdjust.set(key, (next - liveShift) * CODE_LINE_HEIGHT_PX);
			paintCodeLineWindow(widget, container, state, language, container.dataset.code ?? code, filepath, { ...options, generating: false });
		}
	}));
	return container;
}

export function renderApplyActions(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, streamId: string, fence: { code: string; filepath?: string }): void {
	const apply = state.applyStates.find(item => item.streamId === streamId);
	let ui = applyUiForState(apply, widget.rejectedApplies.has(streamId));
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
		const count = DOM.append(pill, DOM.$('span.knox-gui-apply-count', undefined, t(state, 'diffsRemaining', { count: ui.numDiffs })));
		count.appendChild(DOM.$('span.knox-gui-md-hide', undefined, ` ${t(state, 'remaining')}`));
		widget.chromeButton(pill, {
			svg: 'x',
			svgSize: 16,
			title: `${t(state, 'rejectAll')} (${knoxGuiMetaKeyLabel(isMacintosh)}⇧⌫)`,
			testId: 'edit-reject-button',
			onClick: () => {
				widget.rejectedApplies.add(streamId);
				widget.controller.messenger.post('rejectDiff', { streamId, filepath: apply?.filepath ?? fence.filepath });
			},
		});
		widget.chromeButton(pill, {
			svg: 'check',
			svgSize: 16,
			title: `${t(state, 'acceptAll')} (${knoxGuiMetaKeyLabel(isMacintosh)}⇧⏎)`,
			testId: 'edit-accept-button',
			onClick: () => widget.controller.messenger.post('acceptDiff', { streamId, filepath: apply?.filepath ?? fence.filepath }),
		});
		return;
	}
	if (ui.kind === 'applied') {
		const pill = DOM.append(parent, DOM.$('span.knox-gui-apply-pill'));
		DOM.append(pill, DOM.$('span.knox-gui-apply-applied', undefined, t(state, 'applied')));
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
	wrap.dataset.collapsed = String(collapsed);
	wrap.dataset.thinking = thinking;
	wrap.dataset.redacted = String(Boolean(item.redactedThinking));
	const header = DOM.append(wrap, DOM.$('.knox-gui-reasoning-header'));
	header.setAttribute('role', 'button');
	header.tabIndex = 0;
	header.style.fontSize = `${state.fontSize - 2}px`;
	widget.collapseChevron(header, {
		expanded: !collapsed,
		title: collapsed ? t(state, 'expand') : t(state, 'collapse'),
		onClick: () => widget.toggleThinking(item, !collapsed),
	});
	const label = item.thinkingActive
		? t(state, 'thinking')
		: `${t(state, 'thinking')}${formatReasoningTime(item.thinkingStartAt, item.thinkingEndAt) ? ` (${formatReasoningTime(item.thinkingStartAt, item.thinkingEndAt)})` : ''}`;
	const title = DOM.append(header, DOM.$('span.knox-gui-reasoning-title', undefined, label));
	if (item.thinkingActive) {
		header.classList.add('thinking');
		title.classList.add('knox-gui-thinking-ellipsis');
	}
	widget.listenerStore.add(DOM.addDisposableListener(header, 'click', () => widget.toggleThinking(item, !collapsed)));
	widget.listenerStore.add(DOM.addDisposableListener(header, 'keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			widget.toggleThinking(item, !collapsed);
		}
	}));
	if (!collapsed) {
		const body = DOM.append(wrap, DOM.$('.knox-gui-reasoning-body'));
		if (thinking.split('\n').length <= 12) {
			body.classList.add('no-scroll');
		}
		if (item.thinkingActive) {
			body.classList.add('knox-gui-reasoning-live');
		}
		const content = DOM.append(body, DOM.$('.knox-gui-reasoning-content.styled-markdown-preview'));
		fillReasoningContent(widget, content, state, item, thinking, widget.listenerStore);
		if (item.thinkingActive) {
			body.scrollTop = body.scrollHeight;
		}
	}
	void index;
}

/**
 * `Reasoning.tsx` is memoized: the card stays mounted and only the markdown source
 * updates. Replacing the wrapper resets scrollTop to 0 then jumps to the bottom.
 */
export function patchLiveReasoning(widget: KnoxGuiWidget, card: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, index: number): void {
	const thinking = item.thinking?.trim();
	const old = card.querySelector('.knox-gui-reasoning') as HTMLElement | null;
	if (!thinking) {
		old?.remove();
		widget.reasoningPatchStore.clear();
		widget.reasoningContentStore.clear();
		return;
	}
	const collapsed = item.thinkingCollapsed === true;
	if (!old || old.dataset.collapsed !== String(collapsed)) {
		widget.reasoningPatchStore.clear();
		widget.reasoningContentStore.clear();
		const previous = widget.listenerStore;
		widget.listenerStore = widget.reasoningPatchStore;
		try {
			const host = DOM.$('div');
			renderReasoning(widget, host, state, item, index);
			const next = host.firstElementChild;
			if (old && next) {
				old.replaceWith(next);
			} else if (next) {
				card.insertBefore(next, card.firstChild);
			}
		} finally {
			widget.listenerStore = previous;
		}
		return;
	}
	const header = old.querySelector('.knox-gui-reasoning-header') as HTMLElement | null;
	const title = old.querySelector('.knox-gui-reasoning-title') as HTMLElement | null;
	if (header && title) {
		header.classList.toggle('thinking', Boolean(item.thinkingActive));
		title.classList.toggle('knox-gui-thinking-ellipsis', Boolean(item.thinkingActive));
		const label = item.thinkingActive
			? t(state, 'thinking')
			: `${t(state, 'thinking')}${formatReasoningTime(item.thinkingStartAt, item.thinkingEndAt) ? ` (${formatReasoningTime(item.thinkingStartAt, item.thinkingEndAt)})` : ''}`;
		if (title.textContent !== label) {
			title.textContent = label;
		}
	}
	if (collapsed) {
		return;
	}
	const body = old.querySelector('.knox-gui-reasoning-body') as HTMLElement | null;
	if (!body) {
		return;
	}
	body.classList.toggle('no-scroll', thinking.split('\n').length <= 12);
	body.classList.toggle('knox-gui-reasoning-live', Boolean(item.thinkingActive));
	const same = old.dataset.thinking === thinking && old.dataset.redacted === String(Boolean(item.redactedThinking));
	if (!same) {
		old.dataset.thinking = thinking;
		old.dataset.redacted = String(Boolean(item.redactedThinking));
		const content = old.querySelector('.knox-gui-reasoning-content') as HTMLElement | null;
		if (content) {
			widget.reasoningContentStore.clear();
			fillReasoningContent(widget, content, state, item, thinking, widget.reasoningContentStore);
		}
	}
	if (item.thinkingActive) {
		body.scrollTop = body.scrollHeight;
	}
}

function fillReasoningContent(widget: KnoxGuiWidget, content: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, thinking: string, store: DisposableStore): void {
	const previous = widget.listenerStore;
	widget.listenerStore = store;
	try {
		if (item.redactedThinking) {
			content.replaceChildren();
			DOM.append(content, DOM.$('.knox-gui-thinking-redacted', undefined, t(state, 'thinkingDeletedSecurity')));
		} else if (state.markdownFormatting !== false) {
			const existing = content.querySelector('.rendered-markdown') as HTMLElement | null;
			if (existing && !content.querySelector('.knox-gui-code-block')) {
				appendMarkdown(widget, content, thinking, store, knoxGuiPastFileInfo(state.history, 0, state.fileSymbols), false, existing);
			} else {
				content.replaceChildren();
				appendStepMarkdown(widget, content, state, thinking, `${item.id}:reasoning`, Boolean(item.thinkingActive));
			}
		} else {
			content.replaceChildren();
			DOM.append(content, DOM.$('pre', undefined, thinking));
		}
	} finally {
		widget.listenerStore = previous;
	}
}

export function patchLiveCodeFence(
	widget: KnoxGuiWidget,
	nodes: ChildNode[],
	state: IKnoxGuiState,
	item: IKnoxGuiHistoryItem,
	fence: IKnoxGuiMarkdownFenceBlock,
	fenceIndex: number,
	generating: boolean,
	streamId = fenceApplyStreamId(item.id, fenceIndex),
): boolean {
	const box = nodes.find((node): node is HTMLElement => node instanceof HTMLElement && node.classList.contains('knox-gui-code-block'));
	if (!box) {
		return false;
	}
	box.dataset.language = fence.language;
	if (fence.filepath) {
		box.dataset.filepath = fence.filepath;
	} else {
		delete box.dataset.filepath;
	}
	if (fence.range) {
		box.dataset.range = fence.range;
	} else {
		delete box.dataset.range;
	}
	let scroll = box.querySelector('.knox-gui-code-scroll') as HTMLElement | null;
	const wasGenerating = scroll?.getAttribute('data-streaming') === 'true';
	if (!scroll) {
		const override = widget.fenceExpanded.get(streamId);
		if (knoxGuiShouldAutoExpandGeneratingCodeBlock(generating, fence.code, override)) {
			widget.fenceExpanded.set(streamId, true);
			applyFenceExpanded(widget, box, state, true, { streamId, fence, generating, anchor: 'end' });
			scroll = box.querySelector('.knox-gui-code-scroll') as HTMLElement | null;
		}
	}
	if (!scroll) {
		return false;
	}
	if (generating) {
		const lines = fence.code.split('\n').length;
		const count = lines === 1 ? 1 : lines - 1;
		const label = t(state, count === 1 ? 'generatedLines' : 'generatedLines_plural', { count });
		const existing = box.querySelector('.knox-gui-generating-lines');
		if (existing) {
			existing.textContent = label;
		} else {
			const toolbar = (box.querySelector('.knox-gui-code-toolbar') as HTMLElement | null) ?? box;
			const actions = (box.querySelector('.knox-gui-code-actions') as HTMLElement | null) ?? DOM.append(toolbar, DOM.$('.knox-gui-code-actions'));
			DOM.append(actions, DOM.$('span.knox-gui-generating-lines', undefined, label));
		}
	} else if (wasGenerating) {
		box.querySelector('.knox-gui-generating-lines')?.remove();
		ensureIdleFenceActions(widget, box, state, streamId, fence);
	}
	paintCodeLineWindow(widget, scroll, state, fence.language, fence.code, fence.filepath, { key: streamId, range: fence.range, generating, anchor: 'end' });
	return true;
}

function ensureIdleFenceActions(widget: KnoxGuiWidget, box: HTMLElement, state: IKnoxGuiState, streamId: string, fence: IKnoxGuiMarkdownFenceBlock): void {
	if (box.querySelector('.knox-gui-copy-code, .knox-gui-apply, [data-copied]')) {
		return;
	}
	const fileToolbar = box.getAttribute('data-testid') === 'step-container-pre-toolbar';
	let actions = box.querySelector('.knox-gui-code-actions') as HTMLElement | null;
	if (!actions) {
		const bottom = state.codeBlockToolbarPosition === 'bottom';
		actions = DOM.append(box, DOM.$(fileToolbar ? '.knox-gui-code-actions' : (bottom ? '.knox-gui-code-actions.knox-gui-code-hover.bottom' : '.knox-gui-code-actions.knox-gui-code-hover')));
	}
	if (fileToolbar) {
		renderCopyFeedbackButton(widget, actions, state, `code:${streamId}`, fence.code, true);
		if (isTerminalCodeBlock(fence.language, fence.code)) {
			widget.chromeButton(actions, {
				svg: 'terminal',
				svgSize: 14,
				label: t(state, 'run'),
				extraClass: 'knox-gui-run-terminal knox-gui-2xs-hide',
				onClick: () => widget.controller.messenger.post('runCommand', { command: fence.code }),
			});
		} else {
			widget.renderApplyActions(actions, state, streamId, fence);
		}
		return;
	}
	if (isTerminalCodeBlock(fence.language, fence.code)) {
		widget.chromeButton(actions, { svg: 'terminal', svgSize: 16, title: t(state, 'runInTerminal'), onClick: () => widget.controller.messenger.post('runCommand', { command: knoxGuiTerminalCommand(fence.code) }) });
	}
	widget.chromeButton(actions, {
		svg: 'list-plus',
		svgSize: 16,
		title: t(state, 'apply'),
		onClick: () => widget.controller.messenger.post('applyToFile', { streamId, text: fence.code, curSelectedModelTitle: state.modelTitle }),
	});
	widget.chromeButton(actions, { svg: 'file-input', svgSize: 16, title: t(state, 'insert'), onClick: () => widget.controller.messenger.post('insertAtCursor', { text: fence.code }) });
	renderCopyFeedbackButton(widget, actions, state, `code:${streamId}`, fence.code, false);
}

/**
 * `StyledMarkdownPreview` with `isRenderingInStepContainer`: fences inside reasoning
 * get the same code toolbar as the reply; an open fence generates while live.
 */
function appendStepMarkdown(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, source: string, streamPrefix: string, live: boolean, fileInfo?: IKnoxGuiPastFileInfo): void {
	let fenceIndex = 0;
	for (const block of splitMarkdownBlocks(source)) {
		if (block.type === 'markdown') {
			if (block.text.trim()) {
				appendMarkdown(widget, parent, block.text, widget.listenerStore, fileInfo, live);
			}
			continue;
		}
		renderCodeFenceBlock(widget, parent, state, { streamId: fenceApplyStreamId(streamPrefix, fenceIndex), fence: block, generating: live && !block.closed, anchor: 'end' });
		fenceIndex += 1;
	}
}

export function toggleThinking(widget: KnoxGuiWidget, item: IKnoxGuiHistoryItem, collapsed: boolean): void {
	const history = widget.controller.store.state.history.map(row => row.id === item.id ? { ...row, thinkingCollapsed: collapsed } : row);
	widget.controller.store.patch({ history });
}

export function renderThinkingPeekBlock(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, item: IKnoxGuiHistoryItem, index: number, inProgress: boolean): void {
	const prev = index > 0 ? state.history[index - 1] : undefined;
	if (item.redactedThinking && prev?.role === 'thinking' && prev.redactedThinking) {
		return;
	}
	const wrap = DOM.append(parent, DOM.$('.knox-gui-thinking-peek'));
	wrap.setAttribute('data-testid', 'thinking-block-peek');
	wrap.id = activityAnchorId(`thinking:${item.id}`);
	const open = item.thinkingCollapsed === false;
	const chip = DOM.append(wrap, DOM.$('.knox-gui-thinking-chip'));
	chip.setAttribute('role', 'button');
	chip.tabIndex = 0;
	chip.style.fontSize = `${state.fontSize - 2}px`;
	const label = inProgress
		? t(state, item.redactedThinking ? 'hiddenThinking' : 'thinking')
		: item.redactedThinking
			? t(state, 'hiddenThinking')
			: `${t(state, 'thinkingResult')}${formatReasoningTime(item.thinkingStartAt, item.thinkingEndAt) ? ` ${t(state, 'forDuration', { time: formatReasoningTime(item.thinkingStartAt, item.thinkingEndAt) })}` : ''}`;
	if (inProgress) {
		DOM.append(chip, DOM.$('span.knox-gui-thinking-anim', undefined, label));
	} else {
		chip.append(label);
	}
	widget.collapseChevron(chip, {
		expanded: open,
		title: open ? t(state, 'collapse') : t(state, 'expand'),
		onClick: () => widget.toggleThinking(item, open),
	});
	widget.listenerStore.add(DOM.addDisposableListener(chip, 'click', () => widget.toggleThinking(item, open)));
	widget.listenerStore.add(DOM.addDisposableListener(chip, 'keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			widget.toggleThinking(item, open);
		}
	}));
	if (open) {
		const body = DOM.append(wrap, DOM.$('.knox-gui-thinking-peek-body.styled-markdown-preview'));
		if (item.redactedThinking) {
			DOM.append(body, DOM.$('.knox-gui-thinking-redacted', undefined, t(state, 'thinkingDeletedSecurity')));
		} else {
			appendStepMarkdown(widget, body, state, item.content || item.thinking || '', `${item.id}:thinking`, inProgress, knoxGuiPastFileInfo(state.history, index, state.fileSymbols));
		}
	}
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
			onClick: (_btn, event) => void widget.controller.openRestorePreview(item.checkpointId!, Boolean(event?.shiftKey)),
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
	renderCopyFeedbackButton(widget, row, state, `reply:${item.id}`, item.content, false);
}

/** `useCopy.tsx`: green check (and "Copied" on code blocks) for 2 s after copying. */
export function renderCopyFeedbackButton(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, key: string, text: string, withLabel: boolean): void {
	const copied = (widget.termCopiedUntil.get(key) ?? 0) > Date.now();
	const button = widget.chromeButton(parent, {
		svg: copied ? 'check' : 'copy',
		svgSize: 14,
		label: withLabel ? t(state, copied ? 'copied' : 'copyText') : undefined,
		title: t(state, copied ? 'copied' : 'copy'),
		extraClass: `${withLabel ? 'knox-gui-copy-code knox-gui-2xs-hide' : ''}${copied ? ' knox-gui-copied' : ''}`.trim() || undefined,
		onClick: () => {
			widget.controller.copyText(text);
			widget.termCopiedUntil.set(key, Date.now() + 2000);
			applyCopyFeedback(button, state, true);
			window.setTimeout(() => {
				if ((widget.termCopiedUntil.get(key) ?? 0) <= Date.now()) {
					widget.termCopiedUntil.delete(key);
					applyCopyFeedback(button, state, false);
				}
			}, 2000);
		},
	});
	button.setAttribute('data-copied', String(copied));
}

function applyCopyFeedback(button: HTMLElement, state: IKnoxGuiState, copied: boolean): void {
	button.setAttribute('data-copied', String(copied));
	button.classList.toggle('knox-gui-copied', copied);
	replaceKnoxGuiSvg(button, copied ? 'check' : 'copy', 14);
	const label = button.querySelector('.knox-gui-lump-label');
	if (label) {
		label.textContent = t(state, copied ? 'copied' : 'copyText');
	}
}
