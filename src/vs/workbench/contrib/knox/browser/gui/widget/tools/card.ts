/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Tool-call card shell: head, status copy, args, body dispatch, permissions, live patch. */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { safeSetInnerHtml } from '../../../../../../../base/browser/domSanitize.js';
import { appendKnoxGuiSvg } from '../../knoxGuiIcons.js';
import { toolDisplayKind } from '../../../../common/knoxGuiChat.js';
import { knoxGuiToolBodyCollapsed, knoxGuiToolToggle } from '../../../../common/knoxGuiToolCollapse.js';
import {
	catalogToolForCall,
	displayArgsForToolCall,
	displayLanguageForFile,
	extractStreamingToolCode,
	finishedToolSummary,
	finishedToolSummaryText,
	formatToolName,
	getCategorizedToolName,
	renderToolTemplateHtml,
	shouldRenderToolBody,
	toolAlwaysShowsBody,
	toolPermissionDisplay,
	toolStatusFallbackKey,
	toolStatusIcon,
	toolStatusIntroKey,
} from '../../../../common/knoxGuiTools.js';
import { IKnoxGuiState, IKnoxGuiToolCall } from '../../../../common/knoxGuiState.js';
import { activityAnchorId, IKnoxGuiMarkdownFenceBlock } from '../../../../common/knoxGuiTranscript.js';
import { patchLiveCodeFence } from '../markdown.js';
import { patchToolCodePreview, toolCodeDiffPreviews } from './code.js';
import { renderToolSearch } from './search.js';
import { syncTerminalCard } from './terminal.js';

export function toolStreamFingerprint(tool: IKnoxGuiToolCall): string {
	return `${tool.status}\0${tool.arguments}\0${tool.output ?? ''}\0${tool.outputItems?.length ?? 0}\0${tool.collapsed ? 1 : 0}`;
}

/** Update a mounted tool card in place (XTermTerminal / GenericCodePreview stay mounted). */
export function patchLiveTool(widget: KnoxGuiWidget, box: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): boolean {
	box.dataset.stream = toolStreamFingerprint(tool);
	box.setAttribute('data-tool-status', tool.status);
	const kind = toolDisplayKind(tool.name);
	if (kind === 'terminal') {
		const term = box.querySelector('[data-testid="knox-gui-term"]') as HTMLElement | null;
		if (!term) {
			return false;
		}
		syncTerminalCard(widget, term, state, tool);
		return true;
	}
	if (kind !== 'file' && kind !== 'generic' && kind !== 'create-file') {
		return false;
	}
	if (tool.status === 'generated' && !box.querySelector('[data-testid="permission-action-buttons"]') && toolPermissionDisplay({
		toolName: tool.name,
		toolSettings: state.toolSettings,
		sessionAllowlist: state.sessionToolAllowlist,
		tools: state.tools,
	}) !== 'autoApprove') {
		return false;
	}
	syncToolStatusIcon(widget, box, tool);
	const extracted = extractStreamingToolCode({ parsedArgs: tool.parsedArgs, rawArguments: tool.arguments });
	const generating = tool.status === 'generating' || tool.status === 'calling';
	const previews = toolCodeDiffPreviews(tool, extracted, kind);
	const codeBoxes = Array.from(box.querySelectorAll('.knox-gui-code-block')) as HTMLElement[];
	if (previews.length && codeBoxes.length === previews.length) {
		return previews.every((preview, index) => patchToolCodePreview(widget, codeBoxes[index], state, tool, preview, index, generating, previews.length));
	}
	if (previews.length !== codeBoxes.length && (previews.length > 0 || codeBoxes.length > 1)) {
		return false;
	}
	const language = kind === 'create-file'
		? displayLanguageForFile(String(tool.parsedArgs?.filepath ?? extracted.filepath ?? ''))
		: displayLanguageForFile(extracted.filepath, extracted.contentKey);
	const filepath = kind === 'create-file'
		? String(tool.parsedArgs?.filepath ?? extracted.filepath ?? '')
		: (extracted.filepath || (extracted.contentKey === 'patch' || extracted.contentKey === 'diff' ? 'patch' : ''));
	const code = kind === 'create-file'
		? String(tool.parsedArgs?.contents ?? extracted.codeContent ?? '')
		: extracted.codeContent;
	const codeBox = codeBoxes[0];
	if (codeBox) {
		const fence: IKnoxGuiMarkdownFenceBlock = { type: 'fence', language, filepath: filepath || undefined, code, closed: !generating };
		const stats = kind === 'create-file' && code ? { additions: code.split('\n').length } : undefined;
		return patchLiveCodeFence(widget, [codeBox], state, { id: tool.id, role: 'assistant', content: '' }, fence, 0, generating, `tool:${tool.id}:code`, stats);
	}
	if (!extracted.started && !code && !filepath) {
		return true;
	}
	const body = box.querySelector('.knox-gui-tool-body') as HTMLElement | null;
	if (!body) {
		return false;
	}
	if (kind === 'create-file') {
		widget.renderCreateFileTool(body, state, tool);
	} else {
		widget.renderGenericCodeTool(body, state, tool);
	}
	return Boolean(body.querySelector('.knox-gui-code-block'));
}

