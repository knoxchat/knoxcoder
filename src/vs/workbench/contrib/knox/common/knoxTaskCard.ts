/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxContextItem } from './knoxChatTypes.js';
import { knoxAsArgsRecord } from './knoxStreamingToolCode.js';

const PROMPT_PREVIEW_LIMIT = 160;

export interface IKnoxTaskSubagentInfo {
	profile: string;
	explores: number;
	prompt: string;
	promptPreview: string;
	label: string;
	output: string;
}

export function knoxTaskSubagentInfo(
	parsedArgs: unknown,
	output: readonly IKnoxContextItem[] | undefined,
): IKnoxTaskSubagentInfo {
	const args = knoxAsArgsRecord(parsedArgs);
	const profile = typeof args?.profile === 'string' && args.profile ? args.profile : 'explore';
	const prompt = typeof args?.prompt === 'string' ? args.prompt : '';
	const explores = Array.isArray(args?.explores) ? args.explores.length : 0;
	const promptPreview = prompt.length > PROMPT_PREVIEW_LIMIT
		? `${prompt.slice(0, PROMPT_PREVIEW_LIMIT)}…`
		: prompt;
	const parts = [profile];
	if (explores > 1) {
		parts.push(`×${explores}`);
	}
	let label = parts.join(' ');
	if (promptPreview) {
		label = `${label} — ${promptPreview}`;
	}
	return {
		profile,
		explores,
		prompt,
		promptPreview,
		label,
		output: output?.[0]?.content ?? '',
	};
}
