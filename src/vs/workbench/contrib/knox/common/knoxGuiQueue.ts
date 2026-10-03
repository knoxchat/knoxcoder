/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * K-042: messages typed while the agent is running wait in a per-session queue. They are sent
 * one by one when the turn ends by itself ("queue"), or at once after stopping the turn
 * ("interrupt and send"). The queue is written to workspace storage on every change so a crash
 * or reload does not lose what the user already typed.
 */

export interface IKnoxGuiQueuedMessage {
	id: string;
	sessionId: string;
	text: string;
	images?: string[];
	createdAt: number;
}

export const KNOX_QUEUE_MAX = 20;
export const KNOX_QUEUE_STORAGE_KEY = 'knox.gui.messageQueue';

export function knoxGuiEnqueue(queue: readonly IKnoxGuiQueuedMessage[], message: IKnoxGuiQueuedMessage): IKnoxGuiQueuedMessage[] {
	if (!message.text.trim() && !message.images?.length) {
		return [...queue];
	}
	const next = [...queue, message];
	return next.length > KNOX_QUEUE_MAX ? next.slice(next.length - KNOX_QUEUE_MAX) : next;
}

export function knoxGuiQueueForSession(queue: readonly IKnoxGuiQueuedMessage[], sessionId: string): IKnoxGuiQueuedMessage[] {
	return queue.filter(message => message.sessionId === sessionId);
}

export function knoxGuiDequeue(queue: readonly IKnoxGuiQueuedMessage[], id: string): IKnoxGuiQueuedMessage[] {
	return queue.filter(message => message.id !== id);
}

/** Moves one queued message to the front so "send now" does not wait behind older ones. */
export function knoxGuiPromoteQueued(queue: readonly IKnoxGuiQueuedMessage[], id: string): IKnoxGuiQueuedMessage[] {
	const hit = queue.find(message => message.id === id);
	return hit ? [hit, ...queue.filter(message => message.id !== id)] : [...queue];
}

export interface IKnoxGuiQueueDrainContext {
	/** The user pressed Stop: nothing is sent behind their back. */
	aborted: boolean;
	/** A tool approval or question is waiting; a new message would be rejected. */
	blockedByPendingTool: boolean;
	/** The turn ended with an error; the user decides what to do next. */
	hasError: boolean;
	isStreaming: boolean;
}

/** The next message to send after a turn ended, or undefined when nothing should go out. */
export function knoxGuiNextToDrain(queue: readonly IKnoxGuiQueuedMessage[], sessionId: string, context: IKnoxGuiQueueDrainContext): IKnoxGuiQueuedMessage | undefined {
	if (context.aborted || context.blockedByPendingTool || context.hasError || context.isStreaming) {
		return undefined;
	}
	return queue.find(message => message.sessionId === sessionId);
}

export function knoxGuiSerializeQueue(queue: readonly IKnoxGuiQueuedMessage[]): string {
	return JSON.stringify(queue);
}

export function knoxGuiParseQueue(raw: string | undefined): IKnoxGuiQueuedMessage[] {
	if (!raw) {
		return [];
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) {
		return [];
	}
	const out: IKnoxGuiQueuedMessage[] = [];
	for (const entry of parsed) {
		if (!entry || typeof entry !== 'object') {
			continue;
		}
		const rec = entry as Record<string, unknown>;
		if (typeof rec.id !== 'string' || !rec.id || typeof rec.sessionId !== 'string' || typeof rec.text !== 'string') {
			continue;
		}
		const images = Array.isArray(rec.images) ? rec.images.filter((url): url is string => typeof url === 'string') : undefined;
		if (!rec.text.trim() && !images?.length) {
			continue;
		}
		out.push({ id: rec.id, sessionId: rec.sessionId, text: rec.text, images: images?.length ? images : undefined, createdAt: typeof rec.createdAt === 'number' ? rec.createdAt : 0 });
	}
	return out.slice(-KNOX_QUEUE_MAX);
}
