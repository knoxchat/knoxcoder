/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AutoOpenBarrier } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IKnoxGuiMessage } from '../common/knoxGuiProtocol.js';
import { IKnoxService, IKnoxExtensionDelegate } from '../common/knoxService.js';

export class KnoxService extends Disposable implements IKnoxService {
	declare readonly _serviceBrand: undefined;

	private _delegate: IKnoxExtensionDelegate | undefined;
	private readonly _delegateBarrier = new AutoOpenBarrier(10_000);
	private readonly _onDidChangeAgentMode = this._register(new Emitter<boolean>());
	readonly onDidChangeAgentMode: Event<boolean> = this._onDidChangeAgentMode.event;
	private readonly _onDidReceiveGuiMessage = this._register(new Emitter<IKnoxGuiMessage>());
	readonly onDidReceiveGuiMessage: Event<IKnoxGuiMessage> = this._onDidReceiveGuiMessage.event;
	private _activeChatSessionId: string | null = null;

	constructor(@ILogService private readonly logService: ILogService) {
		super();
	}

	setDelegate(delegate: IKnoxExtensionDelegate): IDisposable {
		if (this._delegate && this._delegate !== delegate) {
			// Chat, Memory, and Checkpoint Graph each talk through this singleton.
			// A second extension host (ui + workspace) must not throw or steal the pipe.
			this.logService.warn('[KnoxService][setDelegate] KnoxExtension delegate is already set; ignoring the extra host.');
			return toDisposable(() => { });
		}

		this._delegate = delegate;
		this._delegateBarrier.open();

		return toDisposable(() => {
			if (this._delegate === delegate) {
				this._delegate = undefined;
			}
		});
	}

	notifyAgentModeChanged(active: boolean): void {
		this._onDidChangeAgentMode.fire(active);
	}

	async isAvailable(): Promise<boolean> {
		await this._delegateBarrier.wait();
		if (!this._delegate) {
			return false;
		}
		return this._delegate.isAvailable();
	}

	async openChat(): Promise<void> {
		await this._delegateBarrier.wait();
		if (!this._delegate) {
			this.logService.warn('[KnoxService][openChat] KnoxExtension delegate is not set.');
			return;
		}
		return this._delegate.openChat();
	}

	async toggleAgentMode(): Promise<void> {
		await this._delegateBarrier.wait();
		if (!this._delegate) {
			this.logService.warn('[KnoxService][toggleAgentMode] KnoxExtension delegate is not set.');
			return;
		}
		return this._delegate.toggleAgentMode();
	}

	async isAgentModeActive(): Promise<boolean> {
		await this._delegateBarrier.wait();
		if (!this._delegate) {
			return false;
		}
		return this._delegate.isAgentModeActive();
	}

	async newSession(): Promise<void> {
		await this._delegateBarrier.wait();
		if (!this._delegate) {
			this.logService.warn('[KnoxService][newSession] KnoxExtension delegate is not set.');
			return;
		}
		return this._delegate.newSession();
	}

	notifyGuiMessage(message: IKnoxGuiMessage): void {
		this._onDidReceiveGuiMessage.fire(message);
	}

	get activeChatSessionId(): string | null {
		return this._activeChatSessionId;
	}

	private trackActiveChatSession(data: unknown): void {
		const raw = data && typeof data === 'object' ? (data as { sessionId?: unknown }).sessionId : undefined;
		const next = typeof raw === 'string' && raw ? raw : null;
		if (next === this._activeChatSessionId) {
			return;
		}
		this._activeChatSessionId = next;
		this._onDidReceiveGuiMessage.fire({ messageType: 'activeChatSessionChanged', messageId: generateUuid(), data: { sessionId: next } });
	}

	async guiPost(message: IKnoxGuiMessage): Promise<void> {
		// Synchronous, so the posting chat view still holds this id when the broadcast reaches it.
		if (message.messageType === 'setActiveChatSession') {
			this.trackActiveChatSession(message.data);
		}
		await this._delegateBarrier.wait();
		if (!this._delegate) {
			this.logService.warn('[KnoxService][guiPost] KnoxExtension delegate is not set.');
			return;
		}
		return this._delegate.guiPost(message);
	}
}
