/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AsyncIterableSource } from '../../../base/common/async.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { IExtensionDescription } from '../../../platform/extensions/common/extensions.js';
import { ExtHostLanguageModelsShape, IMainContext, ITextModelApiAssistMessageDto, ITextModelApiAssistRequestOptionsDto, ITextModelApiChatInformationDto, ITextModelApiChatSelectorDto, ITextModelApiMessagePartDto, ITextModelApiResponsePartDto, MainContext, MainThreadLanguageModelsShape } from './extHost.protocol.js';
import { TextModelApiAssistMessage, TextModelApiAssistMessageRole, TextModelApiError, TextModelApiTextPart, TextModelApiToolCallPart, TextModelApiToolResultPart } from './extHostTypes.js';
import type * as vscode from 'vscode';

function messageContentToString(content: vscode.TextModelApiAssistMessage['content']): string {
	if (typeof content === 'string') {
		return content;
	}
	return content.map(part => part instanceof TextModelApiTextPart ? part.value : '').join('');
}

function serializeMessageParts(content: vscode.TextModelApiAssistMessage['content']): ITextModelApiMessagePartDto[] | undefined {
	if (typeof content === 'string') {
		return content ? [{ kind: 'text', value: content }] : undefined;
	}
	const parts: ITextModelApiMessagePartDto[] = [];
	for (const part of content) {
		if (part instanceof TextModelApiTextPart) {
			parts.push({ kind: 'text', value: part.value });
		} else if (part instanceof TextModelApiToolCallPart) {
			parts.push({ kind: 'toolCall', callId: part.callId, name: part.name, input: part.input });
		} else if (part instanceof TextModelApiToolResultPart) {
			const text = part.content
				.map(entry => entry instanceof TextModelApiTextPart ? entry.value : '')
				.join('');
			parts.push({ kind: 'toolResult', callId: part.callId, content: text });
		}
	}
	return parts.length ? parts : undefined;
}

function deserializeMessageContent(message: ITextModelApiAssistMessageDto): string | Array<vscode.TextModelApiInputPart> {
	if (!message.parts?.length) {
		return message.content;
	}
	const parts: vscode.TextModelApiInputPart[] = [];
	for (const part of message.parts) {
		if (part.kind === 'text') {
			parts.push(new TextModelApiTextPart(part.value));
		} else if (part.kind === 'toolCall') {
			parts.push(new TextModelApiToolCallPart(part.callId, part.name, part.input));
		} else {
			parts.push(new TextModelApiToolResultPart(part.callId, [new TextModelApiTextPart(part.content)]));
		}
	}
	return parts;
}

function serializeAssistOptions(options?: vscode.TextModelApiAssistRequestOptions): ITextModelApiAssistRequestOptionsDto | undefined {
	if (!options) {
		return undefined;
	}
	return {
		toolMode: options.toolMode,
		tools: options.tools?.map(tool => ({
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema,
		})),
	};
}

export class ExtHostLanguageModels extends Disposable implements ExtHostLanguageModelsShape {

	private readonly _proxy: MainThreadLanguageModelsShape;
	private readonly _providers = new Map<number, { vendor: string; provider: vscode.TextModelApiAssistProvider }>();
	private _handlePool = 0;
	private _requestIdPool = 0;
	private readonly _pendingRequests = new Map<number, AsyncIterableSource<vscode.TextModelApiTextPart | vscode.TextModelApiToolCallPart>>();

	private readonly _onDidChangeAssistModels = this._register(new Emitter<void>());
	readonly onDidChangeAssistModels: Event<void> = this._onDidChangeAssistModels.event;

	constructor(mainContext: IMainContext) {
		super();
		this._proxy = mainContext.getProxy(MainContext.MainThreadLanguageModels);
	}

	registerTextModelApiAssistProvider(_extension: IExtensionDescription, vendor: string, provider: vscode.TextModelApiAssistProvider): IDisposable {
		const handle = this._handlePool++;
		this._providers.set(handle, { vendor, provider });
		this._proxy.$registerProvider(handle, vendor);
		const change = provider.onDidChangeTextModelApiChatInformation?.(() => this._onDidChangeAssistModels.fire());

		return toDisposable(() => {
			change?.dispose();
			this._providers.delete(handle);
			this._proxy.$unregisterProvider(handle);
		});
	}

	async selectAssistModels(selector?: vscode.TextModelApiChatSelector): Promise<vscode.TextModelApiChat[]> {
		const models = await this._proxy.$selectChatModels(selector as ITextModelApiChatSelectorDto | undefined);
		return models.map(info => this._createChat(info));
	}

	async $provideChatInformation(handle: number, silent: boolean, token: CancellationToken): Promise<ITextModelApiChatInformationDto[]> {
		const entry = this._providers.get(handle);
		if (!entry) {
			return [];
		}
		const infos = await Promise.resolve(entry.provider.provideTextModelApiChatInformation({ silent }, token));
		if (!infos) {
			return [];
		}
		return infos.map(info => ({
			id: info.id,
			name: info.name,
			vendor: entry.vendor,
			family: info.family,
			version: info.version,
			maxInputTokens: info.maxInputTokens,
			maxOutputTokens: info.maxOutputTokens,
			tooltip: info.tooltip,
			detail: info.detail,
			capabilities: info.capabilities,
		}));
	}

