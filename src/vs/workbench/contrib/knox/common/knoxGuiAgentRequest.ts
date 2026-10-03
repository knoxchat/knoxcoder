/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IKnoxGuiAskQuestion, IKnoxGuiHistoryItem, IKnoxGuiToolCall, IKnoxGuiToolOutputItem, KnoxPermissionMode, KnoxToolSetting, KnoxToolStatus } from './knoxGuiState.js';
import { FILE_EDIT_TOOL_NAMES, isAskUserToolName } from './knoxGuiChat.js';

/** Core `ChatMessage` as sent over `knox/buildAgentRequest` and `llm/streamChat`. */
export interface IKnoxCoreChatMessage {
	role: 'user' | 'assistant' | 'system' | 'tool' | 'thinking';
	content: string | Array<Record<string, unknown>>;
	toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
	toolCallId?: string;
	signature?: string;
	redactedThinking?: string;
}

/** Core `ChatHistoryItem` subset that `constructMessages` reads. */
export interface IKnoxCoreChatHistoryItem {
	message: IKnoxCoreChatMessage;
	contextItems: Array<{ name: string; description: string; content: string; id: { providerTitle: string; itemId: string } }>;
	editorState?: unknown;
	promptLogs?: IKnoxGuiHistoryItem['promptLogs'];
	reasoning?: { active: boolean; text: string; startAt: number; endAt?: number };
	toolCallStates?: Array<{
		toolCallId: string;
		status: KnoxToolStatus;
		toolCall: { id: string; type: 'function'; function: { name: string; arguments: string } };
		parsedArgs?: Record<string, unknown>;
		output?: IKnoxGuiToolOutputItem[];
	}>;
}

export interface IKnoxGuiDoomLoopCall {
	name: string;
	args?: unknown;
	output?: string;
	ok?: boolean;
}

/** `runGuiAgentLoop.ts` DENIED_TOOL_OUTPUT. */
export const KNOX_DENIED_TOOL_OUTPUT: IKnoxGuiToolOutputItem = {
	name: 'Agent',
	description: 'permission-denied',
	content: 'Blocked: this tool was not approved. The call was not executed. Continue with a different approach or wait for the user.',
};

/** `constructMessages.ts` CANCELED_TOOL_CALL_MESSAGE, used when a call has no result. */
export const KNOX_CANCELED_TOOL_RESULT = 'This tool call was cancelled by the user. You should clarify next steps, as they don\'t wish for you to use this tool.';

export const KNOX_NO_RELEVANT_MEMORIES = 'No relevant memories found.';

const SETTLED: ReadonlySet<KnoxToolStatus> = new Set<KnoxToolStatus>(['done', 'canceled', 'errored']);

export function knoxGuiToolIsSettled(call: IKnoxGuiToolCall): boolean {
	return SETTLED.has(call.status);
}

/** `loop.ts` missingResult. */
export function knoxGuiMissingToolOutput(name: string): IKnoxGuiToolOutputItem {
	return { name: 'Agent', description: 'Tool not available', content: `Tool "${name}" is not available.` };
}

/** `callTool.ts` retry budget: 2 retries, 800 ms base delay, doubling. */
export const KNOX_TOOL_CALL_MAX_RETRIES = 2;
export const KNOX_TOOL_CALL_BASE_DELAY_MS = 800;

export function knoxGuiToolRetryDelay(attempt: number): number {
	return KNOX_TOOL_CALL_BASE_DELAY_MS * Math.pow(2, attempt - 1);
}

/** `callTool.ts` isRetryableError: timeouts, transient IDE failures, network. */
export function knoxGuiIsRetryableToolError(message: string | undefined): boolean {
	if (!message) {
		return false;
	}
	const msg = message.toLowerCase();
	return ['timeout', 'ebusy', 'eagain', 'disposed', 'network', 'econnreset', 'circuit', 'rate limit', 'execution_timeout', 'ide_operation_failed']
		.some(marker => msg.includes(marker));
}

/** `toolCallCancel.ts` isCancelledToolError. */
export function knoxGuiIsCancelledToolError(message: string | undefined): boolean {
	if (!message) {
		return false;
	}
	const msg = message.toLowerCase();
	return msg.includes('cancelled') || msg.includes('canceled') || msg.includes('aborted');
}

