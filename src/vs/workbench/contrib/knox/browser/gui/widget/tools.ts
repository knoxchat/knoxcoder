/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../knoxGuiWidget.js';
import { t } from './t.js';
import * as DOM from '../../../../../../base/browser/dom.js';
import { safeSetInnerHtml } from '../../../../../../base/browser/domSanitize.js';
import { URI } from '../../../../../../base/common/uri.js';
import { getIconClasses } from '../../../../../../editor/common/services/getIconClasses.js';
import { FileKind } from '../../../../../../platform/files/common/files.js';
import { appendKnoxGuiSvg, setKnoxGuiInnerHtml } from '../knoxGuiIcons.js';
import { toolDisplayKind } from '../../../common/knoxGuiChat.js';
import {
	catalogToolForCall,
	collapseFileToolCodePreview,
	colorizeSummary,
	colorizeTreeStructure,
	DARK_TERMINAL_PALETTE,
	displayArgsForToolCall,
	displayLanguageForFile,
	extractLogPathFromTerminalOutput,
	extractStreamingToolCode,
	extractTerminalOutput,
	finishedToolSummary,
	finishedToolSummaryText,
	formatToolName,
	getCategorizedToolName,
	highlightSearchQueryInHtml,
	formatAskUserDisplayAnswer,
	isAskUserAnswered,
	parseAskUserQuestionsForGui,
	LIGHT_TERMINAL_PALETTE,
	luminanceIsLight,
	parseAnsiSpans,
	parseSearchResults,
	renderToolTemplateHtml,
	repoMapOutput,
	repoMapToTreeColorized,
	searchOutput,
	shouldRenderToolBody,
	splitChoiceText,
	subdirectoryFilterBadges,
	subdirectoryOutputParts,
	takeTerminalTail,
	terminalBodyHeight,
	terminalCommandForTool,
	toolAlwaysShowsBody,
	toolOutputText,
	toolPermissionDisplay,
	toolStatusFallbackKey,
	toolStatusIcon,
	toolStatusIntroKey,
	treePreviewLines,
	treeStatsFromPlain,
	treeThemeColors,
} from '../../../common/knoxGuiTools.js';
import { IKnoxGuiState, IKnoxGuiToolCall } from '../../../common/knoxGuiState.js';
import { knoxGuiHljsTokenColor, knoxGuiStateThemeIsLight } from '../../../common/knoxGuiTheme.js';
import { activityAnchorId, parseCodeFenceRange, splitDisplayPath } from '../../../common/knoxGuiTranscript.js';

export function toolStreamFingerprint(tool: IKnoxGuiToolCall): string {
	return `${tool.status}\0${tool.arguments}\0${tool.output ?? ''}\0${tool.outputItems?.length ?? 0}\0${tool.collapsed ? 1 : 0}`;
}

