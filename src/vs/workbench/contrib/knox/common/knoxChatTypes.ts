/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KnoxAutonomousLoopStatus, KnoxChatMode } from './knoxChat.js';

export type KnoxChatMessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'thinking';

export type KnoxToolStatus = 'generating' | 'generated' | 'calling' | 'done' | 'canceled';

export type KnoxApplyStateStatus = 'streaming' | 'done' | 'closed';

export interface IKnoxTextPart {
	type: 'text';
	text: string;
}

export interface IKnoxImagePart {
	type: 'imageUrl';
	imageUrl?: { url?: string };
}

export type IKnoxMessagePart = IKnoxTextPart | IKnoxImagePart;

export type IKnoxMessageContent = string | IKnoxMessagePart[];

export interface IKnoxToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

export interface IKnoxToolCallDelta {
	id?: string;
	type?: 'function';
	index?: number;
	function?: {
		name?: string;
		arguments?: string;
	};
}

export interface IKnoxContextItem {
	content: string;
	name: string;
	description: string;
	editing?: boolean;
	editable?: boolean;
	icon?: string;
	hidden?: boolean;
	uri?: { type: string; value: string };
	id?: { providerTitle: string; itemId: string };
}

export interface IKnoxToolCallState {
	toolCallId: string;
	toolCall: IKnoxToolCall;
	status: KnoxToolStatus;
	parsedArgs: unknown;
	output?: IKnoxContextItem[];
}

export interface IKnoxChatMessage {
	role: KnoxChatMessageRole;
	content: IKnoxMessageContent;
	id?: string;
	createdAt?: string;
	toolCalls?: IKnoxToolCallDelta[];
	toolCallId?: string;
	reasoning?: string;
	signature?: string;
	redactedThinking?: string;
}

export interface IKnoxReasoning {
	active: boolean;
	text: string;
	startAt: number;
	endAt?: number;
}

export interface IKnoxPromptLog {
	modelTitle?: string;
	prompt?: string;
	completion?: string;
	modelProvider?: string;
	jev?: {
		turn?: {
			source?: string;
			route?: string;
			confidence?: number;
			skill?: string;
			profile?: string;
			reason?: string;
		};
		guardrails?: unknown;
		citations?: unknown;
	};
	[key: string]: unknown;
}

export interface IKnoxChatHistoryItem {
	message: IKnoxChatMessage;
	contextItems: IKnoxContextItem[];
	editorState?: unknown;
	promptLogs?: IKnoxPromptLog[];
	toolCallState?: IKnoxToolCallState;
	toolCallStates?: IKnoxToolCallState[];
	isGatheringContext?: boolean;
	checkpoint?: Record<string, string | null>;
	reasoning?: IKnoxReasoning;
	messageId?: string;
}

export interface IKnoxApplyState {
	streamId: string;
	status?: KnoxApplyStateStatus | string;
	numDiffs?: number;
	filepath?: string;
	fileContent?: string;
}

export interface IKnoxInjectedMemoryItem {
	id: number | null;
	kind: string;
	title: string;
	reason: string;
	category?: string;
	score?: number;
	pinned?: boolean;
	evidence?: string[];
}

export interface IKnoxLastCompaction {
	tokensSaved: number;
	originalMessageCount: number;
	compactedMessageCount: number;
	summarized: boolean;
	deduplicated: boolean;
	summarizationMethod: 'heuristic' | 'llm' | 'none';
	summaryText?: string;
}

export interface IKnoxAutonomousLoopState {
	status: KnoxAutonomousLoopStatus;
	iteration: number;
	maxIterations: number;
	goal?: string;
	startedAt?: number;
}

export const KNOX_IDLE_AUTONOMOUS_LOOP: IKnoxAutonomousLoopState = {
	status: 'idle',
	iteration: 0,
	maxIterations: 0,
};

export interface IKnoxSession {
	sessionId: string;
	title: string;
	workspaceDirectory?: string;
	history: IKnoxChatHistoryItem[];
	/** Set when `history/load` was slimmed for display (T8.2). */
	guiHydrateSlimmed?: boolean;
}

export interface IKnoxSessionMetadata {
	sessionId: string;
	title: string;
	dateCreated?: string;
	workspaceDirectory?: string;
}

export interface IKnoxInputModifiers {
	noContext?: boolean;
}

