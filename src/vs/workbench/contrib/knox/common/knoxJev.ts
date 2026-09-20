/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxContextItem, IKnoxSerializedConfig } from './knoxChatTypes.js';

export type KnoxJevGateAction = 'allow' | 'ask' | 'deny';

export interface IKnoxToolGateResult {
	action: KnoxJevGateAction;
	reason: string;
	source: 'jev' | 'heuristic';
}

export function knoxJevEnabled(config: IKnoxSerializedConfig | undefined): boolean {
	return config?.experimental?.jev?.enabled === true;
}

export function knoxJevFailOpenAllow(reason = 'Jev IPC skipped'): IKnoxToolGateResult {
	return { action: 'allow', source: 'heuristic', reason };
}

export function knoxFormatJevDeniedMessage(reason: string): string {
	return `Blocked: ${reason}. The call was not executed. Pick a different tool that matches the user request.`;
}

export function knoxJevDeniedItems(reason: string): IKnoxContextItem[] {
	return [{
		name: 'Agent',
		description: 'jev-denied',
		content: knoxFormatJevDeniedMessage(reason),
	}];
}
