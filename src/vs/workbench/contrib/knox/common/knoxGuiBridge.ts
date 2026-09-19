/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { canceled } from '../../../../base/common/errors.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IKnoxGuiBridge, IKnoxGuiExtHost, IKnoxGuiMessage, IKnoxGuiRequestHandler, knoxGuiReverseReply } from './knoxGuiProtocol.js';

interface IKnoxStreamPayload {
	done?: boolean;
	content?: unknown;
	status?: string;
	error?: string;
}

/**
 * Bridge `AbortSignal` (session `streamAborter`) onto a workbench
 * `CancellationToken` so `streamRequest` can post Core `abort`.
 */
export function knoxCancellationTokenFromAbortSignal(signal: AbortSignal): { token: CancellationToken; dispose(): void } {
	const source = new CancellationTokenSource();
	const onAbort = () => source.cancel();
	if (signal.aborted) {
		source.cancel();
	} else {
		signal.addEventListener('abort', onAbort);
	}
	return {
		token: source.token,
		dispose() {
			signal.removeEventListener('abort', onAbort);
			source.dispose();
		},
	};
}

export class KnoxGuiBridge extends Disposable implements IKnoxGuiBridge {
	declare readonly _serviceBrand: undefined;

	private _proxy: IKnoxGuiExtHost | undefined;
	private readonly _waiting: ((proxy: IKnoxGuiExtHost) => void)[] = [];
	private readonly _requestHandlers = new Map<string, IKnoxGuiRequestHandler>();

	private readonly _onDidReceivePush = this._register(new Emitter<IKnoxGuiMessage>());
	readonly onDidReceivePush = this._onDidReceivePush.event;

	bindExtHost(proxy: IKnoxGuiExtHost): void {
		this._proxy = proxy;
		while (this._waiting.length) {
			this._waiting.shift()!(proxy);
		}
	}

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
			// Never leave extension `webviewProtocol.request` hung.
			return knoxGuiReverseReply(undefined);
		}
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

	async post(messageType: string, data?: unknown, messageId?: string): Promise<void> {
		const proxy = await this._getExtHost();
		await proxy.$post({
			messageType,
			messageId: messageId ?? generateUuid(),
			data,
		});
	}

	async *streamRequest(messageType: string, data?: unknown, token?: CancellationToken): AsyncIterable<unknown> {
		if (token?.isCancellationRequested) {
			return;
		}

		const proxy = await this._getExtHost();
		if (token?.isCancellationRequested) {
			return;
		}

		const messageId = generateUuid();
		const pending: unknown[] = [];
		let done = false;
		let aborted = false;
		let error: Error | undefined;
		let signal: (() => void) | undefined;
		const wake = () => {
			signal?.();
			signal = undefined;
		};

		const postAbort = () => {
			if (aborted) {
				return;
			}
			aborted = true;
			pending.length = 0;
			done = true;
			// Same messageId as llm/streamChat — Core keys abortedMessageIds on it.
			void this.post('abort', undefined, messageId).finally(wake);
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
			if (payload.content !== undefined && !aborted) {
				pending.push(payload.content);
			}
			if (payload.done) {
				done = true;
			}
			wake();
		});

		const cancel = token?.onCancellationRequested(postAbort);

		try {
			void proxy.$post({ messageType, messageId, data });
			while (!done || pending.length) {
				if (aborted) {
					break;
				}
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
			}
		} finally {
			if (token?.isCancellationRequested) {
				postAbort();
			}
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