export function renderTool(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
	const box = DOM.append(parent, DOM.$('.knox-gui-tool'));
	box.setAttribute('data-testid', 'knox-gui-tool');
	box.setAttribute('data-tool-name', tool.name);
	box.setAttribute('data-tool-status', tool.status);
	box.dataset.stream = toolStreamFingerprint(tool);
	box.id = activityAnchorId(`tool:${tool.id}`);
	const kind = toolDisplayKind(tool.name);
	const catalog = catalogToolForCall(state.tools, tool.name);
	const alwaysShow = toolAlwaysShowsBody(tool.name);
	const collapsed = widget.toolBodyCollapsed.has(tool.id) || Boolean(tool.collapsed);
	const showBody = shouldRenderToolBody(tool.status, collapsed, { alwaysShow });
	const displayArgs = displayArgsForToolCall(tool.parsedArgs, tool.arguments);
	const argEntries = Object.entries(displayArgs);
	const hideParams = kind === 'ask-user' || (kind === 'create-file' && tool.status === 'done');
	const showParams = argEntries.length > 0 && !hideParams;
	const argsOpen = widget.toolArgsOpen.has(tool.id);
	const isLive = tool.status === 'generating' || tool.status === 'generated' || tool.status === 'calling';

	const head = DOM.append(box, DOM.$('.knox-gui-tool-head'));
	const left = DOM.append(head, DOM.$('.knox-gui-tool-head-left'));
	if (!alwaysShow) {
		widget.collapseChevron(left, {
			expanded: showBody,
			title: showBody ? t(state, 'collapse') : t(state, 'expand'),
			onClick: () => {
				if (isLive) {
					return;
				}
				if (widget.toolBodyCollapsed.has(tool.id)) {
					widget.toolBodyCollapsed.delete(tool.id);
				} else {
					widget.toolBodyCollapsed.add(tool.id);
				}
				widget.render();
			},
		});
	}
	const icon = DOM.append(left, DOM.$('span.knox-gui-tool-status'));
	icon.setAttribute('aria-hidden', 'true');
	const statusIcon = toolStatusIcon(tool.status);
	if (statusIcon === 'spinner') {
		icon.classList.add('knox-gui-tool-status-live');
		widget.appendSpinner(icon, 16);
	} else {
		icon.classList.add('knox-gui-tool-status-glyph');
		appendKnoxGuiSvg(icon, statusIcon, 14);
	}
	if (catalog?.faviconUrl) {
		const fav = DOM.append(left, DOM.$('img.knox-gui-tool-favicon')) as HTMLImageElement;
		fav.src = catalog.faviconUrl;
		fav.alt = t(state, 'toolIcon');
	}
	const status = DOM.append(left, DOM.$('div.knox-gui-tool-status-text'));
	if (!catalog && !tool.name) {
		status.append(t(state, 'agentToolUsage'));
	} else {
		const introKey = toolStatusIntroKey(tool.status);
		const fallbackKey = toolStatusFallbackKey(tool.status);
		const formatted = formatToolName(tool.name, catalog?.displayTitle);
		let message = '';
		if (tool.status === 'calling' && catalog?.isCurrently) {
			message = renderToolTemplateHtml(catalog.isCurrently, displayArgs);
		} else if (tool.status === 'done' && catalog?.hasAlready) {
			message = renderToolTemplateHtml(catalog.hasAlready, displayArgs);
		} else if (catalog?.wouldLikeTo && tool.status !== 'done') {
			message = renderToolTemplateHtml(catalog.wouldLikeTo, displayArgs);
		}
		const copy = DOM.append(status, DOM.$('div.knox-gui-tool-status-copy'));
		copy.append(`${t(state, 'knox')} `);
		if (introKey) {
			copy.append(`${t(state, introKey)} `);
		}
		if (message) {
			safeSetInnerHtml(DOM.append(copy, DOM.$('span.knox-gui-tool-template')), message);
		} else {
			copy.append(`${t(state, fallbackKey)} `);
			const code = DOM.append(copy, DOM.$('code', undefined, formatted));
			code.classList.add('knox-gui-tool-name');
			copy.append(` ${t(state, 'tool')}`);
		}
	}
	if (!showBody) {
		const summary = finishedToolSummary(tool, catalog?.displayTitle);
		const text = finishedToolSummaryText(summary);
		if (text) {
			const el = DOM.append(status, DOM.$('span.knox-gui-tool-summary', undefined, text));
			el.setAttribute('data-testid', 'tool-call-summary');
		}
	}
	if (showParams) {
		const toggle = DOM.append(head, DOM.$('button.knox-gui-tool-args-toggle')) as HTMLButtonElement;
		toggle.type = 'button';
		toggle.setAttribute('aria-expanded', String(argsOpen));
		widget.hover(toggle, argsOpen ? t(state, 'hideParameters') : t(state, 'showParameters'));
		appendKnoxGuiSvg(toggle, argsOpen ? 'chevron-up' : 'chevron-down', 16);
		widget.renderStore.add(DOM.addDisposableListener(toggle, 'click', e => {
			e.stopPropagation();
			if (widget.toolArgsOpen.has(tool.id)) {
				widget.toolArgsOpen.delete(tool.id);
			} else {
				widget.toolArgsOpen.add(tool.id);
			}
			widget.render();
		}));
	}
	if (showParams && argsOpen) {
		const list = DOM.append(box, DOM.$('.knox-gui-tool-args'));
		for (const [key, value] of argEntries) {
			const row = DOM.append(list, DOM.$('.knox-gui-tool-arg'));
			DOM.append(row, DOM.$('span.knox-gui-muted', undefined, `${key}:`));
			const valueEl = DOM.append(row, DOM.$('code.knox-gui-tool-arg-value', undefined, typeof value === 'string' ? value : JSON.stringify(value)));
			valueEl.title = typeof value === 'string' ? value : JSON.stringify(value);
		}
	}
	if (showBody) {
		const body = DOM.append(box, DOM.$('.knox-gui-tool-body'));
		widget.renderToolBody(body, state, tool, kind);
	}
	widget.renderToolActions(box, state, tool, kind, { placement: 'card' });
	if (tool.status === 'errored') {
		DOM.append(box, DOM.$('.knox-gui-error', undefined, tool.output ?? t(state, 'unknownError')));
	}
}

export function renderToolBody(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall, kind: ReturnType<typeof toolDisplayKind>): void {
	// KN-373: native ToolCallDiv kinds — terminal tail, search hits, repo-map, ask-user, subagent, create-file (no xterm).
	if (kind === 'ask-user') {
		widget.renderAskUser(parent, state, tool);
		return;
	}
	if (kind === 'terminal') {
		widget.renderTerminalTool(parent, state, tool);
		return;
	}
	if (kind === 'create-file') {
		widget.renderCreateFileTool(parent, state, tool);
		return;
	}
	if (kind === 'file') {
		widget.renderGenericCodeTool(parent, state, tool);
		return;
	}
	if (kind === 'subdirectory') {
		widget.renderSubdirectoryTool(parent, state, tool);
		return;
	}
	if (kind === 'repo-map') {
		widget.renderRepoMapTool(parent, state, tool);
		return;
	}
	if (kind === 'search') {
		widget.renderExactSearchTool(parent, state, tool);
		return;
	}
	if (kind === 'subagent') {
		widget.renderTaskSubagent(parent, state, tool);
		return;
	}
	widget.renderGenericCodeTool(parent, state, tool);
}

