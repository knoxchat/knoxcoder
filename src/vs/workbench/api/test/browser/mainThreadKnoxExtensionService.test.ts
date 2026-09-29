/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../base/common/async.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import type { IKnoxService } from '../../../contrib/knox/common/knoxService.js';
import { MainThreadKnoxExtensionService } from '../../browser/mainThreadKnoxExtensionService.js';
import { type ExtHostKnoxExtensionShape } from '../../common/extHost.protocol.js';
import { SingleProxyRPCProtocol } from '../common/testRPCProtocol.js';

suite('MainThreadKnoxExtensionService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('sets IKnoxService delegate when vscode.knox is present', async () => {
		let delegateSet = false;
		const proxy = new class extends mock<ExtHostKnoxExtensionShape>() {
			override async $isKnoxExtensionAvailable(): Promise<boolean> {
				return true;
			}
			override async $openChat(): Promise<void> { }
			override async $toggleAgentMode(): Promise<void> { }
			override async $isAgentModeActive(): Promise<boolean> {
				return false;
			}
			override async $newSession(): Promise<void> { }
			override async $guiPost(): Promise<void> { }
		};
		const knoxService = new class extends mock<IKnoxService>() {
			override setDelegate() {
				delegateSet = true;
				return { dispose() { } };
			}
			override notifyAgentModeChanged(): void { }
		};

		disposables.add(new MainThreadKnoxExtensionService(
			SingleProxyRPCProtocol(proxy),
			knoxService,
		));

		await timeout(0);
		assert.strictEqual(delegateSet, true);
	});

	test('does not set delegate when vscode.knox is absent', async () => {
		let delegateSet = false;
		const proxy = new class extends mock<ExtHostKnoxExtensionShape>() {
			override async $isKnoxExtensionAvailable(): Promise<boolean> {
				return false;
			}
		};
		const knoxService = new class extends mock<IKnoxService>() {
			override setDelegate() {
				delegateSet = true;
				return { dispose() { } };
			}
		};

		disposables.add(new MainThreadKnoxExtensionService(
			SingleProxyRPCProtocol(proxy),
			knoxService,
		));

		await timeout(0);
		assert.strictEqual(delegateSet, false);
	});

	test('openChat forwards to the extension host', async () => {
		let opened = false;
		const proxy = new class extends mock<ExtHostKnoxExtensionShape>() {
			override async $isKnoxExtensionAvailable(): Promise<boolean> {
				return true;
			}
			override async $openChat(): Promise<void> {
				opened = true;
			}
		};
		const knoxService = new class extends mock<IKnoxService>() {
			override setDelegate() {
				return { dispose() { } };
			}
			override notifyAgentModeChanged(): void { }
		};

		const service = disposables.add(new MainThreadKnoxExtensionService(
			SingleProxyRPCProtocol(proxy),
			knoxService,
		));

		await service.openChat();
		assert.strictEqual(opened, true);
	});

	test('guiPost forwards to the extension host', async () => {
		let posted: { messageType: string } | undefined;
		const proxy = new class extends mock<ExtHostKnoxExtensionShape>() {
			override async $isKnoxExtensionAvailable(): Promise<boolean> {
				return true;
			}
			override async $guiPost(message: { messageType: string }): Promise<void> {
				posted = message;
			}
		};
		const knoxService = new class extends mock<IKnoxService>() {
			override setDelegate() {
				return { dispose() { } };
			}
			override notifyAgentModeChanged(): void { }
			override notifyGuiMessage(): void { }
		};
		const service = disposables.add(new MainThreadKnoxExtensionService(
			SingleProxyRPCProtocol(proxy),
			knoxService,
		));
		await service.guiPost({ messageType: 'history/list', messageId: '1', data: {} });
		assert.strictEqual(posted?.messageType, 'history/list');
	});
});
