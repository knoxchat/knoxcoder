/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IKnoxGuiMessage, IKnoxGuiResponseEnvelope } from '../common/knoxGuiProtocol.js';
import { IKnoxService } from '../common/knoxService.js';

export class KnoxGuiMessenger extends Disposable {
	constructor(@IKnoxService private readonly knoxService: IKnoxService) {
		super();
	}

	post(messageType: string, data: unknown, messageId: string = generateUuid()): string {
		void this.knoxService.guiPost({ messageType, messageId, data });
		return messageId;
	}

	request<T = unknown>(messageType: string, data: unknown): Promise<T> {
		const messageId = generateUuid();
		return new Promise<T>((resolve, reject) => {
			const store = new DisposableStore();
			store.add(this.knoxService.onDidReceiveGuiMessage((message) => {
				if (message.messageId !== messageId) {
					return;
				}
				store.dispose();
				const envelope = message.data as IKnoxGuiResponseEnvelope | undefined;
				if (envelope && typeof envelope === 'object' && 'status' in envelope) {
					if (envelope.status === 'error') {
						reject(new Error(envelope.error || 'Knox GUI request failed'));
						return;
					}
					resolve(envelope.content as T);
					return;
				}
				resolve(message.data as T);
			}));
			void this.knoxService.guiPost({ messageType, messageId, data });
		});
	}

	async *streamRequest<T = unknown>(
		messageType: string,
		data: unknown,
		token?: CancellationToken,
	): AsyncGenerator<T[], T | undefined> {
		const messageId = generateUuid();
		const chunks: T[][] = [];
		let doneValue: T | undefined;
		let finished = false;
		let error: Error | undefined;
		let notify: (() => void) | undefined;

		const wait = () => new Promise<void>(resolve => { notify = resolve; });
		const sub = this.knoxService.onDidReceiveGuiMessage((message) => {
			if (message.messageId !== messageId) {
				return;
			}
			const envelope = message.data as IKnoxGuiResponseEnvelope;
			if (envelope?.status === 'error') {
				error = new Error(envelope.error || 'Knox GUI stream failed');
				finished = true;
				notify?.();
				return;
			}
			if (envelope?.done) {
				doneValue = envelope.content as T;
				finished = true;
				notify?.();
				return;
			}
			if (envelope?.content !== undefined) {
				const batch = Array.isArray(envelope.content) ? envelope.content as T[] : [envelope.content as T];
				chunks.push(batch);
				notify?.();
			}
		});
		this._register(sub);

		void this.knoxService.guiPost({ messageType, messageId, data });

		try {
			while (!finished) {
				if (token?.isCancellationRequested) {
					this.post('abort', undefined);
					break;
				}
				if (chunks.length === 0) {
					await wait();
				}
				while (chunks.length) {
					yield chunks.shift()!;
				}
				if (error) {
					throw error;
				}
			}
			while (chunks.length) {
				yield chunks.shift()!;
			}
			return doneValue;
		} finally {
			sub.dispose();
		}
	}

	subscribeHost(listener: (message: IKnoxGuiMessage) => void): void {
		this._register(this.knoxService.onDidReceiveGuiMessage(listener));
	}
}
