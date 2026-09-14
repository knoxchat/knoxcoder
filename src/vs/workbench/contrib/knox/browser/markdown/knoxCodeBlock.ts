/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, isHTMLElement } from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { disposableTimeout } from '../../../../../base/common/async.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../../base/common/platform.js';
import { escape } from '../../../../../base/common/strings.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { PLAINTEXT_LANGUAGE_ID } from '../../../../../editor/common/languages/modesRegistry.js';
import { tokenizeToString } from '../../../../../editor/common/languages/textToHtmlTokenizer.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import {
	knoxApplyActionKind,
	KnoxApplyActionKind,
} from '../../common/knoxApply.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { IKnoxGuiBridge } from '../../common/knoxGuiProtocol.js';
import {
	getTerminalCommand,
	IKnoxMarkdownCodeBlock,
	initialCodeBlockExpanded,
	isTerminalCodeBlock,
	knoxHasFileExtension,
	shouldAutoExpandGeneratingCodeBlock,
} from '../../common/knoxMarkdown.js';
import { knoxSetTokenizedHtml } from '../knoxTrustedTypes.js';
import { appendKnoxGuiIcon, KnoxGuiIconName, knoxGuiIconClass, setKnoxGuiIcon } from '../knoxGuiIcons.js';
import { renderKnoxClickableFilePath } from './knoxClickablePath.js';

function metaKeyLabel(): string {
	return isMacintosh ? '⌘' : 'Ctrl';
}

export interface IKnoxCodeBlockRenderOptions {
	inStepContainer: boolean;
	isStreaming: boolean;
	historyIndex: number;
	codeWrap: boolean;
	expanded: Map<string, boolean>;
	onDidChangeHeight: () => void;
}

export interface IKnoxCodeBlockServices {
	language: ILanguageService;
	clipboard: IClipboardService;
	hover: IHoverService;
	chat: IKnoxChatService;
	bridge: IKnoxGuiBridge;
	workspace: IWorkspaceContextService;
}

function expandKey(historyIndex: number, codeBlockIndex: number): string {
	return `${historyIndex}:${codeBlockIndex}`;
}

function knoxLanguageId(languageService: ILanguageService, alias: string, filepath?: string): string {
	if (alias) {
		const id = languageService.getLanguageIdByLanguageName(alias)
			?? languageService.getLanguageIdByLanguageName(alias.toLowerCase());
		if (id) {
			return id;
		}
	}
	if (filepath) {
		const resource = URI.file(filepath);
		const guessed = languageService.guessLanguageIdByFilepathOrFirstLine(resource);
		if (guessed) {
			return guessed;
		}
	}
	return PLAINTEXT_LANGUAGE_ID;
}

async function renderTokenizedCode(
	pre: HTMLElement,
	code: string,
	language: string,
	filepath: string | undefined,
	languageService: ILanguageService,
	generating: boolean,
): Promise<void> {
	const languageId = knoxLanguageId(languageService, language, filepath);
	let html: string;
	try {
		html = await tokenizeToString(languageService, code, languageId);
	} catch {
		html = `<div class="monaco-tokenized-source">${escape(code)}</div>`;
	}
	knoxSetTokenizedHtml(pre, html);
	const codeElement = pre.querySelector('.monaco-tokenized-source');
	if (isHTMLElement(codeElement) && generating) {
		codeElement.classList.add('generating');
	}
}

function toolbarButton(
	parent: HTMLElement,
	icon: KnoxGuiIconName,
	label: string,
	hover: IHoverService,
	store: DisposableStore,
	onClick: () => void,
): HTMLButtonElement {
	const button = append(parent, $<HTMLButtonElement>('button.knox-code-action'));
	button.type = 'button';
	button.setAttribute('aria-label', label);
	appendKnoxGuiIcon(button, icon);
	append(button, $('span.knox-code-action-label')).textContent = label;
	store.add(hover.setupManagedHover(getDefaultHoverDelegate('mouse'), button, label));
	store.add(addDisposableListener(button, 'click', e => {
		e.preventDefault();
		e.stopPropagation();
		onClick();
	}));
	return button;
}

