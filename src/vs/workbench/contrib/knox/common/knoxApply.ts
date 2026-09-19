/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../base/common/uuid.js';
import { IKnoxApplyState } from './knoxChatTypes.js';

export type KnoxApplyActionKind = 'apply' | 'reapply' | 'streaming' | 'done' | 'applied';

export interface IKnoxApplyToFilePayload {
	text: string;
	streamId: string;
	curSelectedModelTitle: string;
	filepath?: string;
}

export function knoxApplyStateByStreamId(
	states: readonly IKnoxApplyState[],
	streamId: string,
): IKnoxApplyState | undefined {
	return states.find(state => state.streamId === streamId);
}

export function knoxApplyActionKind(
	state: IKnoxApplyState | undefined,
	hasRejected: boolean,
	showApplied: boolean,
): KnoxApplyActionKind {
	switch (state?.status) {
		case 'streaming':
			return 'streaming';
		case 'done':
			return 'done';
		case 'closed':
			if (!hasRejected && state.numDiffs === 0) {
				return showApplied ? 'applied' : 'reapply';
			}
			return 'apply';
		default:
			return 'apply';
	}
}

export function knoxShouldShowAppliedFlash(state: IKnoxApplyState | undefined, hasRejected: boolean): boolean {
	return state?.status === 'closed' && !hasRejected && state.numDiffs === 0;
}

export function knoxBuildApplyToFilePayload(
	text: string,
	streamId: string,
	modelTitle: string,
	filepath?: string,
): IKnoxApplyToFilePayload {
	const payload: IKnoxApplyToFilePayload = {
		text,
		streamId,
		curSelectedModelTitle: modelTitle,
	};
	if (filepath) {
		payload.filepath = filepath;
	}
	return payload;
}

export function knoxCodeBlockStreamKey(sessionId: string, historyIndex: number, codeBlockIndex: number): string {
	return `${sessionId}:${historyIndex}:${codeBlockIndex}`;
}

export class KnoxCodeBlockStreamIds {
	private readonly _ids = new Map<string, string>();

	get(sessionId: string, historyIndex: number, codeBlockIndex: number): string {
		const key = knoxCodeBlockStreamKey(sessionId, historyIndex, codeBlockIndex);
		let id = this._ids.get(key);
		if (!id) {
			id = generateUuid();
			this._ids.set(key, id);
		}
		return id;
	}

	clear(): void {
		this._ids.clear();
	}
}

export function knoxApplyStatesFingerprint(states: readonly IKnoxApplyState[]): string {
	return states.map(state => `${state.streamId}:${state.status ?? ''}:${state.numDiffs ?? ''}:${state.filepath ?? ''}`).join('|');
}