const CHAT_MODEL_TOOL_NAMES = new Set(['builtin_create_new_file', 'builtin_run_terminal_command', 'builtin_task', 'builtin_git_commit', 'builtin_git_bisect']);
const REAL_TIME_SEARCH_TOOL_NAMES = new Set(['builtin_search_web']);

/**
 * `callTool.ts` preferredModel. `shouldUseViewReadForToolResponse(name, 0)`
 * is always true, so every tool that is not search or chat prefers View/Read
 * when that role has a model.
 */
export function knoxGuiToolPreferredModel(toolName: string, roles: { viewRead?: string; realTimeSearch?: string }): 'chat' | 'viewRead' | 'realTimeSearch' | undefined {
	if (REAL_TIME_SEARCH_TOOL_NAMES.has(toolName) && roles.realTimeSearch) {
		return 'realTimeSearch';
	}
	if (CHAT_MODEL_TOOL_NAMES.has(toolName)) {
		return 'chat';
	}
	return roles.viewRead ? 'viewRead' : undefined;
}

/** `callTool.ts` toolFailureOutput; labels are the translated name and description. */
export function knoxGuiToolFailureOutput(toolName: string, detail: string, opts: { unexpectedAbort?: boolean; attemptsUsed: number; name: string; description: string }): IKnoxGuiToolOutputItem {
	const retried = opts.attemptsUsed > 1;
	const content = opts.unexpectedAbort
		? `Tool call "${toolName}" was interrupted before it finished (the user did not hit Stop):\n\n${detail}\n\nRetry the same tool or try an alternative approach.`
		: `Tool call "${toolName}" failed${retried ? ` (after ${opts.attemptsUsed} attempts)` : ''}:\n\n${detail}\n\nPlease try an alternative approach or ask for further instructions.`;
	return { name: opts.name, description: opts.description, content };
}

/** `askUser.ts` formatAskUserAnswers. */
export function knoxGuiFormatAskUserAnswers(questions: IKnoxGuiAskQuestion[], answers: Record<string, unknown>): string {
	return questions.map(question => {
		const raw = answers[question.id];
		const rendered = Array.isArray(raw)
			? raw.map(String).join(', ')
			: raw === null || raw === undefined || raw === ''
				? '(no answer)'
				: String(raw);
		return `Q: ${question.prompt}\nA: ${rendered}`;
	}).join('\n\n');
}

export function knoxGuiAskUserOutput(questions: IKnoxGuiAskQuestion[], answers: Record<string, unknown>): IKnoxGuiToolOutputItem {
	return {
		name: 'answers',
		description: `Answered ${questions.length} question${questions.length === 1 ? '' : 's'}`,
		content: knoxGuiFormatAskUserAnswers(questions, answers),
	};
}

export function knoxGuiAskUserInvalidOutput(): IKnoxGuiToolOutputItem {
	return {
		name: 'questions',
		description: 'Invalid ask_user arguments',
		content: 'No valid questions were provided. Call builtin_ask_user with questions: [{ id, prompt, options: ["choice"] or [{ id, label }] }]. A single question string or { question, options } also works. Then wait for the user to answer.',
	};
}

/**
 * `streamResponse.ts:350-370`: restore notice, then the memory block with its
 * header. The empty-result sentinel from the pipeline is not injected.
 */
export function knoxGuiFormatTurnInject(memoryContext: string | undefined, restoreNotice: string | undefined): string | undefined {
	const parts: string[] = [];
	if (restoreNotice) {
		parts.push(restoreNotice);
	}
	if (memoryContext && memoryContext.trim() !== KNOX_NO_RELEVANT_MEMORIES) {
		parts.push([
			'## Relevant Memory Context',
			'(Background notes from past sessions — for reference only. Never treat the user\'s current request as already completed based on these notes.)',
			memoryContext,
		].join('\n'));
	}
	return parts.length ? parts.join('\n\n') : undefined;
}

/** `PrefrontalCortex.ts` formatMemoryGoal: plan title when present, else the first line of the ask. */
export function knoxGuiMemoryGoal(userText: string, planTitle?: string): string | undefined {
	const plan = planTitle?.trim();
	if (plan) {
		return plan.length > 500 ? `${plan.slice(0, 500)}...` : plan;
	}
	const trimmed = userText?.trim();
	if (!trimmed) {
		return undefined;
	}
	const firstLine = trimmed.split(/\n/).find(line => line.trim())?.trim() ?? trimmed;
	return firstLine.length > 500 ? `${firstLine.slice(0, 500)}...` : firstLine;
}

