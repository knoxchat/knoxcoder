/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { KnoxChatService } from '../../common/knoxChatService.js';
import { IKnoxGuiBridge, IKnoxGuiExtHost, IKnoxGuiMessage } from '../../common/knoxGuiProtocol.js';

export class FakeKnoxGuiBridge extends Disposable implements IKnoxGuiBridge {
	declare readonly _serviceBrand: undefined;

	readonly requests: { messageType: string; data: unknown }[] = [];
	readonly posts: { messageType: string; data: unknown }[] = [];
	streamChunks: unknown[] = [];
	handlers = new Map<string, (data: unknown) => unknown>();

	private readonly _onDidReceivePush = this._register(new Emitter<IKnoxGuiMessage>());
	readonly onDidReceivePush = this._onDidReceivePush.event;

	bindExtHost(_proxy: IKnoxGuiExtHost): void { }
	handlePush(message: IKnoxGuiMessage): void {
		this._onDidReceivePush.fire(message);
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

	async post(messageType: string, data?: unknown): Promise<void> {
		this.posts.push({ messageType, data });
	}

	readonly streamRequests: { messageType: string; data: unknown }[] = [];

	async *streamRequest(messageType: string, data?: unknown): AsyncIterable<unknown> {
		this.streamRequests.push({ messageType, data });
		for (const chunk of this.streamChunks) {
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