export interface IKnoxModelDescription {
	title: string;
	name?: string;
	provider?: string;
	model?: string;
	apiKey?: string;
	apiBase?: string;
	contextLength?: number;
	roles?: string[];
	supportedParameters?: string[];
	completionOptions?: { maxTokens?: number; [key: string]: unknown };
	capabilities?: {
		uploadImage?: boolean;
		tools?: boolean;
		webSearch?: boolean;
		reasoning?: boolean;
		[key: string]: unknown;
	};
}

export type KnoxBackgroundJobKind = 'shell' | 'task';
export type KnoxBackgroundJobStatus = 'running' | 'exited' | 'killed';

export interface IKnoxBackgroundJob {
	id: string;
	kind: KnoxBackgroundJobKind;
	title: string;
	status: KnoxBackgroundJobStatus;
	startedAt?: number;
	endedAt?: number;
	exitCode?: number | null;
	detail?: string;
	output?: string;
	truncated?: boolean;
	logPath?: string;
}

export interface IKnoxWorktreeState {
	enabled: boolean;
	busy: boolean;
	branch?: string;
	path?: string;
	files: string[];
	error?: string;
}

export const KNOX_IDLE_WORKTREE: IKnoxWorktreeState = {
	enabled: false,
	busy: false,
	files: [],
};

export interface IKnoxSlashCommand {
	name: string;
	description?: string;
	prompt?: string;
}

export interface IKnoxToolFunction {
	name: string;
	description?: string;
	parameters?: Record<string, unknown>;
}

export interface IKnoxTool {
	type?: 'function';
	function: IKnoxToolFunction;
	displayTitle?: string;
	wouldLikeTo?: string;
	isCurrently?: string;
	hasAlready?: string;
	readonly?: boolean;
	uri?: string;
	faviconUrl?: string;
	group?: string;
}

export type KnoxPolicyAction = 'allow' | 'ask' | 'deny';
export type KnoxExternalDirectoryMode = 'deny' | 'ask' | 'allow';

export interface IKnoxPolicyRule {
	pattern: string;
	action: KnoxPolicyAction;
}

export interface IKnoxAgentPolicy {
	paths?: IKnoxPolicyRule[];
	commands?: IKnoxPolicyRule[];
	externalDirectory?: KnoxExternalDirectoryMode;
	sandboxDestructive?: boolean;
}

export interface IKnoxProfileDescription {
	id: string;
	title?: string;
	profileType?: string;
	uri?: string;
	rawYaml?: string;
}

export type KnoxContextProviderType = 'normal' | 'query' | 'submenu';
export type KnoxContextProviderCategory = 'core' | 'integration';

export interface IKnoxContextProviderDescription {
	title: string;
	displayTitle: string;
	description: string;
	renderInlineAs?: string;
	type: KnoxContextProviderType;
	category?: KnoxContextProviderCategory;
}

export type KnoxModelRole = 'chat' | 'apply' | 'edit' | 'summarize' | 'viewRead' | 'realTimeSearch';

export interface IKnoxSerializedConfig {
	models?: IKnoxModelDescription[];
	slashCommands?: IKnoxSlashCommand[];
	contextProviders?: IKnoxContextProviderDescription[];
	tools?: IKnoxTool[];
	rules?: string[];
	disableSessionTitles?: boolean;
	experimental?: {
		agentMaxSteps?: unknown;
		agentDoomLoopThreshold?: unknown;
		agentViewSubdirectoryMaxFiles?: unknown;
		agentProfile?: unknown;
		agentVerifyCommand?: unknown;
		agentVerifyMode?: unknown;
		agentVerifyMaxIterations?: unknown;
		promptPath?: unknown;
		defaultContext?: unknown[];
		agentPolicy?: IKnoxAgentPolicy;
		agentPolicyFromRules?: IKnoxAgentPolicy;
		jev?: {
			enabled?: boolean;
			model?: string;
			apiKey?: string;
			timeoutMs?: number;
			failOpen?: boolean;
			baseUrl?: string;
		};
	};
	modelsByRole?: Partial<Record<KnoxModelRole, IKnoxModelDescription[]>>;
	selectedModelByRole?: Partial<Record<KnoxModelRole, IKnoxModelDescription | null>>;
	ui?: Record<string, unknown>;
}