function syncToolStatusIcon(widget: KnoxGuiWidget, box: HTMLElement, tool: IKnoxGuiToolCall): void {
	const icon = box.querySelector('.knox-gui-tool-status') as HTMLElement | null;
	if (!icon) {
		return;
	}
	const statusIcon = toolStatusIcon(tool.status);
	const wantSpinner = statusIcon === 'spinner';
	const hasSpinner = icon.classList.contains('knox-gui-tool-status-live');
	if (wantSpinner === hasSpinner) {
		return;
	}
	icon.replaceChildren();
	icon.classList.toggle('knox-gui-tool-status-live', wantSpinner);
	icon.classList.toggle('knox-gui-tool-status-glyph', !wantSpinner);
	if (wantSpinner) {
		widget.appendSpinner(icon, 16);
	} else {
		appendKnoxGuiSvg(icon, statusIcon, 14);
	}
}

export function renderTool(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, tool: IKnoxGuiToolCall): void {
	const box = DOM.append(parent, DOM.$('.knox-gui-tool'));
	box.setAttribute('data-testid', 'knox-gui-tool');
	box.setAttribute('data-tool-name', tool.name);
	box.setAttribute('data-tool-id', tool.id);
	box.setAttribute('data-tool-status', tool.status);
	box.dataset.stream = toolStreamFingerprint(tool);
	box.id = activityAnchorId(`tool:${tool.id}`);
	const kind = toolDisplayKind(tool.name);
	const catalog = catalogToolForCall(state.tools, tool.name);
	const alwaysShow = toolAlwaysShowsBody(tool.name);
	const collapsed = knoxGuiToolBodyCollapsed(tool, { expanded: widget.toolBodyExpanded.has(tool.id), collapsed: widget.toolBodyCollapsed.has(tool.id) });
	const displayArgs = displayArgsForToolCall(tool.parsedArgs, tool.arguments);
	const argEntries = Object.entries(displayArgs);
	const hideParams = kind === 'ask-user' || (kind === 'create-file' && tool.status === 'done');
	const showParams = argEntries.length > 0 && !hideParams;
	const argsOpen = widget.toolArgsOpen.has(tool.id);
	const isLive = tool.status === 'generating' || tool.status === 'generated' || tool.status === 'calling';
	const wantBody = shouldRenderToolBody(tool.status, collapsed, { alwaysShow });
	const body = wantBody ? DOM.$('.knox-gui-tool-body') : undefined;
	if (body) {
		widget.renderToolBody(body, state, tool, kind);
	}
	// Title-only tools (plan, memory, …) must not keep an empty expanded body — that
	// extra padding lifts the header text off the same centre line as the command card.
	const showBody = Boolean(body && (alwaysShow || isLive || body.childElementCount > 0));

	const head = DOM.append(box, DOM.$('.knox-gui-tool-head'));
	const left = DOM.append(head, DOM.$('.knox-gui-tool-head-left'));
	const toggleBody = () => {
		if (isLive || alwaysShow) {
			return;
		}
		const next = knoxGuiToolToggle(showBody);
		widget.toolBodyCollapsed[next.collapsed ? 'add' : 'delete'](tool.id);
		widget.toolBodyExpanded[next.expanded ? 'add' : 'delete'](tool.id);
		widget.render();
	};
	head.classList.toggle('is-toggleable', !alwaysShow && !isLive);
	if (!alwaysShow && !isLive) {
		widget.renderStore.add(DOM.addDisposableListener(head, 'click', toggleBody));
	}
	// K-041: keyboard access. Enter/Space toggles the body, Up/Down moves between tool cards.
	head.tabIndex = 0;
	head.setAttribute('role', 'button');
	head.setAttribute('aria-expanded', String(showBody));
	head.setAttribute('data-testid', 'tool-head');
	widget.renderStore.add(DOM.addDisposableListener(head, 'keydown', (e: KeyboardEvent) => {
		if (e.target !== head) {
			return;
		}
		if ((e.key === 'Enter' || e.key === ' ') && !alwaysShow && !isLive) {
			e.preventDefault();
			const next = knoxGuiToolToggle(showBody);
			widget.toolBodyCollapsed[next.collapsed ? 'add' : 'delete'](tool.id);
			widget.toolBodyExpanded[next.expanded ? 'add' : 'delete'](tool.id);
			widget.render();
			const id = tool.id;
			requestAnimationFrame(() => {
				(Array.from(widget.root.querySelectorAll('[data-testid="knox-gui-tool"]')).find(el => el.getAttribute('data-tool-id') === id)?.querySelector('.knox-gui-tool-head') as HTMLElement | null)?.focus();
			});
		} else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			const heads = Array.from(widget.root.querySelectorAll('.knox-gui-tool-head[data-testid="tool-head"]')) as HTMLElement[];
			const target = heads[heads.indexOf(head) + (e.key === 'ArrowDown' ? 1 : -1)];
			if (target) {
				e.preventDefault();
				target.focus();
			}
		}
	}));
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
	let templateText = '';
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
		const copy = DOM.append(status, DOM.$('span.knox-gui-tool-status-copy'));
		// Finished / running steps read as a plain action ("Read index.html"); only permission and
		// failure states keep the "Knox ..." subject.
		const plainAction = tool.status === 'done' || tool.status === 'calling';
		if (!plainAction) {
			copy.append(`${t(state, 'knox')} `);
		}
		if (introKey && tool.status !== 'calling') {
			copy.append(`${t(state, introKey)} `);
		}
		if (message) {
			if (tool.status === 'done') {
				message = message.replace(/^has\s+/i, '');
				message = message.charAt(0).toUpperCase() + message.slice(1);
			}
			const templateEl = DOM.append(copy, DOM.$('span.knox-gui-tool-template'));
			safeSetInnerHtml(templateEl, message);
			templateText = templateEl.textContent ?? '';
		} else {
			copy.append(`${t(state, fallbackKey)} `);
			const code = DOM.append(copy, DOM.$('code', undefined, formatted));
			code.classList.add('knox-gui-tool-name');
			copy.append(` ${t(state, 'tool')}`);
		}
	}
	const right = DOM.append(head, DOM.$('.knox-gui-tool-head-right'));
	if (!showBody) {
		const summary = finishedToolSummary(tool, catalog?.displayTitle);
		// Don't repeat what the title already says (e.g. the file name).
		if (summary.detail && templateText.includes(summary.detail)) {
			summary.detail = undefined;
		}
		const text = finishedToolSummaryText(summary);
		if (text) {
			const el = DOM.append(right, DOM.$('span.knox-gui-tool-summary', undefined, text));
			el.setAttribute('data-testid', 'tool-call-summary');
		}
	}
	if (showParams) {
		const toggle = DOM.append(right, DOM.$('button.knox-gui-tool-args-toggle')) as HTMLButtonElement;
		toggle.type = 'button';
		toggle.setAttribute('aria-expanded', String(argsOpen));
		toggle.setAttribute('aria-label', argsOpen ? t(state, 'hideParameters') : t(state, 'showParameters'));
		widget.hover(toggle, argsOpen ? t(state, 'hideParameters') : t(state, 'showParameters'));
		appendKnoxGuiSvg(toggle, 'list-chevrons-up-down', 14);
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
	if (!alwaysShow) {
		widget.collapseChevron(right, {
			expanded: showBody,
			title: showBody ? t(state, 'collapse') : t(state, 'expand'),
			disabled: isLive,
			onClick: toggleBody,
		});
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
	if (showBody && body) {
		DOM.append(box, body);
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
	if (kind === 'tool-search') {
		renderToolSearch(parent, state, tool);
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
		// Status on the left, a compact Cancel on the right. Cancel stops the running tool and the
		// current generation (same as the composer Stop button).
		const row = DOM.append(parent, DOM.$('.knox-gui-tool-calling'));
		const loading = DOM.append(row, DOM.$('span.knox-gui-muted.knox-gui-tool-loading'));
		widget.appendSpinner(loading, 14);
		DOM.append(loading, DOM.$('span', undefined, t(state, 'loading')));
		widget.chromeButton(row, {
			label: t(state, 'cancel'),
			title: t(state, 'cancelToolCall'),
			extraClass: 'knox-gui-tool-deny knox-gui-tool-cancel',
			testId: 'tool-calling-cancel',
			onClick: () => widget.controller.cancel(),
		});
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
	const catalog = catalogToolForCall(state.tools, tool.name);
	const permissionLabel = catalog ? getCategorizedToolName(tool.name, catalog.displayTitle) : formatToolName(tool.name);
	if (placement !== 'overlay') {
		const hint = DOM.append(parent, DOM.$('.knox-gui-tool-permission-hint', undefined, t(state, 'permissionForTool', { name: permissionLabel })));
		hint.setAttribute('data-testid', 'permission-for-tool');
	}
	const actions = DOM.append(parent, DOM.$('.knox-gui-tool-permissions'));
	actions.setAttribute('data-testid', 'permission-action-buttons');
	actions.setAttribute('data-tool-name', tool.name);
	actions.setAttribute('role', 'group');
	actions.setAttribute('aria-label', t(state, 'permissionForTool', { name: permissionLabel }));
	if (placement === 'overlay') {
		actions.classList.add('knox-gui-tool-permissions-compact');
	}
	const alwaysActive = permission === 'sessionAlways';
	widget.chromeButton(actions, {
		label: t(state, 'deny'),
		title: t(state, 'deny'),
		extraClass: 'knox-gui-tool-deny',
		testId: 'deny-tool-call-button',
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
