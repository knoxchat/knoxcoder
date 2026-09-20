/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { knoxToolStepDetail } from './knoxAgentActivity.js';
import { IKnoxToolCallState, KnoxToolStatus } from './knoxChatTypes.js';
import { knoxFormatToolName } from './knoxToolPermissions.js';
import { KnoxBuiltInToolName } from './knoxToolNames.js';

const LIVE_STATUSES: ReadonlySet<KnoxToolStatus> = new Set([
	'generating',
	'generated',
	'calling',
]);

export function isLiveToolStatus(status: KnoxToolStatus): boolean {
	return LIVE_STATUSES.has(status);
}

export function shouldRenderToolBody(
	status: KnoxToolStatus,
	userCollapsed: boolean,
	options?: { alwaysShow?: boolean },
): boolean {
	if (options?.alwaysShow) {
		return true;
	}
	if (isLiveToolStatus(status)) {
		return true;
	}
	return !userCollapsed;
}

export function toolDisplayName(toolCallState: IKnoxToolCallState): string {
	const name = toolCallState.toolCall.function?.name;
	return name ? knoxFormatToolName(name) : 'Tool';
}

function lineCount(text: string | undefined): number | undefined {
	if (!text) {
		return undefined;
	}
	return text.split('\n').length;
}

export function toolResultHint(toolCallState: IKnoxToolCallState): string | undefined {
	if (toolCallState.status === 'canceled') {
		return 'canceled';
	}
	const output = toolCallState.output?.[0];
	const lines = lineCount(output?.content);
	if (lines && lines > 1) {
		return `${lines} lines`;
	}
	if (output?.description) {
		const desc = output.description.trim();
		if (desc && desc.length < 80) {
			return desc;
		}
	}
	return knoxToolStepDetail(
		toolCallState.toolCall.function?.name,
		toolCallState.parsedArgs,
	);
}

export function finishedToolSummary(toolCallState: IKnoxToolCallState): {
	name: string;
	detail?: string;
	result?: string;
} {
	const name = toolDisplayName(toolCallState);
	const detail = knoxToolStepDetail(
		toolCallState.toolCall.function?.name,
		toolCallState.parsedArgs,
	);
	const result = toolResultHint(toolCallState);
	return {
		name,
		detail: detail && detail !== result ? detail : detail,
		result: result && result !== detail ? result : undefined,
	};
}

export function toolAlwaysShowsBody(toolName: string | undefined): boolean {
	return toolName === KnoxBuiltInToolName.AskUser;
}