export function renderKnoxCodeBlock(
	parent: HTMLElement,
	block: IKnoxMarkdownCodeBlock,
	options: IKnoxCodeBlockRenderOptions,
	services: IKnoxCodeBlockServices,
	store: DisposableStore,
): void {
	const isGenerating = options.isStreaming && block.isLast;
	const key = expandKey(options.historyIndex, block.index);
	let expanded = options.expanded.has(key)
		? options.expanded.get(key) === true
		: initialCodeBlockExpanded(block.code);
	if (shouldAutoExpandGeneratingCodeBlock(isGenerating, block.code, options.expanded.get(key))) {
		expanded = true;
		options.expanded.set(key, true);
	}

	const root = append(parent, $('.knox-code-block'));
	if (isGenerating) {
		root.classList.add('generating');
	}

	const wrap = options.codeWrap;
	const streamId = services.chat.codeBlockStreamId(options.historyIndex, block.index);
	const applyState = services.chat.applyStateByStreamId(streamId);
	const hasFileToolbar = options.inStepContainer && knoxHasFileExtension(block.relativeFilePath);
	const terminal = isTerminalCodeBlock(block.language, block.code);

	const apply = () => {
		void services.chat.applyToFile({
			streamId,
			text: block.code,
			filepath: hasFileToolbar ? block.relativeFilePath : undefined,
		});
	};

	if (options.inStepContainer && !isGenerating) {
		store.add(services.chat.onDidRequestApplyFromChat(() => {
			if (services.chat.applyCurIndex === block.index) {
				apply();
			}
		}));
	}

	let body: HTMLElement;
	if (hasFileToolbar) {
		const toolbar = append(root, $('.knox-code-toolbar'));
		const left = append(toolbar, $('.knox-code-toolbar-left'));
		const chevron = append(left, $<HTMLButtonElement>('button.knox-code-expand'));
		chevron.type = 'button';
		chevron.setAttribute('aria-label', localize('knox.expandCodeBlock', "Expand code block"));
		const chevronIcon = append(chevron, $('span'));
		chevronIcon.className = knoxGuiIconClass(expanded ? 'lucide-chevron-down' : 'lucide-chevron-right');
		renderKnoxClickableFilePath(
			left,
			block.relativeFilePath,
			{ range: block.range, showIcon: true },
			services.bridge,
			services.workspace,
			store,
		);

		const right = append(toolbar, $('.knox-code-toolbar-right'));
		if (isGenerating) {
			const loader = append(right, $('span.knox-code-generating'));
			const lines = Math.max(0, block.code.split('\n').length - (block.code.endsWith('\n') ? 1 : 0));
			loader.textContent = lines <= 1
				? localize('knox.generatedLine', "1 generated line")
				: localize('knox.generatedLines', "{0} generated lines", lines);
		} else {
			renderCopyButton(right, block.code, services.clipboard, services.hover, store);
			if (terminal) {
				toolbarButton(right, 'terminal', localize('knox.run', "Run"), services.hover, store, () => {
					void services.bridge.post('runCommand', { command: getTerminalCommand(block.code) }).catch(() => { });
				});
			} else {
				renderApplyActions(
					right,
					{
						streamId,
						filepath: block.relativeFilePath,
						kind: knoxApplyActionKind(
							applyState,
							services.chat.wasApplyRejected(streamId),
							false,
						),
						numDiffs: applyState?.numDiffs ?? 0,
						onApply: apply,
						onAccept: () => void services.chat.acceptDiff(streamId, block.relativeFilePath),
						onReject: () => void services.chat.rejectDiff(streamId, block.relativeFilePath),
					},
					services.hover,
					store,
				);
			}
		}

		body = append(root, $('.knox-code-body'));
		if (!expanded) {
			body.classList.add('hidden');
		}

		store.add(addDisposableListener(chevron, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			expanded = !expanded;
			options.expanded.set(key, expanded);
			body.classList.toggle('hidden', !expanded);
			chevronIcon.className = knoxGuiIconClass(expanded ? 'lucide-chevron-down' : 'lucide-chevron-right');
			options.onDidChangeHeight();
		}));
	} else {
		body = append(root, $('.knox-code-body'));
		if (options.inStepContainer && !isGenerating) {
			root.classList.add('knox-code-hoverable');
			const hoverBar = append(root, $('.knox-code-hover'));
			if (terminal) {
				toolbarButton(hoverBar, 'terminal', localize('knox.runInTerminal', "Run in terminal"), services.hover, store, () => {
					void services.bridge.post('runCommand', { command: getTerminalCommand(block.code) }).catch(() => { });
				});
			}
			toolbarButton(hoverBar, 'apply', localize('knox.apply', "Apply"), services.hover, store, apply);
			toolbarButton(hoverBar, 'insert', localize('knox.insert', "Insert"), services.hover, store, () => {
				void services.bridge.post('insertAtCursor', { text: block.code }).catch(() => { });
			});
			renderCopyButton(hoverBar, block.code, services.clipboard, services.hover, store);
		}
	}

	const pre = append(body, $('pre.knox-code-pre'));
	pre.classList.toggle('knox-code-wrap', wrap);
	if (isGenerating) {
		pre.setAttribute('data-generating', 'true');
	}
	pre.textContent = block.code;
	void renderTokenizedCode(
		pre,
		block.code,
		block.language,
		block.relativeFilePath || undefined,
		services.language,
		isGenerating,
	).then(() => options.onDidChangeHeight());
}