	async $provideChatResponse(handle: number, modelId: string, messages: ITextModelApiAssistMessageDto[], requestId: number, token: CancellationToken, options?: ITextModelApiAssistRequestOptionsDto): Promise<void> {
		const entry = this._providers.get(handle);
		if (!entry) {
			throw new TextModelApiError('NotFound', `Assist provider handle ${handle} is gone.`);
		}

		const infos = await Promise.resolve(entry.provider.provideTextModelApiChatInformation({ silent: true }, token)) ?? [];
		const model = infos.find(info => info.id === modelId);
		if (!model) {
			throw TextModelApiError.NotFound(`Model ${modelId} is not available.`);
		}

		const converted = messages.map(message => new TextModelApiAssistMessage(
			message.role === TextModelApiAssistMessageRole.Assistant
				? TextModelApiAssistMessageRole.Assistant
				: TextModelApiAssistMessageRole.User,
			deserializeMessageContent(message),
			message.name,
		));

		const progress: vscode.Progress<vscode.TextModelApiResponsePart> = {
			report: (part) => {
				if (part instanceof TextModelApiTextPart || (part && typeof part === 'object' && 'value' in part && typeof (part as { value: unknown }).value === 'string' && !('callId' in part))) {
					this._proxy.$reportResponsePart(requestId, { kind: 'text', value: (part as TextModelApiTextPart).value });
				} else if (part instanceof TextModelApiToolCallPart || (part && typeof part === 'object' && 'callId' in part && 'name' in part && 'input' in part)) {
					const tool = part as TextModelApiToolCallPart;
					this._proxy.$reportResponsePart(requestId, { kind: 'toolCall', callId: tool.callId, name: tool.name, input: tool.input });
				}
			}
		};

		await entry.provider.provideTextModelApiAssistResponse(
			model,
			converted,
			{
				toolMode: options?.toolMode ?? 1,
				tools: options?.tools,
			},
			progress,
			token,
		);
	}

	async $provideTokenCount(handle: number, modelId: string, text: string, token: CancellationToken): Promise<number> {
		const entry = this._providers.get(handle);
		if (!entry) {
			return Math.ceil(text.length / 4);
		}
		const infos = await Promise.resolve(entry.provider.provideTextModelApiChatInformation({ silent: true }, token)) ?? [];
		const model = infos.find(info => info.id === modelId);
		if (!model) {
			return Math.ceil(text.length / 4);
		}
		return entry.provider.provideTokenCount(model, text, token);
	}

	$acceptResponsePart(requestId: number, part: ITextModelApiResponsePartDto): void {
		const stream = this._pendingRequests.get(requestId);
		if (!stream) {
			return;
		}
		if (part.kind === 'text') {
			stream.emitOne(new TextModelApiTextPart(part.value));
		} else {
			stream.emitOne(new TextModelApiToolCallPart(part.callId, part.name, part.input));
		}
	}

	$acceptResponseDone(requestId: number, errorMessage?: string): void {
		const stream = this._pendingRequests.get(requestId);
		if (!stream) {
			return;
		}
		this._pendingRequests.delete(requestId);
		if (errorMessage) {
			stream.reject(new Error(errorMessage));
			return;
		}
		stream.resolve();
	}

	$acceptChatModelsChanged(): void {
		this._onDidChangeAssistModels.fire();
	}

	private _createChat(info: ITextModelApiChatInformationDto): vscode.TextModelApiChat {
		const that = this;
		return {
			name: info.name,
			id: info.id,
			vendor: info.vendor,
			family: info.family,
			version: info.version,
			maxInputTokens: info.maxInputTokens,
			async sendRequest(messages, options, token) {
				const requestId = that._requestIdPool++;
				const source = new AsyncIterableSource<vscode.TextModelApiTextPart | vscode.TextModelApiToolCallPart>();
				that._pendingRequests.set(requestId, source);
				const dtos: ITextModelApiAssistMessageDto[] = messages.map(message => ({
					role: message.role,
					content: messageContentToString(message.content),
					name: message.name,
					parts: serializeMessageParts(message.content),
				}));
				that._proxy.$sendChatRequest(info.vendor, info.id, dtos, requestId, token ?? CancellationToken.None, serializeAssistOptions(options)).then(
					() => { /* completion is delivered via $acceptResponseDone */ },
					(error) => {
						const pending = that._pendingRequests.get(requestId);
						if (pending) {
							that._pendingRequests.delete(requestId);
							pending.reject(error instanceof Error ? error : new Error(String(error)));
						}
					},
				);
				const stream = source.asyncIterable;
				return {
					stream,
					text: (async function* () {
						for await (const part of stream) {
							if (part instanceof TextModelApiTextPart) {
								yield part.value;
							}
						}
					})(),
				};
			},
			countTokens(text, token) {
				const value = typeof text === 'string' ? text : messageContentToString(text.content);
				return that._proxy.$countTokens(info.vendor, info.id, value, token ?? CancellationToken.None);
			},
		};
	}
}
