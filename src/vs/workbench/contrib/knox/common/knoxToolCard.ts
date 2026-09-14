/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IKnoxChatHistoryItem, IKnoxContextItem, IKnoxTool, IKnoxToolCallState, KnoxToolStatus } from './knoxChatTypes.js';
import { knoxDisplayBuildCommand } from './knoxDisplayBuildCommand.js';
import { knoxAsArgsRecord, knoxCalculateFence, knoxDisplayArgsForToolCall } from './knoxStreamingToolCode.js';
import { knoxFormatToolName } from './knoxToolPermissions.js';
import { KnoxBuiltInToolName, resolveBuiltInToolName } from './knoxToolNames.js';

export type KnoxToolCardKind =
	| 'createFile'
	| 'terminal'
	| 'viewSubdirectory'
	| 'viewRepoMap'
	| 'askUser'
	| 'task'
	| 'exactSearch'
	| 'generic';

export interface IKnoxToolStatusMessage {
	intro: string;
	message: string;
	text: string;
}

const TERMINAL_TOOLS = new Set<string>([
	KnoxBuiltInToolName.RunTerminalCommand,
	KnoxBuiltInToolName.Build,
	KnoxBuiltInToolName.AwaitShell,
	KnoxBuiltInToolName.PtyStart,
	KnoxBuiltInToolName.PtySend,
	KnoxBuiltInToolName.PtyRead,
	KnoxBuiltInToolName.Qemu,
	KnoxBuiltInToolName.Debug,
]);

export function knoxToolCardKind(name: string | undefined): KnoxToolCardKind {
	const resolved = resolveBuiltInToolName(name);
	if (resolved === KnoxBuiltInToolName.CreateNewFile) {
		return 'createFile';
	}
	if (TERMINAL_TOOLS.has(resolved)) {
		return 'terminal';
	}
	if (resolved === KnoxBuiltInToolName.ViewSubdirectory) {
		return 'viewSubdirectory';
	}
	if (resolved === KnoxBuiltInToolName.ViewRepoMap) {
		return 'viewRepoMap';
	}
	if (resolved === KnoxBuiltInToolName.AskUser) {
		return 'askUser';
	}
	if (resolved === KnoxBuiltInToolName.Task) {
		return 'task';
	}
	if (resolved === KnoxBuiltInToolName.ExactSearch) {
		return 'exactSearch';
	}
	return 'generic';
}

export function knoxFindTool(tools: readonly IKnoxTool[] | undefined, name: string | undefined): IKnoxTool | undefined {
	if (!name || !tools?.length) {
		return undefined;
	}
	const resolved = resolveBuiltInToolName(name);
	return tools.find(tool =>
		tool.function.name === name
		|| tool.function.name === resolved
		|| resolveBuiltInToolName(tool.function.name) === resolved,
	);
}

export function knoxMustacheRender(template: string, args: Record<string, unknown>): string {
	return template.replace(/\{\{\{([^}]+)\}\}\}|\{\{([^}]+)\}\}/g, (match, unescaped, escaped) => {
		const key = String(unescaped ?? escaped).trim();
		const value = lookupArg(args, key);
		if (value === undefined || value === null) {
			return '';
		}
		const text = typeof value === 'string' ? value : JSON.stringify(value);
		return unescaped ? text : escapeHtml(text);
	});
}

