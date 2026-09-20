/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { forAnsiStringParts } from '../../../../../base/common/strings.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass } from '../knoxGuiIcons.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IKnoxContextItem, IKnoxToolCallState } from '../../common/knoxChatTypes.js';
import { IKnoxGuiBridge } from '../../common/knoxGuiProtocol.js';
import { knoxNls } from '../../common/knoxI18n.js';
import {
	extractLogPathFromTerminalOutput,
	knoxExtractTerminalOutput,
	knoxTerminalIsAtBottom,
	knoxTerminalShouldFollow,
	takeTerminalTail,
} from '../../common/knoxTerminalOutput.js';
import {
	knoxTerminalCommandIsRunnable,
	knoxTerminalCommandLabel,
	knoxToolIsStreaming,
} from '../../common/knoxToolCard.js';
import { knoxShowFile } from '../markdown/knoxClickablePath.js';
import { IKnoxToolUiState } from './knoxToolCard.js';
import { ITerminalService } from '../../../terminal/browser/terminal.js';

const colorAttrRe = /^\x1b\[([0-9;]+)m$/;

export function renderKnoxTerminalCard(
	parent: HTMLElement,
	state: IKnoxToolCallState,
	outputItems: readonly IKnoxContextItem[],
	services: {
		bridge: IKnoxGuiBridge;
		clipboard: IClipboardService;
		hover: IHoverService;
		terminal: ITerminalService;
		workspace: IWorkspaceContextService;
		codeWrap: boolean;
	},
	store: DisposableStore,
	ui?: IKnoxToolUiState,
	toolId?: string,
): void {
	const command = knoxTerminalCommandLabel(state.toolCall.function.name, state.parsedArgs);
	const output = knoxExtractTerminalOutput(outputItems) || knoxExtractTerminalOutput(state.output);
	const { tail, truncated, hiddenLines } = takeTerminalTail(output);
	const logPath = extractLogPathFromTerminalOutput(output);
	const streaming = knoxToolIsStreaming(state.status);
	const canceled = state.status === 'canceled';
	const done = state.status === 'done';

	const root = append(parent, $('.knox-term'));
	if (streaming) {
		root.classList.add('knox-term-running');
	}

	const header = append(root, $('.knox-term-header'));
	const left = append(header, $('.knox-term-header-left'));
	append(left, $('span')).className = knoxGuiIconClass('terminal');
	const title = append(left, $('span.knox-term-title'));
	title.textContent = localize('knox.terminal', "Terminal");
	if (truncated && hiddenLines > 0) {
		const hidden = append(left, $('span.knox-term-truncated'));
		hidden.setAttribute('data-testid', 'xterm-truncated');
		hidden.textContent = knoxNls('truncatedTerminalOutput', { lines: hiddenLines }, '{{lines}} earlier lines hidden');
	}

	const right = append(header, $('.knox-term-header-right'));
	if (streaming) {
		const badge = append(right, $('span.knox-term-badge.knox-term-badge-running'));
		append(badge, $('span.knox-term-pulse'));
		append(badge, $('span')).textContent = localize('knox.running', "Running");
	} else if (done) {
		const badge = append(right, $('span.knox-term-badge.knox-term-badge-done'));
		append(badge, $('span')).className = knoxGuiIconClass('check');
		append(badge, $('span')).textContent = localize('knox.toolUsed', "Used");
	} else if (canceled) {
		const badge = append(right, $('span.knox-term-badge.knox-term-badge-canceled'));
		append(badge, $('span')).className = knoxGuiIconClass('x');
		append(badge, $('span')).textContent = localize('knox.toolCanceled', "Canceled");
	}

	if (output) {
		const copyOutput = append(right, $<HTMLButtonElement>('button.knox-icon-button'));
		copyOutput.type = 'button';
		const copyOutputHint = knoxNls('copyOutput', undefined, 'Copy output');
		copyOutput.setAttribute('aria-label', copyOutputHint);
		copyOutput.setAttribute('data-testid', 'xterm-copy-output');
		append(copyOutput, $('span')).className = knoxGuiIconClass('copy');
		store.add(services.hover.setupManagedHover(getDefaultHoverDelegate('mouse'), copyOutput, copyOutputHint));
		store.add(addDisposableListener(copyOutput, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			void services.clipboard.writeText(output);
		}));
	}
	if (logPath) {
		const openLog = append(right, $<HTMLButtonElement>('button.knox-icon-button'));
		openLog.type = 'button';
		const openLogHint = knoxNls('openFullLog', undefined, 'Open full log');
		openLog.setAttribute('aria-label', openLogHint);
		openLog.setAttribute('data-testid', 'xterm-open-full-log');
		append(openLog, $('span')).className = knoxGuiIconClass('file-text');
		store.add(services.hover.setupManagedHover(getDefaultHoverDelegate('mouse'), openLog, openLogHint));
		store.add(addDisposableListener(openLog, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			knoxShowFile(services.bridge, services.workspace, logPath);
		}));
	}

	if (command) {
		const copy = append(right, $<HTMLButtonElement>('button.knox-icon-button'));
		copy.type = 'button';
		const copyHint = knoxNls('copyCommand', undefined, 'Copy command');
		copy.setAttribute('aria-label', copyHint);
		copy.setAttribute('data-testid', 'xterm-copy-command');
		append(copy, $('span')).className = knoxGuiIconClass('copy');
		store.add(services.hover.setupManagedHover(getDefaultHoverDelegate('mouse'), copy, copyHint));
		store.add(addDisposableListener(copy, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			void services.clipboard.writeText(command);
		}));
	}

	if (knoxTerminalCommandIsRunnable(state.toolCall.function.name, command)) {
		const run = append(right, $<HTMLButtonElement>('button.knox-icon-button'));
		run.type = 'button';
		const runHint = localize('knox.runInTerminal', "Run in terminal");
		run.setAttribute('aria-label', runHint);
		append(run, $('span')).className = knoxGuiIconClass('play');
		store.add(services.hover.setupManagedHover(getDefaultHoverDelegate('mouse'), run, runHint));
		store.add(addDisposableListener(run, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			void services.bridge.post('runCommand', { command }).catch(() => { });
		}));
	}

	const open = append(right, $<HTMLButtonElement>('button.knox-icon-button'));
	open.type = 'button';
	const openHint = localize('knox.openTerminal', "Open in Terminal");
	open.setAttribute('aria-label', openHint);
	append(open, $('span')).className = knoxGuiIconClass('terminal');
	store.add(services.hover.setupManagedHover(getDefaultHoverDelegate('mouse'), open, openHint));
	store.add(addDisposableListener(open, 'click', e => {
		e.preventDefault();
		e.stopPropagation();
		void openKnoxToolOutputInTerminal(services.terminal, command, output);
	}));

	const body = append(root, $('pre.knox-term-body'));
	body.classList.toggle('knox-code-wrap', services.codeWrap);
	if (command) {
		const prompt = append(body, $('div.knox-term-prompt'));
		append(prompt, $('span.knox-term-prompt-mark')).textContent = '❯';
		append(prompt, $('span.knox-term-command')).textContent = command;
	}
	if (tail) {
		renderAnsi(append(body, $('div.knox-term-output')), tail);
	} else if (streaming) {
		append(body, $('div.knox-term-output.knox-term-waiting')).textContent = localize('knox.running', "Running");
	}

	if (ui && toolId) {
		followTerminalOutput(body, streaming, ui, toolId, store);
	}
}