export interface IKnoxChatSessionState {
	lastSessionId?: string;
	history: IKnoxChatHistoryItem[];
	isStreaming: boolean;
	title: string;
	id: string;
	streamAborter: AbortController;
	mode: KnoxChatMode;
	symbols: Record<string, unknown>;
	applyStates: IKnoxApplyState[];
	applyCurIndex: number;
	curCheckpointIndex: number;
	mainEditorContentTrigger?: unknown;
	injectedMemories: IKnoxInjectedMemoryItem[];
	lastCompaction: IKnoxLastCompaction | null;
	toolLoopSteps: number;
	sessionToolAllowlist: string[];
	autonomousLoop: IKnoxAutonomousLoopState;
	allSessionMetadata: IKnoxSessionMetadata[];
}

export function renderKnoxMessageContent(content: IKnoxMessageContent | undefined): string {
	if (typeof content === 'string') {
		return content;
	}
	if (!Array.isArray(content)) {
		return '';
	}
	return content
		.filter((part): part is IKnoxTextPart => part.type === 'text')
		.map(part => part.text)
		.join('\n');
}

export function renderKnoxChatMessage(message: IKnoxChatMessage | undefined): string {
	if (!message) {
		return '';
	}
	if (message.role === 'tool') {
		return typeof message.content === 'string' ? message.content : renderKnoxMessageContent(message.content);
	}
	return renderKnoxMessageContent(message.content);
}

export interface IKnoxHistoryItemPreview {
	role: KnoxChatMessageRole;
	text: string;
}

/** Compact thread line used by history/find until a row is fully rendered. */
export function knoxHistoryItemPreview(item: IKnoxChatHistoryItem): IKnoxHistoryItemPreview {
	const tool = item.toolCallState ?? item.toolCallStates?.[0];
	if (tool) {
		return {
			role: 'tool',
			text: `${tool.toolCall.function.name} (${tool.status})`,
		};
	}
	const reasoning = item.reasoning?.text?.trim();
	const body = renderKnoxChatMessage(item.message).trim();
	if (item.message.role === 'thinking' || (reasoning && !body)) {
		return { role: 'thinking', text: reasoning || body };
	}
	return { role: item.message.role, text: body || reasoning || '' };
}

export function messageHasVisibleContent(content: IKnoxMessageContent | undefined): boolean {
	if (typeof content === 'string') {
		return content.length > 0;
	}
	if (Array.isArray(content)) {
		return content.some(part => (part.type === 'text' ? !!part.text?.length : true));
	}
	return false;
}

export function getMessageToolCalls(message: IKnoxChatMessage): IKnoxToolCallDelta[] | undefined {
	if (message.role === 'assistant' || message.role === 'thinking') {
		return message.toolCalls;
	}
	return undefined;
}

/**
 * Merge a streamed assistant chunk into already-buffered text.
 * Treats identical/snapshot chunks as replacements, not concatenations.
 */
export function mergeAssistantText(existing: string, incoming: string): string {
	if (!incoming) {
		return existing;
	}
	if (!existing) {
		return incoming;
	}
	if (incoming === existing || existing.startsWith(incoming)) {
		return existing;
	}
	if (incoming.startsWith(existing)) {
		return incoming;
	}
	return existing + incoming;
}

export function writeAssistantContent(message: IKnoxChatMessage, incoming: string): void {
	message.content = mergeAssistantText(renderKnoxChatMessage(message), incoming);
}

export function incrementalParseJson(raw: string): [boolean, unknown] {
	try {
		return [true, JSON.parse(raw)];
	} catch {
		return [false, {}];
	}
}

export function renderContextItems(items: IKnoxContextItem[]): string {
	return items.map(item => item.content).join('\n\n');
}

export function knoxMessageImageUrls(content: IKnoxMessageContent | undefined): string[] {
	if (!Array.isArray(content)) {
		return [];
	}
	const urls: string[] = [];
	for (const part of content) {
		if (part.type === 'imageUrl' && part.imageUrl?.url) {
			urls.push(part.imageUrl.url);
		}
	}
	return urls;
}

export function knoxAssistantReplyText(item: IKnoxChatHistoryItem): string {
	if (item.message.role !== 'assistant') {
		return '';
	}
	return renderKnoxChatMessage(item.message).trim();
}
