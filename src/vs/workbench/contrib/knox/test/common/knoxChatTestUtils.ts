/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { KnoxChatService } from '../../common/knoxChatService.js';
import { IKnoxGuiBridge, IKnoxGuiExtHost, IKnoxGuiMessage, IKnoxGuiRequestHandler, knoxGuiReverseReply } from '../../common/knoxGuiProtocol.js';

export class FakeKnoxGuiBridge extends Disposable implements IKnoxGuiBridge {
	declare readonly _serviceBrand: undefined;

	readonly requests: { messageType: string; data: unknown }[] = [];
	readonly posts: { messageType: string; data: unknown; messageId?: string }[] = [];
	streamChunks: unknown[] = [];
	readonly streamTokens: CancellationToken[] = [];
	handlers = new Map<string, (data: unknown) => unknown>();
	private readonly _requestHandlers = new Map<string, IKnoxGuiRequestHandler>();

	private readonly _onDidReceivePush = this._register(new Emitter<IKnoxGuiMessage>());
	readonly onDidReceivePush = this._onDidReceivePush.event;

	bindExtHost(_proxy: IKnoxGuiExtHost): void { }

	registerRequestHandler(messageType: string, handler: IKnoxGuiRequestHandler): IDisposable {
		const previous = this._requestHandlers.get(messageType);
		this._requestHandlers.set(messageType, handler);
		return toDisposable(() => {
			if (this._requestHandlers.get(messageType) !== handler) {
				return;
			}
			if (previous) {
				this._requestHandlers.set(messageType, previous);
			} else {
				this._requestHandlers.delete(messageType);
			}
		});
	}

	async handlePush(message: IKnoxGuiMessage): Promise<unknown> {
		this._onDidReceivePush.fire(message);
		const handler = this._requestHandlers.get(message.messageType);
		if (!handler) {
			return undefined;
		}
		try {
			return knoxGuiReverseReply(await handler(message.data));
		} catch {
			return knoxGuiReverseReply(undefined);
		}
	}

	async request(messageType: string, data?: unknown): Promise<unknown> {
		this.requests.push({ messageType, data });
		const handler = this.handlers.get(messageType);
		if (handler) {
			return handler(data);
		}
		if (messageType === 'config/getSerializedProfileInfo') {
			return {
				status: 'success',
				content: {
					result: {
						config: {
							models: [{ title: 'TestModel', provider: 'test' }],
							slashCommands: [],
							selectedModelByRole: { chat: { title: 'TestModel' } },
							experimental: {},
						},
					},
					profileId: 'local',
				},
			};
		}
		if (messageType === 'history/save' || messageType === 'brain/trackSession') {
			return { status: 'success', content: {} };
		}
		if (messageType === 'history/list') {
			return { status: 'success', content: [] };
		}
		return { status: 'success', content: {} };
	}

	async post(messageType: string, data?: unknown, messageId?: string): Promise<void> {
		this.posts.push(messageId !== undefined ? { messageType, data, messageId } : { messageType, data });
	}

	readonly streamRequests: { messageType: string; data: unknown }[] = [];

	async *streamRequest(messageType: string, data?: unknown, token?: CancellationToken): AsyncIterable<unknown> {
		this.streamRequests.push({ messageType, data });
		if (token) {
			this.streamTokens.push(token);
		}
		for (const chunk of this.streamChunks) {
			if (token?.isCancellationRequested) {
				return;
			}
			yield chunk;
		}
	}
}

export function createFakeWorkspace(): IWorkspaceContextService {
	return {
		getWorkspace: () => ({
			id: 'ws',
			folders: [{ uri: URI.file('/tmp/ws'), name: 'ws', index: 0 }],
		}),
	} as IWorkspaceContextService;
}

export function createKnoxChatServiceForTest(
	store: { add<T extends { dispose(): unknown }>(t: T): T },
	bridge?: FakeKnoxGuiBridge,
): { service: KnoxChatService; bridge: FakeKnoxGuiBridge } {
	const fake = store.add(bridge ?? new FakeKnoxGuiBridge());
	const storage = store.add(new TestStorageService());
	const service = store.add(new KnoxChatService(fake, createFakeWorkspace(), storage));
	return { service, bridge: fake };
}