function lookupArg(args: Record<string, unknown>, key: string): unknown {
	if (Object.prototype.hasOwnProperty.call(args, key)) {
		return args[key];
	}
	if (!key.includes('.')) {
		return undefined;
	}
	let current: unknown = args;
	for (const part of key.split('.')) {
		if (!current || typeof current !== 'object') {
			return undefined;
		}
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

function escapeHtml(value: string): string {
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

function stripHtml(value: string): string {
	return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function defaultToolDescription(tool: IKnoxTool): string {
	const title = tool.displayTitle || knoxFormatToolName(tool);
	return `<code>${escapeHtml(title)}</code> ${localize('knox.tool', "Tool")}`;
}

export function knoxToolStatusMessage(
	state: IKnoxToolCallState,
	tool: IKnoxTool | undefined,
): IKnoxToolStatusMessage {
	if (!tool) {
		const text = localize('knox.agentToolUsage', "Agent Tool Usage");
		return { intro: '', message: text, text };
	}

	const displayArgs = knoxDisplayArgsForToolCall(state.parsedArgs, state.toolCall.function.arguments);
	const renderedWouldLikeTo = tool.wouldLikeTo
		? knoxMustacheRender(tool.wouldLikeTo, displayArgs).trim()
		: '';
	const futureMessage = renderedWouldLikeTo || `${localize('knox.toolUse', "Use")} ${defaultToolDescription(tool)}`;

	let intro = '';
	let message = '';

	switch (state.status) {
		case 'generating':
			intro = localize('knox.toolGenerating', "Generating code");
			message = futureMessage;
			break;
		case 'generated':
			intro = localize('knox.toolWouldLikeTo', "Would like to");
			message = futureMessage;
			break;
		case 'calling':
			intro = localize('knox.toolFor', "For");
			message = tool.isCurrently
				? knoxMustacheRender(tool.isCurrently, displayArgs)
				: `${localize('knox.toolUsing', "Using")} ${defaultToolDescription(tool)}`;
			break;
		case 'done':
			intro = '';
			message = tool.hasAlready
				? knoxMustacheRender(tool.hasAlready, displayArgs)
				: `${localize('knox.toolUsed', "Used")} ${defaultToolDescription(tool)}`;
			break;
		case 'canceled':
			intro = localize('knox.toolCanceled', "Canceled");
			message = futureMessage;
			break;
	}

	const knox = localize('knox', "Knox");
	const text = [knox, intro, stripHtml(message)].filter(Boolean).join(' ');
	return { intro, message, text };
}

export function knoxToolArgEntries(state: IKnoxToolCallState): Array<[string, string]> {
	const args = knoxDisplayArgsForToolCall(state.parsedArgs, state.toolCall.function.arguments);
	return Object.entries(args).map(([key, value]) => [
		key,
		typeof value === 'string' ? value : JSON.stringify(value),
	]);
}

export function knoxShouldShowToolParameters(state: IKnoxToolCallState): boolean {
	const kind = knoxToolCardKind(state.toolCall.function.name);
	if (kind === 'askUser') {
		return false;
	}
	if (kind === 'createFile' && state.status === 'done') {
		return false;
	}
	return knoxToolArgEntries(state).length > 0;
}

export function knoxToolOutputItems(
	history: readonly IKnoxChatHistoryItem[],
	historyIndex: number,
	state: IKnoxToolCallState,
): IKnoxContextItem[] {
	const id = state.toolCallId || state.toolCall.id;
	const match = history.find((item, index) =>
		index > historyIndex
		&& item.message.role === 'tool'
		&& item.message.toolCallId === id,
	);
	if (match?.contextItems?.length) {
		return match.contextItems;
	}
	return state.output ?? [];
}

function stringArg(args: Record<string, unknown> | undefined, key: string): string {
	const value = args?.[key];
	return typeof value === 'string' ? value : '';
}

export function knoxTerminalCommandLabel(name: string | undefined, parsedArgs: unknown): string {
	const args = knoxAsArgsRecord(parsedArgs);
	const resolved = resolveBuiltInToolName(name);
	const jobId = stringArg(args, 'job_id');
	switch (resolved) {
		case KnoxBuiltInToolName.Build:
			return knoxDisplayBuildCommand(args);
		case KnoxBuiltInToolName.AwaitShell:
			if (jobId) {
				return args?.kill
					? localize('knox.jobsKillCommand', "kill {0}", jobId)
					: localize('knox.jobsAwaitCommand', "await {0}", jobId);
			}
			return localize('knox.jobsListCommand', "list shell jobs");
		case KnoxBuiltInToolName.PtySend:
			return jobId ? `pty send ${jobId}` : 'pty send';
		case KnoxBuiltInToolName.PtyRead:
			if (jobId) {
				return args?.kill
					? localize('knox.jobsKillCommand', "kill {0}", jobId)
					: `pty read ${jobId}`;
			}
			return 'pty read';
		case KnoxBuiltInToolName.Qemu: {
			const action = stringArg(args, 'action');
			if (action === 'start') {
				return stringArg(args, 'command') || `qemu ${stringArg(args, 'kernel') || stringArg(args, 'arch') || 'session'}`;
			}
			return jobId
				? `qemu ${action || 'status'} ${jobId}`
				: `qemu ${action || 'session'}`;
		}
		case KnoxBuiltInToolName.Debug:
			return `debug ${stringArg(args, 'op') || 'session'}`;
		default:
			return stringArg(args, 'command');
	}
}

export function knoxTerminalCommandIsRunnable(name: string | undefined, command: string): boolean {
	if (!command.trim()) {
		return false;
	}
	const resolved = resolveBuiltInToolName(name);
	return resolved === KnoxBuiltInToolName.RunTerminalCommand
		|| resolved === KnoxBuiltInToolName.PtyStart
		|| resolved === KnoxBuiltInToolName.Build;
}

export function knoxToolIsStreaming(status: KnoxToolStatus): boolean {
	return status === 'generating' || status === 'calling';
}

export function knoxCreateFileMarkdown(filepath: string, contents: string): { language: string; source: string } {
	const language = createFileLanguage(filepath);
	const fence = knoxCalculateFence(contents);
	return {
		language,
		source: `${fence}${language} ${filepath}\n${contents}\n${fence}`,
	};
}

function createFileLanguage(filepath: string): string {
	if (!filepath) {
		return '';
	}
	const ext = filepath.split('.').pop()?.toLowerCase() ?? '';
	if (ext === 'md' || ext === 'markdown' || ext === 'mdx') {
		return 'text';
	}
	return ext;
}

export function knoxToolSearchText(
	state: IKnoxToolCallState,
	tool: IKnoxTool | undefined,
	output: readonly IKnoxContextItem[] | undefined,
): string {
	const status = knoxToolStatusMessage(state, tool);
	const args = knoxToolArgEntries(state).map(([key, value]) => `${key} ${value}`).join(' ');
	const body = (output ?? []).map(item => item.content).join('\n');
	return [status.text, args, body].filter(Boolean).join('\n');
}
