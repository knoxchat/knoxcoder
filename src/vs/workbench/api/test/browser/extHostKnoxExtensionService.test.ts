/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../base/common/event.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IExtHostExtensionService } from '../../common/extHostExtensionService.js';
import { ExtHostKnoxExtensionService } from '../../common/extHostKnoxExtensionService.js';
import { IKnoxGuiMessageDto, MainThreadKnoxExtensionShape } from '../../common/extHost.protocol.js';
import { SingleProxyRPCProtocol } from '../common/testRPCProtocol.js';

suite('ExtHostKnoxExtensionService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('concurrent $guiPost from Chat/Memory/Checkpoint Graph attach one GUI listener', async () => {
		const guiMessages: IKnoxGuiMessageDto[] = [];
		const incoming = disposables.add(new Emitter<IKnoxGuiMessageDto>());
		const agentMode = disposables.add(new Emitter<boolean>());
		let activations = 0;
		let releaseActivate: () => void = () => { };
		const activating = new Promise<void>(resolve => { releaseActivate = resolve; });

		const proxy = new class extends mock<MainThreadKnoxExtensionShape>() {
			override $onGuiMessage(message: IKnoxGuiMessageDto): void {
				guiMessages.push(message);
			}
			override $onDidChangeAgentMode(): void { }
		};

		const extHost = {
			async activateByIdWithErrors(): Promise<void> {
				activations += 1;
				await activating;
			},
			getExtensionExports() {
				return {
					enabled: true,
					getAPI() {
						return {
							isAgentModeActive: async () => false,
							toggleAgentMode: async () => { },
							openChat: async () => { },
							newSession: async () => { },
							handleGuiMessage: async () => { },
							onDidChangeAgentMode: agentMode.event,
							onDidReceiveGuiMessage: incoming.event,
						};
					},
				};
			},
		} as unknown as IExtHostExtensionService;

		const service = disposables.add(new ExtHostKnoxExtensionService(
			SingleProxyRPCProtocol(proxy),
			extHost,
		));

		const posts = [
			service.$guiPost({ messageType: 'config/getSerializedProfileInfo', messageId: '1', data: {} }),
			service.$guiPost({ messageType: 'config/getSerializedProfileInfo', messageId: '2', data: {} }),
			service.$guiPost({ messageType: 'config/getSerializedProfileInfo', messageId: '3', data: {} }),
		];
		releaseActivate();
		await Promise.all(posts);
		assert.strictEqual(activations, 1);

		incoming.fire({
			messageType: 'llm/streamChat',
			messageId: 'stream-1',
			data: { done: false, status: 'success', content: [{ content: 'Since' }] },
		});
		assert.strictEqual(guiMessages.length, 1);
		assert.strictEqual(guiMessages[0].messageId, 'stream-1');
	});
});
