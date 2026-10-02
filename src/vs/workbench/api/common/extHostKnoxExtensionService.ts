/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { ExtensionIdentifier } from '../../../platform/extensions/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { IExtHostExtensionService } from './extHostExtensionService.js';
import { IExtHostRpcService } from './extHostRpcService.js';
import { ExtHostKnoxExtensionShape, IKnoxGuiMessageDto, MainContext, MainThreadKnoxExtensionShape } from './extHost.protocol.js';

const KNOX_EXTENSION_ID = 'vscode.knox';

interface KnoxAPI {
	isAgentModeActive(): Thenable<boolean>;
	toggleAgentMode(): Thenable<void>;
	openChat(): Thenable<void>;
	newSession(): Thenable<void>;
	handleGuiMessage(message: IKnoxGuiMessageDto): Thenable<void>;
	onDidChangeAgentMode: { (listener: (active: boolean) => unknown): { dispose(): void } };
	onDidReceiveGuiMessage: { (listener: (message: IKnoxGuiMessageDto) => unknown): { dispose(): void } };
}

interface KnoxExtension {
	readonly enabled: boolean;
	getAPI(version: 1): KnoxAPI;
}

export interface IExtHostKnoxExtensionService extends ExtHostKnoxExtensionShape {
	readonly _serviceBrand: undefined;
}

export const IExtHostKnoxExtensionService = createDecorator<IExtHostKnoxExtensionService>('IExtHostKnoxExtensionService');

export class ExtHostKnoxExtensionService extends Disposable implements IExtHostKnoxExtensionService {
	declare readonly _serviceBrand: undefined;

	private _knoxApi: KnoxAPI | undefined;
	private _knoxApiPromise: Promise<KnoxAPI | undefined> | undefined;
	private _guiListenersAttached = false;
	private readonly _proxy: MainThreadKnoxExtensionShape;

	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService,
		@IExtHostExtensionService private readonly _extHostExtensionService: IExtHostExtensionService,
	) {
		super();

		this._proxy = extHostRpc.getProxy(MainContext.MainThreadKnoxExtension);
	}

	async $isKnoxExtensionAvailable(): Promise<boolean> {
		const registry = await this._extHostExtensionService.getExtensionRegistry();
		return !!registry.getExtensionDescription(KNOX_EXTENSION_ID);
	}

	async $openChat(): Promise<void> {
		const api = await this._ensureKnoxApi();
		if (!api) {
			return;
		}
		await api.openChat();
	}

	async $toggleAgentMode(): Promise<void> {
		const api = await this._ensureKnoxApi();
		if (!api) {
			return;
		}
		await api.toggleAgentMode();
	}

	async $isAgentModeActive(): Promise<boolean> {
		const api = await this._ensureKnoxApi();
		if (!api) {
			return false;
		}
		return api.isAgentModeActive();
	}

	async $newSession(): Promise<void> {
		const api = await this._ensureKnoxApi();
		if (!api) {
			return;
		}
		await api.newSession();
	}

	async $guiPost(message: IKnoxGuiMessageDto): Promise<void> {
		const api = await this._ensureKnoxApi();
		if (!api) {
			return;
		}
		await api.handleGuiMessage(message);
	}

	private async _ensureKnoxApi(): Promise<KnoxAPI | undefined> {
		if (!this._knoxApiPromise) {
			this._knoxApiPromise = this._resolveKnoxApi();
		}
		return this._knoxApiPromise;
	}

	/**
	 * Chat, Memory, and Checkpoint Graph each post during setup. Without a
	 * single-flight lock those concurrent `$guiPost`s each subscribed to
	 * `onDidReceiveGuiMessage`, so every streamed token was forwarded N times
	 * and the reply rendered as "SinceSinceSince this this this".
	 */
	private async _resolveKnoxApi(): Promise<KnoxAPI | undefined> {
		if (this._knoxApi) {
			return this._knoxApi;
		}

		try {
			await this._extHostExtensionService.activateByIdWithErrors(
				new ExtensionIdentifier(KNOX_EXTENSION_ID),
				{ startup: false, extensionId: new ExtensionIdentifier(KNOX_EXTENSION_ID), activationEvent: 'api' }
			);

			const exports = this._extHostExtensionService.getExtensionExports(new ExtensionIdentifier(KNOX_EXTENSION_ID));
			if (!!exports && typeof (exports as KnoxExtension).getAPI === 'function') {
				this._knoxApi = (exports as KnoxExtension).getAPI(1);
				this._attachKnoxApiListeners(this._knoxApi);
			}
		} catch {
			// Knox extension not available
		}

		return this._knoxApi;
	}

	private _attachKnoxApiListeners(api: KnoxAPI): void {
		if (this._guiListenersAttached) {
			return;
		}
		this._guiListenersAttached = true;
		this._register(api.onDidChangeAgentMode((active) => {
			this._proxy.$onDidChangeAgentMode(active);
		}));
		this._register(api.onDidReceiveGuiMessage((message) => {
			this._proxy.$onGuiMessage(message);
		}));
	}
}
