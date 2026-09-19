/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/**
 * One Core protocol envelope. `messageType` is a `FromWebviewProtocol` /
 * `ToWebviewProtocol` name (for example `llm/streamChat`). Do not invent new names.
 */
export interface IKnoxGuiMessage {
	messageType: string;
	messageId: string;
	data: unknown;
}

/** ExtHost half of the native GUI RPC (same methods as `ExtHostKnoxGuiShape`). */
export interface IKnoxGuiExtHost {
	$request(message: IKnoxGuiMessage): Promise<unknown>;
	$post(message: IKnoxGuiMessage): Promise<void>;
}

export const IKnoxGuiBridge = createDecorator<IKnoxGuiBridge>('knoxGuiBridge');

export type IKnoxGuiRequestHandler = (data: unknown) => Promise<unknown> | unknown;

/**
 * Renderer → Core bridge. Callers pass protocol **string** names; workbench
 * must not import `extensions/knox` `core`.
 */
export interface IKnoxGuiBridge {
	readonly _serviceBrand: undefined;

	readonly onDidReceivePush: Event<IKnoxGuiMessage>;

	request(messageType: string, data?: unknown, token?: CancellationToken): Promise<unknown>;

	/** Optional `messageId` must be reused for Core `abort` of a stream. */
	post(messageType: string, data?: unknown, messageId?: string): Promise<void>;

	streamRequest(messageType: string, data?: unknown, token?: CancellationToken): AsyncIterable<unknown>;

	/** Called by `MainThreadKnoxGui` when the extension host is ready. */
	bindExtHost(proxy: IKnoxGuiExtHost): void;

	/**
	 * Core → GUI push (`protocol.send` / stream chunks). When a reverse
	 * handler is registered, the returned `{ __knoxGuiReply, data }` completes
	 * extension `webviewProtocol.request` with the same `messageId`.
	 */
	handlePush(message: IKnoxGuiMessage): Promise<unknown>;

	/** IDE → GUI query (`getDefaultModelTitle`, `incrementFtc`, …). */
	registerRequestHandler(messageType: string, handler: IKnoxGuiRequestHandler): IDisposable;
}

/** RPC-safe wrapper so `undefined` answers still complete a reverse request. */
export interface IKnoxGuiReverseReply {
	readonly __knoxGuiReply: true;
	readonly data: unknown;
}

export function knoxGuiReverseReply(data: unknown): IKnoxGuiReverseReply {
	return { __knoxGuiReply: true, data };
}

export function knoxIsGuiReverseReply(value: unknown): value is IKnoxGuiReverseReply {
	return !!value && typeof value === 'object' && (value as IKnoxGuiReverseReply).__knoxGuiReply === true && 'data' in (value as object);
}

/** Normalize ExtHost `{ status, content }` envelopes and raw payloads. */
export function knoxUnwrapProtocol(result: unknown): { status: string; content: unknown; error?: string } {
	if (result && typeof result === 'object') {
		const record = result as { status?: string; content?: unknown; error?: string };
		if (typeof record.status === 'string') {
			return { status: record.status, content: record.content, error: record.error };
		}
	}
	return { status: 'success', content: result };
}

export function knoxProtocolObject(result: unknown): Record<string, unknown> | undefined {
	const unwrapped = knoxUnwrapProtocol(result);
	if (unwrapped.status === 'error') {
		return undefined;
	}
	if (unwrapped.content && typeof unwrapped.content === 'object' && !Array.isArray(unwrapped.content)) {
		return unwrapped.content as Record<string, unknown>;
	}
	if (result && typeof result === 'object' && !Array.isArray(result) && !('status' in (result as object))) {
		return result as Record<string, unknown>;
	}
	return undefined;
}

export function knoxProtocolSuccess(result: unknown): boolean {
	const unwrapped = knoxUnwrapProtocol(result);
	if (unwrapped.status === 'error') {
		return false;
	}
	const record = knoxProtocolObject(result);
	if (record && 'success' in record) {
		return record.success !== false;
	}
	return true;
}
