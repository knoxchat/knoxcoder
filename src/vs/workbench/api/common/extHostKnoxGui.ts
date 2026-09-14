/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { ExtensionIdentifier } from '../../../platform/extensions/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { KNOX_EXTENSION_ID } from '../../common/knox.js';
import { ExtHostKnoxGuiShape, KnoxGuiMessageDto, MainContext, MainThreadKnoxGuiShape } from './extHost.protocol.js';
import { IExtHostExtensionService } from './extHostExtensionService.js';
import { IExtHostRpcService } from './extHostRpcService.js';

export interface IExtHostKnoxGui extends ExtHostKnoxGuiShape {
	readonly _serviceBrand: undefined;
}

export const IExtHostKnoxGui = createDecorator<IExtHostKnoxGui>('IExtHostKnoxGui');

interface IKnoxNativeGuiApi {
	request(messageType: string, data: unknown, messageId: string): unknown;
	post(messageType: string, data: unknown, messageId: string): Promise<void> | void;
	setPushHandler(handler: (message: KnoxGuiMessageDto) => void): void;
}

interface IKnoxExtensionExports {
	nativeGui?: IKnoxNativeGuiApi;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
	return !!value && typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function';
}

export class ExtHostKnoxGui extends Disposable implements IExtHostKnoxGui {
	declare readonly _serviceBrand: undefined;

	private readonly _proxy: MainThreadKnoxGuiShape;
	private _pushAttached = false;

	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService,
		@IExtHostExtensionService private readonly _extHostExtensionService: IExtHostExtensionService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._proxy = extHostRpc.getProxy(MainContext.MainThreadKnoxGui);
		void this._attachPushSink();
	}

	async $request(message: KnoxGuiMessageDto): Promise<unknown> {
		try {
			const api = await this._ensureNativeGui();
			const result = await Promise.resolve(api.request(message.messageType, message.data, message.messageId));
			if (isAsyncIterable(result)) {
				return this._streamIterable(message, result);
			}
			return { done: true, content: result, status: 'success' };
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			this._logService.error('[ExtHostKnoxGui] $request failed', error);
			return { done: true, error: error.message, status: 'error' };
		}
	}

	async $post(message: KnoxGuiMessageDto): Promise<void> {
		const api = await this._ensureNativeGui();
		await Promise.resolve(api.post(message.messageType, message.data, message.messageId));
	}

	private async _streamIterable(message: KnoxGuiMessageDto, iterable: AsyncIterable<unknown> | AsyncGenerator<unknown>): Promise<unknown> {
		const iterator = (iterable as AsyncGenerator<unknown>)[Symbol.asyncIterator]();
		let next = await iterator.next();
		while (!next.done) {
			this._proxy.$push({
				messageType: message.messageType,
				messageId: message.messageId,
				data: { done: false, content: next.value, status: 'success' },
			});
			next = await iterator.next();
		}
		const final = { done: true, content: next.value, status: 'success' };
		this._proxy.$push({
			messageType: message.messageType,
			messageId: message.messageId,
			data: final,
		});
		return final;
	}

	private async _attachPushSink(): Promise<void> {
		try {
			const api = await this._ensureNativeGui();
			if (this._pushAttached) {
				return;
			}
			this._pushAttached = true;
			api.setPushHandler(msg => this._proxy.$push(msg));
		} catch (err) {
			this._logService.debug('[ExtHostKnoxGui] native push sink not attached', err);
		}
	}

	private async _ensureNativeGui(): Promise<IKnoxNativeGuiApi> {
		// ExtHostKnoxGui is constructed from createApiFactoryAndRegisterActors,
		// before NodeModuleRequireInterceptor installs the `vscode` ESM hook.
		// Activating vscode.knox before that completes fails `import 'vscode'`
		// with assertType → "Unexpected type".
		await this._extHostExtensionService.getExtensionRegistry();
		await this._extHostExtensionService.activateByIdWithErrors(
			new ExtensionIdentifier(KNOX_EXTENSION_ID),
			{ startup: false, extensionId: new ExtensionIdentifier(KNOX_EXTENSION_ID), activationEvent: 'api' }
		);

		const exports = this._extHostExtensionService.getExtensionExports(new ExtensionIdentifier(KNOX_EXTENSION_ID)) as IKnoxExtensionExports | null | undefined;
		if (!exports?.nativeGui) {
			throw new Error('vscode.knox native GUI API is not available');
		}
		return exports.nativeGui;
	}
}