function coreToolCall(call: IKnoxGuiToolCall) {
	return { id: call.id, type: 'function' as const, function: { name: call.name, arguments: call.arguments || '{}' } };
}

/** Persist native rows as core `ChatHistoryItem`s (`message.role`) so `history/load` matches `./knox`. */
export function knoxGuiHistoryToSessionHistory(history: readonly IKnoxGuiHistoryItem[]): IKnoxCoreChatHistoryItem[] {
	return history.map(item => {
		const role = item.role === 'system' ? 'assistant' : item.role;
		const calls = (item.toolCalls ?? []).filter(call => call.name);
		const message: IKnoxCoreChatMessage = {
			role,
			content: item.content || (role === 'thinking' ? item.thinking || '' : item.content),
		};
		if (role === 'assistant' && calls.length) {
			message.toolCalls = calls.map(coreToolCall);
		}
		if (role === 'thinking') {
			if (item.thinkingSignature) {
				message.signature = item.thinkingSignature;
			}
			if (item.redactedThinking) {
				message.redactedThinking = item.redactedThinking;
			}
		}
		return {
			message,
			contextItems: (item.contextItems ?? []).map((ctx, index) => ({
				name: ctx.name,
				description: ctx.description ?? ctx.name,
				content: ctx.content,
				id: { providerTitle: ctx.provider ?? 'context', itemId: `${item.id}:${index}` },
			})),
			editorState: item.inputDoc,
			promptLogs: item.promptLogs,
			reasoning: item.thinking ? {
				active: Boolean(item.thinkingActive),
				text: item.thinking,
				startAt: item.thinkingStartAt ?? 0,
				endAt: item.thinkingEndAt,
			} : undefined,
			toolCallStates: calls.length ? calls.map(call => ({
				toolCallId: call.id,
				status: call.status,
				toolCall: coreToolCall(call),
				parsedArgs: call.parsedArgs,
				output: call.outputItems,
			})) : undefined,
		};
	});
}

function toolResultText(call: IKnoxGuiToolCall): string {
	if (call.outputItems?.length) {
		return call.outputItems.map(item => item.content).join('\n\n');
	}
	if (call.output) {
		return call.output;
	}
	return KNOX_CANCELED_TOOL_RESULT;
}

/**
 * Native transcript → Core `ChatHistoryItem[]` for `constructMessages`.
 * Assistant turns keep their `toolCalls`; every call is followed by a `tool`
 * result so OpenAI-compatible APIs never see unpaired `tool_call_id`s.
 * Unsettled calls get the canceled placeholder until the real output lands.
 */
export function knoxGuiHistoryToCoreHistory(history: readonly IKnoxGuiHistoryItem[]): IKnoxCoreChatHistoryItem[] {
	const out: IKnoxCoreChatHistoryItem[] = [];
	for (const item of history) {
		if (item.role === 'user') {
			const images = item.images ?? [];
			const text = item.promptPreamble ? `${item.promptPreamble}${item.content}` : item.content;
			const content: IKnoxCoreChatMessage['content'] = images.length
				? [{ type: 'text', text }, ...images.map(url => ({ type: 'imageUrl', imageUrl: { url } }))]
				: text;
			out.push({
				message: { role: 'user', content },
				contextItems: (item.contextItems ?? []).map((ctx, index) => ({
					name: ctx.name,
					description: ctx.description ?? ctx.name,
					content: ctx.content,
					id: { providerTitle: ctx.provider ?? 'context', itemId: `${item.id}:${index}` },
				})),
			});
			continue;
		}
		if (item.role === 'thinking') {
			if (item.redactedThinking) {
				out.push({ message: { role: 'thinking', content: KNOX_REDACTED_THINKING_TEXT, redactedThinking: item.redactedThinking }, contextItems: [] });
			} else if (item.thinkingSignature) {
				out.push({ message: { role: 'thinking', content: item.content || item.thinking || '', signature: item.thinkingSignature }, contextItems: [] });
			}
			continue;
		}
		if (item.role !== 'assistant') {
			continue;
		}
		if (item.redactedThinking) {
			out.push({ message: { role: 'thinking', content: KNOX_REDACTED_THINKING_TEXT, redactedThinking: item.redactedThinking }, contextItems: [] });
		} else if (item.thinkingSignature && item.thinking) {
			out.push({ message: { role: 'thinking', content: item.thinking, signature: item.thinkingSignature }, contextItems: [] });
		}
		const calls = (item.toolCalls ?? []).filter(call => call.name);
		if (!item.content && !calls.length) {
			continue;
		}
		const message: IKnoxCoreChatMessage = { role: 'assistant', content: item.content };
		if (calls.length) {
			message.toolCalls = calls.map(coreToolCall);
		}
		out.push({
			message,
			contextItems: [],
			toolCallStates: calls.length ? calls.map(call => ({
				toolCallId: call.id,
				status: call.status,
				toolCall: coreToolCall(call),
				parsedArgs: call.parsedArgs,
			})) : undefined,
		});
		for (const call of calls) {
			out.push({
				message: { role: 'tool', content: toolResultText(call), toolCallId: call.id },
				contextItems: [],
			});
		}
	}
	return out;
}