function renderCopyButton(
	parent: HTMLElement,
	text: string,
	clipboard: IClipboardService,
	hover: IHoverService,
	store: DisposableStore,
): void {
	const button = toolbarButton(parent, 'copy', localize('knox.copyText', "Copy"), hover, store, () => {
		void clipboard.writeText(text).then(() => {
			label.textContent = localize('knox.copied', "Copied");
			setKnoxGuiIcon(icon, 'copied');
			store.add(disposableTimeout(() => {
				label.textContent = localize('knox.copyText', "Copy");
				setKnoxGuiIcon(icon, 'copy');
			}, 2000));
		});
	});
	const icon = button.querySelector('span')!;
	const label = button.querySelector('.knox-code-action-label') as HTMLElement;
}

function renderApplyActions(
	parent: HTMLElement,
	options: {
		streamId: string;
		filepath: string;
		kind: KnoxApplyActionKind;
		numDiffs: number;
		onApply: () => void;
		onAccept: () => void;
		onReject: () => void;
	},
	hover: IHoverService,
	store: DisposableStore,
): void {
	const meta = metaKeyLabel();
	switch (options.kind) {
		case 'streaming': {
			const status = append(parent, $('span.knox-apply-status'));
			status.textContent = localize('knox.applyingChanges', "Applying...");
			return;
		}
		case 'done': {
			const status = append(parent, $('span.knox-apply-status'));
			status.textContent = localize('knox.diffsRemaining', "{0} remaining", options.numDiffs);
			toolbarButton(parent, 'x-mark', localize('knox.rejectAll', "Reject ({0}⇧⌫)", meta), hover, store, options.onReject);
			toolbarButton(parent, 'check', localize('knox.acceptAll', "Accept ({0}⇧⏎)", meta), hover, store, options.onAccept);
			return;
		}
		case 'applied': {
			const status = append(parent, $('span.knox-apply-status'));
			status.textContent = localize('knox.applied', "Applied");
			appendKnoxGuiIcon(status, 'check');
			return;
		}
		case 'reapply':
			toolbarButton(parent, 'apply', localize('knox.reApply', "Re-apply"), hover, store, options.onApply);
			return;
		default:
			toolbarButton(parent, 'apply', localize('knox.apply', "Apply"), hover, store, options.onApply);
	}
}