function followTerminalOutput(
	body: HTMLElement,
	streaming: boolean,
	ui: IKnoxToolUiState,
	toolId: string,
	store: DisposableStore,
): void {
	const restore = (): void => {
		if (knoxTerminalShouldFollow(ui.terminalUnstuck.has(toolId), streaming)) {
			body.scrollTop = body.scrollHeight;
			ui.terminalScrollTop.set(toolId, body.scrollTop);
			return;
		}
		const top = ui.terminalScrollTop.get(toolId);
		if (typeof top === 'number') {
			body.scrollTop = top;
		}
	};
	restore();
	queueMicrotask(restore);
	store.add(addDisposableListener(body, 'scroll', () => {
		ui.terminalScrollTop.set(toolId, body.scrollTop);
		if (knoxTerminalIsAtBottom(body.scrollTop, body.scrollHeight, body.clientHeight)) {
			ui.terminalUnstuck.delete(toolId);
		} else {
			ui.terminalUnstuck.add(toolId);
		}
	}));
}

async function openKnoxToolOutputInTerminal(
	terminalService: ITerminalService,
	command: string,
	output: string,
): Promise<void> {
	const name = command ? command.slice(0, 48) : localize('knox.terminal', "Terminal");
	const instance = await terminalService.createTerminal({
		config: { name: `Knox: ${name}` },
	});
	await terminalService.revealTerminal(instance);
	const text = [command ? `$ ${command}` : '', output].filter(Boolean).join('\r\n');
	if (text) {
		const xterm = await instance.xtermReadyPromise;
		xterm?.write(`${text.replace(/\n/g, '\r\n')}\r\n`);
	}
}

function renderAnsi(parent: HTMLElement, text: string): void {
	let cls: string[] = [];
	for (const part of forAnsiStringParts(text)) {
		if (part.isCode) {
			const codes = colorAttrRe.exec(part.str)?.[1];
			if (!codes) {
				continue;
			}
			for (const raw of codes.split(';')) {
				const n = Number(raw);
				if (n === 0) {
					cls = [];
				} else if (n === 1) {
					cls = cls.filter(c => c !== 'knox-ansi-bold').concat('knox-ansi-bold');
				} else if (n === 2) {
					cls = cls.filter(c => c !== 'knox-ansi-dim').concat('knox-ansi-dim');
				} else if ((n >= 30 && n <= 37) || (n >= 90 && n <= 97)) {
					cls = cls.filter(c => !c.startsWith('knox-ansi-fg')).concat(`knox-ansi-fg${n}`);
				}
			}
			continue;
		}
		if (!part.str) {
			continue;
		}
		const span = append(parent, $('span'));
		if (cls.length) {
			span.className = cls.join(' ');
		}
		span.textContent = part.str;
	}
}
