/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { IKnoxGuiMessage } from '../../contrib/knox/common/knoxGuiProtocol.js';
import { IKnoxExtensionDelegate, IKnoxService } from '../../contrib/knox/common/knoxService.js';
import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import { ExtHostContext, ExtHostKnoxExtensionShape, IKnoxGuiMessageDto, MainContext, MainThreadKnoxExtensionShape } from '../common/extHost.protocol.js';

@extHostNamedCustomer(MainContext.MainThreadKnoxExtension)
export class MainThreadKnoxExtensionService extends Disposable implements MainThreadKnoxExtensionShape, IKnoxExtensionDelegate {
	private readonly _proxy: ExtHostKnoxExtensionShape;

	constructor(
		extHostContext: IExtHostContext,
		@IKnoxService private readonly knoxService: IKnoxService
	) {
		super();

		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostKnoxExtension);
		this._initializeDelegate();
	}

	private async _initializeDelegate(): Promise<void> {
		const isExtensionAvailable = await this._proxy.$isKnoxExtensionAvailable();

		if (isExtensionAvailable && !this._store.isDisposed) {
			this._register(this.knoxService.setDelegate(this));
		}
	}

	async isAvailable(): Promise<boolean> {
		return this._proxy.$isKnoxExtensionAvailable();
	}

	async openChat(): Promise<void> {
		return this._proxy.$openChat();
	}

	async toggleAgentMode(): Promise<void> {
		return this._proxy.$toggleAgentMode();
	}

	async isAgentModeActive(): Promise<boolean> {
		return this._proxy.$isAgentModeActive();
	}

	async newSession(): Promise<void> {
		return this._proxy.$newSession();
	}

	async guiPost(message: IKnoxGuiMessage): Promise<void> {
		return this._proxy.$guiPost(message);
	}

	$onDidChangeAgentMode(active: boolean): void {
		this.knoxService.notifyAgentModeChanged(active);
	}

	$onGuiMessage(message: IKnoxGuiMessageDto): void {
		this.knoxService.notifyGuiMessage(message);
	}
}