export function renderToolActions(widget: KnoxGuiWidget,
	parent: HTMLElement,
	state: IKnoxGuiState,
	tool: IKnoxGuiToolCall,
	kind: ReturnType<typeof toolDisplayKind>,
	options?: { placement?: 'card' | 'chat' | 'overlay' },
): void {
	if (kind === 'ask-user') {
		return;
	}
	const placement = options?.placement ?? 'overlay';
	if (placement === 'card' && (tool.status === 'generated' || tool.status === 'generating' || tool.status === 'calling')) {
		return;
	}
	if (placement === 'chat' && tool.status !== 'generated' && tool.status !== 'generating' && tool.status !== 'calling') {
		return;
	}
	if (tool.status === 'generating') {
		const row = DOM.append(parent, DOM.$('.knox-gui-tool-thinking', undefined, t(state, 'thinkingEllipsis')));
		row.setAttribute('data-testid', 'tool-thinking');
		return;
	}
	if (tool.status === 'calling') {
		const row = DOM.append(parent, DOM.$('.knox-gui-tool-calling'));
		widget.chromeButton(row, {
			label: t(state, 'cancel'),
			extraClass: 'knox-gui-tool-deny',
			testId: 'tool-calling-cancel',
			onClick: () => widget.controller.cancel(),
		});
		const loading = DOM.append(row, DOM.$('span.knox-gui-muted.knox-gui-tool-loading'));
		loading.append(t(state, 'loading'));
		widget.appendSpinner(loading, 16);
		return;
	}
	if (tool.status !== 'generated') {
		return;
	}
	const permission = toolPermissionDisplay({
		toolName: tool.name,
		toolSettings: state.toolSettings,
		sessionAllowlist: state.sessionToolAllowlist,
		tools: state.tools,
	});
	if (permission === 'autoApprove') {
		return;
	}
	if (placement !== 'overlay') {
		const catalog = catalogToolForCall(state.tools, tool.name);
		const label = catalog ? getCategorizedToolName(tool.name, catalog.displayTitle) : formatToolName(tool.name);
		const hint = DOM.append(parent, DOM.$('.knox-gui-tool-permission-hint', undefined, t(state, 'permissionForTool', { name: label })));
		hint.setAttribute('data-testid', 'permission-for-tool');
	}
	const actions = DOM.append(parent, DOM.$('.knox-gui-tool-permissions'));
	actions.setAttribute('data-testid', 'permission-action-buttons');
	actions.setAttribute('data-tool-name', tool.name);
	if (placement === 'overlay') {
		actions.classList.add('knox-gui-tool-permissions-compact');
	}
	const alwaysActive = permission === 'sessionAlways';
	widget.chromeButton(actions, {
		label: t(state, 'deny'),
		extraClass: 'knox-gui-tool-deny',
		onClick: () => widget.controller.denyTool(tool.id),
	});
	widget.chromeButton(actions, {
		label: t(state, 'alwaysThisSession'),
		title: t(state, 'alwaysThisSessionHint'),
		selected: alwaysActive,
		extraClass: alwaysActive ? 'knox-gui-tool-always-active' : '',
		onClick: () => void widget.controller.approveTool(tool.id, true),
	});
	widget.chromeButton(actions, {
		label: t(state, 'approveOnce'),
		extraClass: 'knox-gui-tool-approve',
		testId: 'accept-tool-call-button',
		onClick: () => void widget.controller.approveTool(tool.id),
	});
}