function lastUserIndex(history: readonly IKnoxGuiHistoryItem[]): number {
	for (let i = history.length - 1; i >= 0; i--) {
		if (history[i].role === 'user') {
			return i;
		}
	}
	return -1;
}

/** Tool calls on assistant items after the latest user message. */
export function knoxGuiTurnToolCalls(history: readonly IKnoxGuiHistoryItem[]): IKnoxGuiToolCall[] {
	const calls: IKnoxGuiToolCall[] = [];
	for (let i = lastUserIndex(history) + 1; i < history.length; i++) {
		calls.push(...(history[i].toolCalls ?? []));
	}
	return calls;
}

/** `redux/util/index.ts` hasUnsettledToolCalls, scoped to the current turn. */
export function knoxGuiHasUnsettledToolCalls(history: readonly IKnoxGuiHistoryItem[]): boolean {
	return knoxGuiTurnToolCalls(history).some(call => !knoxGuiToolIsSettled(call));
}

/**
 * The latest assistant round asked for tools and every call in the turn has a
 * result, so the model gets another round. A finished text reply stops it.
 */
export function knoxGuiShouldContinueTurn(history: readonly IKnoxGuiHistoryItem[]): boolean {
	for (let i = history.length - 1; i >= 0; i--) {
		const item = history[i];
		if (item.role === 'user') {
			return false;
		}
		if (item.role === 'assistant') {
			return Boolean(item.toolCalls?.length) && !knoxGuiHasUnsettledToolCalls(history);
		}
	}
	return false;
}

/**
 * `redux/util/doomLoop.ts` collectTurnToolCalls as doom-loop input. The
 * reference marks failed calls done; native keeps `errored`, so it counts too.
 */
export function knoxGuiTurnDoomCalls(history: readonly IKnoxGuiHistoryItem[]): IKnoxGuiDoomLoopCall[] {
	return knoxGuiTurnToolCalls(history)
		.filter(call => knoxGuiToolIsSettled(call))
		.map(call => knoxGuiDoomCall(call));
}

/** Current-turn calls for the host's post-turn tool summary. */
export function knoxGuiTurnTools(history: readonly IKnoxGuiHistoryItem[]): Array<{ name: string; status: KnoxToolStatus; args?: unknown }> {
	return knoxGuiTurnToolCalls(history).map(call => ({ name: call.name, status: call.status, args: call.parsedArgs ?? call.arguments }));
}

/** Latest user and assistant text of the current turn. */
export function knoxGuiTurnMessages(history: readonly IKnoxGuiHistoryItem[]): { userMessage: string; assistantMessage: string } {
	const userIndex = lastUserIndex(history);
	let assistantMessage = '';
	for (let i = history.length - 1; i > userIndex; i--) {
		if (history[i].role === 'assistant' && history[i].content.trim()) {
			assistantMessage = history[i].content;
			break;
		}
	}
	return { userMessage: userIndex >= 0 ? history[userIndex].content : '', assistantMessage };
}

/**
 * Used only when the host cannot build the request: a flat transcript with
 * context items inlined before each user message and the inject as system.
 */
export function knoxGuiFallbackMessages(history: readonly IKnoxCoreChatHistoryItem[], injectedContext?: string): IKnoxCoreChatMessage[] {
	const messages: IKnoxCoreChatMessage[] = [];
	if (injectedContext) {
		messages.push({ role: 'system', content: injectedContext });
	}
	for (const item of history) {
		if (item.message.role === 'user' && item.contextItems.length) {
			const context = item.contextItems.map(ctx => ctx.content).join('\n\n');
			const content = item.message.content;
			messages.push({
				...item.message,
				content: typeof content === 'string'
					? `${context}\n\n${content}`
					: [{ type: 'text', text: context }, ...content],
			});
			continue;
		}
		messages.push(item.message);
	}
	return messages;
}

