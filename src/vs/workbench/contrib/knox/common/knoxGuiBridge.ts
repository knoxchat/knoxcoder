/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { canceled } from '../../../../base/common/errors.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IKnoxGuiBridge, IKnoxGuiExtHost, IKnoxGuiMessage } from './knoxGuiProtocol.js';

interface IKnoxStreamPayload {
	done?: boolean;
	content?: unknown;
	status?: string;
	error?: string;
}

export class KnoxGuiBridge extends Disposable implements IKnoxGuiBridge {
	declare readonly _serviceBrand: undefined;

	private _proxy: IKnoxGuiExtHost | undefined;
	private readonly _waiting: ((proxy: IKnoxGuiExtHost) => void)[] = [];

	private readonly _onDidReceivePush = this._register(new Emitter<IKnoxGuiMessage>());
	readonly onDidReceivePush = this._onDidReceivePush.event;

	bindExtHost(proxy: IKnoxGuiExtHost): void {
		this._proxy = proxy;
		while (this._waiting.length) {
			this._waiting.shift()!(proxy);
		}
	}

	handlePush(message: IKnoxGuiMessage): void {
		this._onDidReceivePush.fire(message);
	}

	async request(messageType: string, data?: unknown, token?: CancellationToken): Promise<unknown> {
		if (token?.isCancellationRequested) {
			throw canceled();
		}
		const proxy = await this._getExtHost();
		return proxy.$request({
			messageType,
			messageId: generateUuid(),
			data,
		});
	}

	async post(messageType: string, data?: unknown): Promise<void> {
		const proxy = await this._getExtHost();
		await proxy.$post({
			messageType,
			messageId: generateUuid(),
			data,
		});
	}

	async *streamRequest(messageType: string, data?: unknown, token?: CancellationToken): AsyncIterable<unknown> {
		if (token?.isCancellationRequested) {
			throw canceled();
		}

		const proxy = await this._getExtHost();
		const messageId = generateUuid();
		const pending: unknown[] = [];
		let done = false;
		let error: Error | undefined;
		let signal: (() => void) | undefined;
		const wake = () => {
			signal?.();
			signal = undefined;
		};

		const listener = this._onDidReceivePush.event(msg => {
			if (msg.messageId !== messageId) {
				return;
			}
			const payload = (msg.data ?? {}) as IKnoxStreamPayload;
			if (payload.status === 'error') {
				error = new Error(typeof payload.error === 'string' ? payload.error : 'Knox stream error');
				done = true;
				wake();
				return;
			}
			if (payload.content !== undefined) {
				pending.push(payload.content);
			}
			if (payload.done) {
				done = true;
			}
			wake();
		});

		const cancel = token?.onCancellationRequested(() => {
			done = true;
			wake();
		});

		try {
			void proxy.$post({ messageType, messageId, data });
			while (!done || pending.length) {
				if (pending.length) {
					yield pending.shift();
					continue;
				}
				if (done) {
					break;
				}
				await new Promise<void>(resolve => { signal = resolve; });
				if (error) {
					throw error;
				}
				if (token?.isCancellationRequested) {
					throw canceled();
				}
			}
		} finally {
			listener.dispose();
			cancel?.dispose();
		}
	}

	private _getExtHost(): Promise<IKnoxGuiExtHost> {
		if (this._proxy) {
			return Promise.resolve(this._proxy);
		}
		return new Promise(resolve => this._waiting.push(resolve));
	}
}