export function renderTerminalTool(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
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

	const card = DOM.append(parent, DOM.$('.knox-gui-term'));
	card.classList.toggle('light', isLight);
	card.classList.toggle('knox-gui-term-running', isStreaming);
	card.setAttribute('data-testid', 'knox-gui-term');
	const head = DOM.append(card, DOM.$('.knox-gui-term-head'));
	if (!expanded) {
		head.classList.add('collapsed');
	}
	const left = DOM.append(head, DOM.$('.knox-gui-term-head-left'));
	widget.collapseChevron(left, {
		expanded,
		title: expanded ? t(state, 'collapse') : t(state, 'expand'),
		testId: 'xterm-collapse',
		onClick: () => widget.toggleCardExpanded(tool.id, true),
	});
	const icon = appendKnoxGuiSvg(left, 'square-terminal', 13);
	icon.classList.add('knox-gui-term-icon');
	const title = DOM.append(left, DOM.$('span.knox-gui-term-title', undefined, t(state, 'terminal')));
	if (truncated) {
		const hint = DOM.append(title, DOM.$('span.knox-gui-term-truncated', undefined, t(state, 'truncatedTerminalOutput', { lines: hiddenLines })));
		hint.setAttribute('data-testid', 'xterm-truncated');
	}

	const right = DOM.append(head, DOM.$('.knox-gui-term-head-right'));
	if (isStreaming) {
		const badge = DOM.append(right, DOM.$('.knox-gui-term-badge.knox-gui-term-badge-running'));
		DOM.append(badge, DOM.$('span.knox-gui-term-pulse'));
		DOM.append(badge, DOM.$('span', undefined, t(state, 'running')));
	} else if (isDone) {
		const badge = DOM.append(right, DOM.$('.knox-gui-term-badge.knox-gui-term-badge-done'));
		appendKnoxGuiSvg(badge, 'check', 12);
		DOM.append(badge, DOM.$('span', undefined, t(state, 'toolUsed')));
	} else if (isCanceled) {
		const badge = DOM.append(right, DOM.$('.knox-gui-term-badge.knox-gui-term-badge-canceled'));
		appendKnoxGuiSvg(badge, 'x', 12);
		DOM.append(badge, DOM.$('span', undefined, t(state, 'toolCanceled')));
	}
	if (raw) {
		appendTerminalCopyAction(widget, right, state, {
			testId: 'xterm-copy-output',
			copyKey: `out:${tool.id}`,
			text: tool.output || raw,
			idleLabel: t(state, 'copy'),
			idleTitle: t(state, 'copyOutput'),
			showLabel: true,
		});
	}
	if (logPath) {
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
	if (command) {
		appendTerminalCopyAction(widget, right, state, {
			testId: 'xterm-copy-command',
			copyKey: `cmd:${tool.id}`,
			text: command,
			idleLabel: t(state, 'copy'),
			idleTitle: t(state, 'copyCommand'),
			showLabel: false,
		});
	}
	if (!expanded) {
		return;
	}

	const body = DOM.append(card, DOM.$('.knox-gui-term-body'));
	body.style.height = `${height}px`;
	if (state.codeWrap) {
		body.classList.add('wrap');
	}
	const pre = DOM.append(body, DOM.$('pre.knox-gui-term-pre'));
	if (command) {
		const line = DOM.append(pre, DOM.$('span.knox-gui-term-prompt-line'));
		const prompt = DOM.append(line, DOM.$('span.knox-gui-term-prompt', undefined, '❯'));
		prompt.classList.add('hljs-title', 'function_');
		prompt.style.color = knoxGuiHljsTokenColor(state.vscTokenColors, ['.hljs-title.function_', '.hljs-built_in'], palette.green);
		const cmd = DOM.append(line, DOM.$('span.knox-gui-term-command', undefined, command));
		cmd.classList.add('hljs-string');
		cmd.style.color = knoxGuiHljsTokenColor(state.vscTokenColors, ['.hljs-string'], palette.foreground);
		cmd.setAttribute('data-testid', 'xterm-command');
	}
	if (tail) {
		const out = DOM.append(pre, DOM.$('span.knox-gui-term-output'));
		out.setAttribute('data-testid', 'xterm-output');
		widget.appendAnsi(out, tail, palette);
	} else if (isStreaming) {
		DOM.append(pre, DOM.$('span.knox-gui-term-cursor', undefined, '▋'));
	}

	widget.renderStore.add(DOM.addDisposableListener(body, 'scroll', () => {
		const { scrollTop, scrollHeight, clientHeight } = body;
		const atBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 30;
		const last = widget.termScrollTop.get(tool.id) ?? 0;
		if (scrollTop < last && !atBottom) {
			widget.termUserScrolled.add(tool.id);
		} else if (atBottom) {
			widget.termUserScrolled.delete(tool.id);
		}
		widget.termScrollTop.set(tool.id, scrollTop);
	}));
	queueMicrotask(() => {
		if (widget.termUserScrolled.has(tool.id)) {
			body.scrollTop = widget.termScrollTop.get(tool.id) ?? 0;
		} else {
			body.scrollTop = body.scrollHeight;
			widget.termScrollTop.set(tool.id, body.scrollTop);
		}
	});
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
	const icon = appendKnoxGuiSvg(btn, copied ? 'check' : 'copy', 14);
	icon.classList.add('knox-gui-term-action-icon');
	if (options.showLabel) {
		DOM.append(btn, DOM.$('span.knox-gui-term-action-label', undefined, copied ? t(state, 'copied') : options.idleLabel));
	}
	widget.hover(btn, copied ? t(state, 'copied') : options.idleTitle);
	widget.renderStore.add(DOM.addDisposableListener(btn, 'click', e => {
		e.stopPropagation();
		widget.controller.copyText(options.text);
		widget.termCopiedUntil.set(options.copyKey, Date.now() + 2000);
		widget.render();
		window.setTimeout(() => {
			if ((widget.termCopiedUntil.get(options.copyKey) ?? 0) <= Date.now()) {
				widget.termCopiedUntil.delete(options.copyKey);
				widget.render();
			}
		}, 2000);
	}));
}

export function renderCreateFileTool(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
	const extracted = extractStreamingToolCode({ parsedArgs: tool.parsedArgs, rawArguments: tool.arguments });
	const filepath = String(tool.parsedArgs?.filepath ?? extracted.filepath ?? '');
	const contents = String(tool.parsedArgs?.contents ?? extracted.codeContent ?? '');
	if (!filepath && !contents && !extracted.started) {
		return;
	}
	const box = DOM.append(parent, DOM.$('.knox-gui-create-file'));
	box.setAttribute('data-testid', 'knox-gui-create-file');
	if (filepath) {
		const row = DOM.append(box, DOM.$('.knox-gui-tool-file-row.knox-gui-tool-kind-title'));
		DOM.append(row, DOM.$('span.knox-gui-cyan', undefined, t(state, 'createdFile')));
		widget.renderClickablePath(row, filepath);
	}
	widget.renderToolCodePreview(box, state, tool, filepath, contents, displayLanguageForFile(filepath), false);
}

export function renderGenericCodeTool(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
	const extracted = extractStreamingToolCode({ parsedArgs: tool.parsedArgs, rawArguments: tool.arguments });
	const streaming = tool.status === 'generating' || tool.status === 'calling';
	if ((!extracted.started && !extracted.codeContent && !extracted.filepath) || (!extracted.codeContent && !extracted.filepath && !streaming)) {
		return;
	}
	const collapsePreview = collapseFileToolCodePreview(tool.name);
	const language = displayLanguageForFile(extracted.filepath, extracted.contentKey);
	const label = extracted.filepath || (extracted.contentKey === 'patch' || extracted.contentKey === 'diff' ? 'patch' : '');
	widget.renderToolCodePreview(parent, state, tool, label, extracted.codeContent, language, collapsePreview);
}

/** `GenericCodePreview` / `CreateFile`: the tool code is a step-container fence with the same toolbars as a reply. */
export function renderToolCodePreview(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall, filepath: string, code: string, language: string, collapsedByDefault: boolean): void {
	widget.renderCodeFenceBlock(parent, state, {
		streamId: `tool:${tool.id}:code`,
		fence: { language, filepath: filepath || undefined, code },
		generating: tool.status === 'generating' || tool.status === 'calling',
		anchor: collapsedByDefault ? 'start' : 'end',
		expanded: collapsedByDefault ? false : undefined,
	});
}

export function renderSubdirectoryTool(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
	const args = tool.parsedArgs ?? {};
	const items = tool.outputItems?.length ? tool.outputItems : (tool.output ? [{ content: tool.output }] : []);
	const parts = subdirectoryOutputParts(items);
	const isLight = widget.isLightTheme();
	const theme = treeThemeColors(isLight);
	const retrieving = t(state, 'retrievingDirStructure');
	const hasEnhanced = parts.summary.includes('Directory Analysis Summary') || parts.structure.includes('├──') || parts.structure.includes('└──');
	const tree = !parts.raw
		? { plain: retrieving, colorized: retrieving }
		: hasEnhanced
			? { plain: parts.raw, colorized: colorizeTreeStructure(parts.raw, isLight) }
			: repoMapToTreeColorized(parts.raw);
	const stats = treeStatsFromPlain(tree.plain, parts.summary);
	const badges = subdirectoryFilterBadges(args);
	const pathLabel = String(args.directory_path ?? args.path ?? '').trim() || '.';
	const shortDirName = pathLabel.split('/').filter(Boolean).pop() || pathLabel;
	const expanded = widget.cardExpanded(tool.id, false);
	const tab = widget.toolCardTab.get(tool.id) === 'summary' ? 'summary' : 'structure';
	const title = DOM.append(parent, DOM.$('.knox-gui-tool-kind-title.is-subdir'));
	appendKnoxGuiSvg(title, 'folder', 16).classList.add('knox-gui-tree-folder-icon');
	DOM.append(title, DOM.$('span.knox-gui-cyan', undefined, t(state, 'viewSubdirectory')));
	for (const badge of badges) {
		DOM.append(title, DOM.$('span.knox-gui-tool-badge', undefined, badge));
	}
	widget.renderTreeCard(parent, state, {
		id: tool.id,
		kind: 'subdirectory',
		expanded,
		theme,
		title: shortDirName,
		subtitle: pathLabel !== shortDirName && pathLabel !== '.' ? pathLabel : undefined,
		stats: tree.plain === retrieving ? undefined : stats,
		preview: treePreviewLines(tree.plain).text,
		colorized: tab === 'summary' && parts.summary ? colorizeSummary(parts.summary, isLight) : tree.colorized,
		toggleTestId: 'subdirectory-toggle',
		staticTestId: 'subdirectory-static',
		notice: expanded ? parts.notice : undefined,
		tabs: parts.summary && expanded ? { active: tab, onStructure: () => widget.setCardTab(tool.id, 'structure'), onSummary: () => widget.setCardTab(tool.id, 'summary') } : undefined,
	});
}

export function renderRepoMapTool(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
	const items = tool.outputItems?.length ? tool.outputItems : (tool.output ? [{ content: tool.output }] : []);
	const raw = repoMapOutput(items);
	const retrieving = t(state, 'retrievingRepoStructure');
	const tree = raw ? repoMapToTreeColorized(raw) : { plain: retrieving, colorized: `\x1b[90m${retrieving}\x1b[0m` };
	const stats = treeStatsFromPlain(tree.plain);
	const isLight = widget.isLightTheme();
	const theme = treeThemeColors(isLight);
	const expanded = widget.cardExpanded(tool.id, false);
	const title = DOM.append(parent, DOM.$('.knox-gui-tool-kind-title'));
	appendKnoxGuiSvg(title, 'folder-tree', 16);
	DOM.append(title, DOM.$('span.knox-gui-cyan', undefined, t(state, 'viewRepoStructure')));
	widget.renderTreeCard(parent, state, {
		id: tool.id,
		kind: 'repo-map',
		expanded,
		theme,
		title: t(state, 'repositoryStructure'),
		stats: stats.total > 0 ? stats : undefined,
		emptyHint: t(state, 'browsingEntireRepo'),
		preview: treePreviewLines(tree.plain).text,
		colorized: tree.colorized,
		toggleTestId: 'repo-map-toggle',
		staticTestId: 'repo-map-static',
		cardTestId: 'knox-gui-repo-map',
	});
}

export function renderTreeCard(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, options: {
	id: string;
	kind?: 'subdirectory' | 'repo-map';
	expanded: boolean;
	theme: ReturnType<typeof treeThemeColors>;
	title: string;
	subtitle?: string;
	stats?: { files: number; folders: number; total: number; size?: string };
	emptyHint?: string;
	preview: string;
	colorized: string;
	toggleTestId: string;
	staticTestId: string;
	cardTestId?: string;
	notice?: string;
	tabs?: { active: string; onStructure: () => void; onSummary: () => void };
}): HTMLElement {
	const card = DOM.append(parent, DOM.$('.knox-gui-tree-card'));
	if (options.cardTestId) {
		card.setAttribute('data-testid', options.cardTestId);
	}
	card.style.background = options.theme.background;
	card.style.borderColor = options.theme.border;
	const head = DOM.append(card, DOM.$('.knox-gui-tree-head'));
	head.style.background = `linear-gradient(135deg, ${options.theme.backgroundGradientStart} 0%, ${options.theme.backgroundGradientEnd} 100%)`;
	widget.collapseChevron(head, {
		expanded: options.expanded,
		title: options.expanded ? t(state, 'collapse') : t(state, 'expand'),
		testId: options.toggleTestId,
		onClick: () => widget.toggleCardExpanded(options.id, false),
	});
	const meta = DOM.append(head, DOM.$('.knox-gui-tree-meta'));
	if (options.kind === 'subdirectory') {
		appendKnoxGuiSvg(meta, 'folder', 14).classList.add('knox-gui-tree-folder-icon');
	}
	const name = DOM.append(meta, DOM.$('span.knox-gui-tree-title', undefined, options.title));
	name.style.color = options.kind === 'repo-map' ? options.theme.foreground : options.theme.accent;
	if (options.subtitle) {
		const sub = DOM.append(meta, DOM.$('code.knox-gui-tree-sub', undefined, options.subtitle));
		sub.style.color = options.theme.foregroundMuted;
	}
	const statsEl = DOM.append(meta, DOM.$('span.knox-gui-tree-stats'));
	statsEl.style.color = options.theme.foregroundMuted;
	if (options.stats && options.stats.total > 0) {
		statsEl.textContent = `• ${t(state, 'foldersFolders', { folders: options.stats.folders, files: options.stats.files })}${options.stats.size ? ` • ${options.stats.size}` : ''}`;
	} else if (options.emptyHint) {
		statsEl.textContent = options.emptyHint;
	}
	if (options.tabs) {
		const tabs = DOM.append(head, DOM.$('.knox-gui-tree-tabs'));
		const structure = DOM.append(tabs, DOM.$('button', undefined, t(state, 'structureTab'))) as HTMLButtonElement;
		structure.type = 'button';
		structure.classList.toggle('selected', options.tabs.active === 'structure');
		widget.renderStore.add(DOM.addDisposableListener(structure, 'click', options.tabs.onStructure));
		const summary = DOM.append(tabs, DOM.$('button', undefined, t(state, 'summaryTab'))) as HTMLButtonElement;
		summary.type = 'button';
		summary.classList.toggle('selected', options.tabs.active === 'summary');
		widget.renderStore.add(DOM.addDisposableListener(summary, 'click', options.tabs.onSummary));
	}
	if (!options.expanded) {
		const preview = DOM.append(card, DOM.$('pre.knox-gui-tree-preview', undefined, options.preview));
		preview.setAttribute('data-testid', options.staticTestId);
		preview.style.color = options.theme.foreground;
		return card;
	}
	const body = DOM.append(card, DOM.$(options.kind === 'repo-map' ? 'pre.knox-gui-tree-body.is-repo-map' : 'pre.knox-gui-tree-body'));
	body.style.color = options.theme.foreground;
	widget.appendAnsi(body, options.colorized, widget.isLightTheme() ? LIGHT_TERMINAL_PALETTE : DARK_TERMINAL_PALETTE);
	if (options.notice) {
		const notice = DOM.append(card, DOM.$('.knox-gui-tree-notice', undefined, options.notice));
		if (widget.isLightTheme()) {
			notice.classList.add('is-light');
		}
	}
	return card;
}

export function renderExactSearchTool(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
	const query = String(tool.parsedArgs?.query ?? '');
	const items = tool.outputItems?.length ? tool.outputItems : (tool.output ? [{ content: tool.output }] : []);
	const content = searchOutput(items);
	const parsed = parseSearchResults(content);
	const matches = parsed.reduce((sum, file) => sum + file.lines.filter(line => line.isMatch).length, 0);
	const streaming = tool.status === 'generating' || tool.status === 'calling';
	const expanded = widget.cardExpanded(tool.id, true);
	const title = DOM.append(parent, DOM.$('.knox-gui-tool-kind-title'));
	appendKnoxGuiSvg(title, 'search', 16);
	DOM.append(title, DOM.$('span.knox-gui-cyan', undefined, t(state, 'exactSearch')));
	const card = DOM.append(parent, DOM.$('.knox-gui-search-card'));
	card.setAttribute('data-testid', 'knox-gui-search');
	const head = DOM.append(card, DOM.$('.knox-gui-search-head'));
	widget.collapseChevron(head, {
		expanded,
		title: expanded ? t(state, 'collapse') : t(state, 'expand'),
		onClick: () => widget.toggleCardExpanded(tool.id, true),
	});
	appendKnoxGuiSvg(head, 'search', 14);
	DOM.append(head, DOM.$('code.knox-gui-search-query', undefined, query || '...'));
	const stats = DOM.append(head, DOM.$('span.knox-gui-muted'));
	stats.textContent = streaming
		? t(state, 'searching')
		: parsed.length > 0
			? `• ${t(state, 'matchesInFiles', { matches, files: parsed.length })}`
			: t(state, 'noMatchesFound');
	if (!expanded) {
		return;
	}
	const body = DOM.append(card, DOM.$('.knox-gui-search-body'));
	if (streaming) {
		const loading = DOM.append(body, DOM.$('.knox-gui-search-empty'));
		widget.appendSpinner(loading, 16);
		DOM.append(loading, DOM.$('span', undefined, t(state, 'searchingRepository')));
		return;
	}
	if (!parsed.length) {
		const empty = DOM.append(body, DOM.$('.knox-gui-search-empty'));
		appendKnoxGuiSvg(empty, 'search', 28);
		DOM.append(empty, DOM.$('span', undefined, t(state, 'noMatchesFound')));
		return;
	}
	for (const file of parsed) {
		const block = DOM.append(body, DOM.$('.knox-gui-search-file'));
		const fileHead = DOM.append(block, DOM.$('.knox-gui-search-file-head'));
		widget.renderClickablePath(fileHead, file.filePath, { showIcon: true });
		DOM.append(fileHead, DOM.$('span.knox-gui-tool-badge', undefined, file.language));
		for (const line of file.lines) {
			const row = DOM.append(block, DOM.$('button.knox-gui-search-line')) as HTMLButtonElement;
			row.type = 'button';
			if (line.isMatch) {
				row.classList.add('match');
			}
			row.title = `${file.filePath}:${line.lineNum}`;
			DOM.append(row, DOM.$('span.knox-gui-search-ln', undefined, String(line.lineNum)));
			const code = DOM.append(row, DOM.$('code.knox-gui-search-code'));
			widget.paintHighlightedCode(code, file.language, line.content, file.filePath);
			if (line.isMatch && query) {
				setKnoxGuiInnerHtml(code, highlightSearchQueryInHtml(code.innerHTML, query));
			}
			widget.renderStore.add(DOM.addDisposableListener(row, 'click', () => {
				widget.controller.showFile(file.filePath, { startLine: line.lineNum, endLine: line.lineNum });
			}));
		}
	}
}

export function renderTaskSubagent(widget: KnoxGuiWidget, parent: HTMLElement, _state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
	const args = tool.parsedArgs ?? {};
	const profile = typeof args.profile === 'string' ? args.profile : 'explore';
	const prompt = typeof args.prompt === 'string' ? args.prompt : '';
	const explores = Array.isArray(args.explores) ? args.explores.length : 0;
	const output = tool.outputItems?.[0]?.content ?? tool.output;
	const card = DOM.append(parent, DOM.$('.knox-gui-subagent'));
	card.setAttribute('data-testid', 'knox-gui-subagent');
	card.setAttribute('data-subagent-profile', profile);
	const meta = DOM.append(card, DOM.$('.knox-gui-muted.knox-gui-subagent-meta'));
	meta.setAttribute('data-testid', 'knox-gui-subagent-meta');
	meta.textContent = `${profile}${explores > 1 ? ` ×${explores}` : ''}${prompt ? ` — ${prompt.slice(0, 160)}${prompt.length > 160 ? '…' : ''}` : ''}`;
	if (output) {
		DOM.append(card, DOM.$('pre.knox-gui-subagent-output', undefined, output));
	}
}

export function renderAskUser(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
	const questions = tool.questions?.length ? tool.questions : parseAskUserQuestionsForGui(tool.parsedArgs?.questions);
	if (!questions.length) {
		const invalid = DOM.append(parent, DOM.$('.knox-gui-muted', undefined, t(state, 'askUserInvalid')));
		invalid.setAttribute('data-testid', 'knox-gui-ask-invalid');
		return;
	}
	const drafts = widget.askUserDrafts.get(tool.id) ?? { ...(tool.answers ?? {}) };
	widget.askUserDrafts.set(tool.id, drafts);
	const waiting = tool.status === 'generated';
	const declined = tool.status === 'canceled';
	if (!waiting) {
		const card = DOM.append(parent, DOM.$('.knox-gui-ask-card'));
		card.setAttribute('data-testid', 'knox-gui-ask');
		for (const question of questions) {
			const row = DOM.append(card, DOM.$('.knox-gui-ask-done'));
			DOM.append(row, DOM.$('div.knox-gui-muted', undefined, question.prompt));
			const answer = DOM.append(row, DOM.$('.knox-gui-ask-answer'));
			appendKnoxGuiSvg(answer, 'check', 14);
			DOM.append(answer, DOM.$('span', undefined, formatAskUserDisplayAnswer(drafts, question.id, tool.answers?.[question.id]) || (declined ? t(state, 'askUserDeclined') : t(state, 'askUserAnswered'))));
		}
		return;
	}
	const card = DOM.append(parent, DOM.$('.knox-gui-ask-card'));
	card.setAttribute('data-testid', 'knox-gui-ask');
	card.setAttribute('role', 'form');
	card.tabIndex = 0;
	const step = Math.min(widget.askUserStep.get(tool.id) ?? 0, Math.max(0, questions.length - 1));
	if (questions.length > 1) {
		const progress = DOM.append(card, DOM.$('.knox-gui-ask-progress', undefined, t(state, 'askUserProgress', { current: step + 1, total: questions.length })));
		progress.setAttribute('data-testid', 'knox-gui-ask-progress');
		const track = DOM.append(progress, DOM.$('.knox-gui-ask-progress-track'));
		const fill = DOM.append(track, DOM.$('.knox-gui-ask-progress-fill'));
		fill.style.width = `${((step + 1) / questions.length) * 100}%`;
	}
	const question = questions[step];
	const item = DOM.append(card, DOM.$('.knox-gui-ask-item'));
	DOM.append(item, DOM.$('.knox-gui-ask-prompt', undefined, question.prompt));
	if (question.allowMultiple) {
		DOM.append(item, DOM.$('.knox-gui-muted', undefined, t(state, 'askUserMultipleHint')));
	}
	const freeformKey = `${question.id}::freeform`;
	const selected = new Set((drafts[question.id] ?? '').split('\u0001').filter(Boolean));
	const setChoice = (option: string) => {
		if (question.allowMultiple) {
			if (selected.has(option)) {
				selected.delete(option);
			} else {
				selected.add(option);
			}
			drafts[question.id] = [...selected].join('\u0001');
		} else {
			drafts[question.id] = option;
		}
		widget.askUserDrafts.set(tool.id, drafts);
		widget.render();
	};
	if (question.options?.length) {
		const choices = DOM.append(item, DOM.$('.knox-gui-ask-choices'));
		question.options.forEach((option, optionIndex) => {
			const split = splitChoiceText(option);
			const btn = DOM.append(choices, DOM.$('button.knox-gui-ask-choice')) as HTMLButtonElement;
			btn.type = 'button';
			if (selected.has(option)) {
				btn.classList.add('selected');
			}
			const row = DOM.append(btn, DOM.$('.knox-gui-ask-choice-row'));
			const mark = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			mark.type = question.allowMultiple ? 'checkbox' : 'radio';
			mark.checked = selected.has(option);
			mark.tabIndex = -1;
			const texts = DOM.append(row, DOM.$('span.knox-gui-ask-choice-texts'));
			DOM.append(texts, DOM.$('span.knox-gui-ask-choice-label', undefined, split.label));
			if (split.description) {
				DOM.append(texts, DOM.$('span.knox-gui-muted.knox-gui-ask-choice-desc', undefined, split.description));
			}
			if (optionIndex < 9) {
				DOM.append(row, DOM.$('kbd.knox-gui-ask-kbd', undefined, String(optionIndex + 1)));
			}
			widget.renderStore.add(DOM.addDisposableListener(btn, 'click', () => setChoice(option)));
		});
	}
	if (question.allowFreeform || !question.options?.length) {
		const input = DOM.append(item, DOM.$('input.knox-gui-ask-input')) as HTMLInputElement;
		input.placeholder = t(state, 'askUserFreeform');
		input.setAttribute('aria-label', t(state, 'askUserFreeformLabel'));
		input.value = drafts[freeformKey] ?? (question.allowMultiple || question.options?.length ? '' : (drafts[question.id] ?? ''));
		widget.renderStore.add(DOM.addDisposableListener(input, 'input', () => {
			if (question.allowMultiple || question.options?.length) {
				drafts[freeformKey] = input.value;
			} else {
				drafts[question.id] = input.value;
			}
			widget.askUserDrafts.set(tool.id, drafts);
		}));
	}
	const answered = isAskUserAnswered(drafts[question.id]) || isAskUserAnswered(drafts[freeformKey]);
	const goNext = () => {
		if (!answered || step >= questions.length - 1) {
			return;
		}
		widget.askUserStep.set(tool.id, step + 1);
		widget.render();
	};
	const submit = () => {
		if (!answered) {
			return;
		}
		const answers: Record<string, string> = {};
		const latest = widget.askUserDrafts.get(tool.id) ?? drafts;
		for (const q of questions) {
			const choices = (latest[q.id] ?? '').split('\u0001').filter(Boolean);
			const extra = (latest[`${q.id}::freeform`] ?? '').trim();
			answers[q.id] = [...choices, extra].filter(Boolean).join(', ');
		}
		widget.controller.answerAskUser(tool.id, answers);
	};
	const isTypingTarget = (target: EventTarget | null) => {
		if (!(target instanceof HTMLElement)) {
			return false;
		}
		const tag = target.tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
	};
	widget.renderStore.add(DOM.addDisposableListener(card, 'keydown', e => {
		if (e.key === 'Enter' && !e.shiftKey) {
			if (isTypingTarget(e.target) && !answered) {
				return;
			}
			e.preventDefault();
			if (step < questions.length - 1) {
				goNext();
			} else {
				submit();
			}
			return;
		}
		if (isTypingTarget(e.target) || e.key.length !== 1) {
			return;
		}
		const index = Number(e.key) - 1;
		const option = question.options?.[index];
		if (option) {
			e.preventDefault();
			setChoice(option);
		}
	}));
	const actions = DOM.append(card, DOM.$('.knox-gui-ask-actions'));
	widget.chromeButton(actions, { label: t(state, 'deny'), extraClass: 'knox-gui-tool-deny', testId: 'ask-user-deny', onClick: () => widget.controller.denyTool(tool.id) });
	if (questions.length > 1 && step > 0) {
		widget.chromeButton(actions, {
			label: t(state, 'askUserPrevious'),
			testId: 'ask-user-previous',
			onClick: () => {
				widget.askUserStep.set(tool.id, step - 1);
				widget.render();
			},
		});
	}
	if (questions.length > 1 && step < questions.length - 1) {
		widget.chromeButton(actions, {
			label: t(state, 'askUserNext'),
			testId: 'ask-user-next',
			disabled: !answered,
			onClick: goNext,
		});
	} else {
		widget.chromeButton(actions, {
			label: t(state, 'askUserSubmit'),
			extraClass: 'knox-gui-tool-approve',
			testId: 'ask-user-submit',
			disabled: !answered,
			onClick: submit,
		});
	}
}

/** `FileIcon.tsx`: icon from the active file icon theme, by file name and language. */
export function appendFileIcon(widget: KnoxGuiWidget, parent: HTMLElement, filepath: string, size = 16, folder = false): HTMLElement {
	const icon = DOM.append(parent, DOM.$('span.knox-gui-file-icon'));
	icon.style.width = `${size}px`;
	icon.style.height = `${size}px`;
	icon.setAttribute('aria-hidden', 'true');
	try {
		const resource = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(filepath) ? URI.parse(filepath) : URI.file(filepath);
		icon.classList.add(...getIconClasses(widget.modelService, widget.languageService, resource, folder ? FileKind.FOLDER : FileKind.FILE));
	} catch {
		icon.classList.add(folder ? 'folder-icon' : 'file-icon');
	}
	return icon;
}

export function renderClickablePath(widget: KnoxGuiWidget, parent: HTMLElement, filepath: string, options?: { range?: string; startLine?: number; endLine?: number; showIcon?: boolean }): void {
	const btn = DOM.append(parent, DOM.$('button.knox-gui-code-file')) as HTMLButtonElement;
	btn.type = 'button';
	btn.setAttribute('data-testid', 'clickable-file-path');
	widget.hover(btn, filepath);
	if (options?.showIcon) {
		appendFileIcon(widget, btn, filepath);
	}
	const { dir, name } = splitDisplayPath(filepath);
	if (dir) {
		DOM.append(btn, DOM.$('span.knox-gui-path-dir', undefined, dir));
	}
	DOM.append(btn, DOM.$('span.knox-gui-path-name', undefined, name));
	if (options?.range) {
		DOM.append(btn, DOM.$('span.knox-gui-path-range', undefined, options.range));
	}
	const parsed = parseCodeFenceRange(options?.range);
	const startLine = options?.startLine ?? parsed?.startLine;
	const endLine = options?.endLine ?? parsed?.endLine;
	widget.listenerStore.add(DOM.addDisposableListener(btn, 'click', () => widget.controller.showFile(filepath, { startLine, endLine })));
}

export function appendAnsi(widget: KnoxGuiWidget, parent: HTMLElement, text: string, palette: typeof DARK_TERMINAL_PALETTE): void {
	parent.replaceChildren();
	for (const span of parseAnsiSpans(text, palette)) {
		if (!span.color && !span.bold && !span.dim) {
			parent.append(span.text);
			continue;
		}
		const el = DOM.append(parent, DOM.$('span', undefined, span.text));
		if (span.color) {
			el.style.color = span.color;
		}
		if (span.bold) {
			el.style.fontWeight = 'bold';
		}
		if (span.dim) {
			el.style.opacity = '0.6';
		}
	}
}

export function isLightTheme(widget: KnoxGuiWidget): boolean {
	const stored = knoxGuiStateThemeIsLight(widget.controller.store.state);
	if (stored !== undefined) {
		return stored;
	}
	return luminanceIsLight(getComputedStyle(widget.root).getPropertyValue('--vscode-editor-background').trim());
}

export function cardExpanded(widget: KnoxGuiWidget, id: string, defaultExpanded: boolean): boolean {
	if (widget.toolCardExpanded.has(id)) {
		return true;
	}
	if (widget.toolBodyCollapsed.has(`card:${id}`)) {
		return false;
	}
	return defaultExpanded;
}

export function toggleCardExpanded(widget: KnoxGuiWidget, id: string, defaultExpanded: boolean): void {
	const open = widget.cardExpanded(id, defaultExpanded);
	if (open) {
		widget.toolCardExpanded.delete(id);
		widget.toolBodyCollapsed.add(`card:${id}`);
	} else {
		widget.toolBodyCollapsed.delete(`card:${id}`);
		widget.toolCardExpanded.add(id);
	}
	widget.render();
}

export function setCardTab(widget: KnoxGuiWidget, id: string, tab: string): void {
	widget.toolCardTab.set(id, tab);
	widget.render();
}