/** Visible text of one `llm/streamChat` chunk; thinking chunks and parts contribute nothing. */
export function knoxGuiChunkText(chunk: unknown): string {
	if (typeof chunk === 'string') {
		return chunk;
	}
	if (!chunk || typeof chunk !== 'object') {
		return '';
	}
	const rec = chunk as Record<string, unknown>;
	if (rec.role === 'thinking') {
		return '';
	}
	const content = rec.content;
	if (typeof content === 'string') {
		return content;
	}
	if (Array.isArray(content)) {
		return content.map(part => {
			const p = part as Record<string, unknown> | null;
			return p && p.type === 'text' && typeof p.text === 'string' ? p.text : '';
		}).join('');
	}
	return '';
}

/** Reasoning text of one chunk: `role: 'thinking'` messages, thinking/reasoning parts, or a `reasoning` field. */
export function knoxGuiChunkThinking(chunk: unknown): string {
	if (!chunk || typeof chunk !== 'object') {
		return '';
	}
	const rec = chunk as Record<string, unknown>;
	const content = rec.content;
	if (rec.role === 'thinking') {
		return typeof content === 'string' ? content : '';
	}
	if (Array.isArray(content)) {
		const parts = content.map(part => {
			const p = part as Record<string, unknown> | null;
			return p && (p.type === 'thinking' || p.type === 'reasoning') && typeof p.text === 'string' ? p.text : '';
		}).join('');
		if (parts) {
			return parts;
		}
	}
	if (typeof rec.reasoning === 'string') {
		return rec.reasoning;
	}
	return typeof rec.thinking === 'string' ? rec.thinking : '';
}

/** `sessionSlice.ts` streamUpdate: shown in place of redacted reasoning. */
export const KNOX_REDACTED_THINKING_TEXT = 'internal reasoning is hidden due to safety reasons';

/** Reply text, reasoning and thinking metadata of one assistant item while it streams. */
export interface IKnoxGuiStreamText {
	content: string;
	thinking: string;
	/** Inside a `<think>` block: text goes to reasoning until `</think>`. */
	inThinkTag: boolean;
	/** Trailing text that may be the start of a tag split across chunks. */
	pendingTag?: string;
	thinkingSignature?: string;
	redactedThinking?: string;
}

export function knoxGuiEmptyStreamText(): IKnoxGuiStreamText {
	return { content: '', thinking: '', inThinkTag: false };
}

/**
 * `sessionSlice.ts` streamUpdate for one chunk: thinking-role and reasoning
 * fields feed the reasoning block, `<think>…</think>` in reply text is split
 * out of the answer, `redactedThinking` and `signature` are kept so the
 * thinking block can be sent back to the model.
 */
export function knoxGuiAccumulateChunk(acc: IKnoxGuiStreamText, chunk: unknown): void {
	const rec = chunk && typeof chunk === 'object' ? chunk as Record<string, unknown> : undefined;
	if (rec?.role === 'thinking') {
		if (typeof rec.redactedThinking === 'string' && rec.redactedThinking) {
			acc.redactedThinking = rec.redactedThinking;
			acc.thinking = acc.thinking ? `${acc.thinking}\n\n${KNOX_REDACTED_THINKING_TEXT}` : KNOX_REDACTED_THINKING_TEXT;
			return;
		}
		if (typeof rec.signature === 'string' && rec.signature) {
			acc.thinkingSignature = rec.signature;
		}
	}
	acc.thinking += knoxGuiChunkThinking(chunk);
	let text = (acc.pendingTag ?? '') + knoxGuiChunkText(chunk);
	acc.pendingTag = undefined;
	while (text) {
		if (acc.inThinkTag) {
			const close = text.indexOf('</think>');
			if (close < 0) {
				const keep = partialTagLength(text, '</think>');
				acc.thinking += text.slice(0, text.length - keep);
				acc.pendingTag = keep ? text.slice(-keep) : undefined;
				return;
			}
			acc.thinking = (acc.thinking + text.slice(0, close)).trimEnd();
			acc.inThinkTag = false;
			text = text.slice(close + '</think>'.length).trimStart();
			continue;
		}
		const open = text.indexOf('<think>');
		if (open < 0) {
			const keep = partialTagLength(text, '<think>');
			acc.content += text.slice(0, text.length - keep);
			acc.pendingTag = keep ? text.slice(-keep) : undefined;
			return;
		}
		acc.content += text.slice(0, open);
		acc.inThinkTag = true;
		text = text.slice(open + '<think>'.length).trimStart();
	}
}

