/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IKnoxGuiMessage } from './knoxGuiProtocol.js';

export interface IKnoxExtensionDelegate {
	isAvailable(): Promise<boolean>;
	openChat(): Promise<void>;
	toggleAgentMode(): Promise<void>;
	isAgentModeActive(): Promise<boolean>;
	newSession(): Promise<void>;
	guiPost(message: IKnoxGuiMessage): Promise<void>;
}

export const IKnoxService = createDecorator<IKnoxService>('knoxService');

/**
 * Thin workbench service (KN-110). Git analog: `IGitService`.
 * Memory sqlite, tools, and LLM streaming stay in the extension host.
 * Native GUI messages reuse the webview protocol over this pipe.
 */
export interface IKnoxService {
	readonly _serviceBrand: undefined;

	setDelegate(delegate: IKnoxExtensionDelegate): IDisposable;

	isAvailable(): Promise<boolean>;
	openChat(): Promise<void>;
	toggleAgentMode(): Promise<void>;
	isAgentModeActive(): Promise<boolean>;
	newSession(): Promise<void>;

	guiPost(message: IKnoxGuiMessage): Promise<void>;
	readonly onDidReceiveGuiMessage: Event<IKnoxGuiMessage>;
	notifyGuiMessage(message: IKnoxGuiMessage): void;

	readonly onDidChangeAgentMode: Event<boolean>;
	notifyAgentModeChanged(active: boolean): void;
}
