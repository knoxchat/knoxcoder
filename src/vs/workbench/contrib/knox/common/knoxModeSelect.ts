/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KnoxChatMode, KnoxPermissionMode, knoxNextPermissionMode } from './knoxChat.js';
import { IKnoxModelDescription } from './knoxChatTypes.js';
import { knoxModelSupportsTools } from './knoxModels.js';

export function knoxAgentModeSupported(model: IKnoxModelDescription | undefined): boolean {
	return knoxModelSupportsTools(model);
}

export function knoxModeSelectFallback(
	mode: KnoxChatMode,
	model: IKnoxModelDescription | undefined,
): KnoxChatMode {
	if (mode === 'agent' && !knoxAgentModeSupported(model)) {
		return 'chat';
	}
	return mode;
}

export function knoxModeSelectCanChange(
	current: KnoxChatMode,
	next: KnoxChatMode,
	isStreaming: boolean,
	model: IKnoxModelDescription | undefined,
): boolean {
	if (next === current || isStreaming) {
		return false;
	}
	if (next === 'agent' && !knoxAgentModeSupported(model)) {
		return false;
	}
	return true;
}

export function knoxCyclePermissionMode(current: KnoxPermissionMode): KnoxPermissionMode {
	return knoxNextPermissionMode(current);
}

export function knoxJobsChipCountLabel(runningJobs: number): { count: number; showBadge: boolean } {
	return { count: runningJobs, showBadge: runningJobs > 0 };
}