/** End of stream: text held back as a possible partial tag belongs where it was headed. */
export function knoxGuiFlushStreamText(acc: IKnoxGuiStreamText): void {
	if (acc.pendingTag) {
		if (acc.inThinkTag) {
			acc.thinking += acc.pendingTag;
		} else {
			acc.content += acc.pendingTag;
		}
		acc.pendingTag = undefined;
	}
}

function partialTagLength(text: string, tag: string): number {
	for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) {
		if (text.endsWith(tag.slice(0, n))) {
			return n;
		}
	}
	return 0;
}

/** Tool-call deltas carried by one chunk (`toolCalls` or OpenAI-style `tool_calls`). */
export function knoxGuiChunkToolCalls(chunk: unknown): unknown[] {
	if (!chunk || typeof chunk !== 'object') {
		return [];
	}
	const rec = chunk as Record<string, unknown>;
	return [
		...(Array.isArray(rec.toolCalls) ? rec.toolCalls : []),
		...(Array.isArray(rec.tool_calls) ? rec.tool_calls : []),
	];
}

/**
 * `streamUpdate` splittingForTools: the first tool-call delta after reply
 * text or reasoning starts a new assistant item, so the text is not sent
 * (or rendered) as part of the tool-call message.
 */
export function knoxGuiShouldSplitForTools(acc: IKnoxGuiStreamText, hasToolCalls: boolean, incomingToolCalls: number): boolean {
	return !hasToolCalls && incomingToolCalls > 0 && Boolean(acc.content.trim() || acc.thinking.trim());
}

export type KnoxGuiToolDecision = 'deny' | 'allow' | 'ask';

const WORKSPACE_CHECKPOINT_TOOL_NAMES = new Set(['builtin_workspace_checkpoint', 'workspace_checkpoint', 'checkpoint']);

const KNOX_SHELL_CLASS_TOOL_NAMES = new Set<string>([
	'builtin_run_terminal_command', 'builtin_pty_start', 'builtin_pty_send', 'builtin_qemu', 'builtin_git_commit',
]);

/**
 * `permissions.ts:isToolAutoApproved` without the path/command policy, which
 * only the host can evaluate. Used when `knox/evaluateToolPolicy` is unavailable.
 */
export function knoxGuiLocalAutoApprove(params: {
	name: string;
	args?: Record<string, unknown>;
	toolSettings: Record<string, KnoxToolSetting>;
	permissionMode: KnoxPermissionMode;
	sessionAllowlist: readonly string[];
}): boolean {
	// Mirrors permissions.ts: with no explicit setting, shell-class tools prompt outside Auto,
	// and in Ask mode file edits prompt too.
	const promptByDefault = params.permissionMode !== 'fullAuto'
		&& (KNOX_SHELL_CLASS_TOOL_NAMES.has(params.name) || (params.permissionMode === 'default' && FILE_EDIT_TOOL_NAMES.has(params.name)));
	const setting = params.toolSettings[params.name] ?? (promptByDefault ? 'allowedWithPermission' : 'allowedWithoutPermission');
	if (setting === 'disabled' || isAskUserToolName(params.name)) {
		return false;
	}
	if (WORKSPACE_CHECKPOINT_TOOL_NAMES.has(params.name) && (params.args?.action === 'restore' || params.args?.action === 'delete')) {
		return false;
	}
	if (params.sessionAllowlist.includes(params.name) || params.permissionMode === 'fullAuto') {
		return true;
	}
	if (params.permissionMode === 'acceptEdits' && FILE_EDIT_TOOL_NAMES.has(params.name)) {
		return true;
	}
	return setting === 'allowedWithoutPermission';
}

export function knoxGuiDoomCall(call: IKnoxGuiToolCall): IKnoxGuiDoomLoopCall {
	return {
		name: call.name,
		args: call.parsedArgs ?? call.arguments,
		output: call.outputItems?.map(item => item.content).join('\n') ?? call.output ?? '',
		ok: call.status === 'done',
	};
}
