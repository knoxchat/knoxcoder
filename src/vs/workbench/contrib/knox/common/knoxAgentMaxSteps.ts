/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** 0 = unlimited. Applied when `agentMaxSteps` is unset. Stop with Cancel. */
export const DEFAULT_AGENT_MAX_STEPS = 0;
export const ABSOLUTE_MAX_AGENT_STEPS = 1000;

export const DEFAULT_DOOM_LOOP_THRESHOLD = 3;
export const RUST_DOOM_LOOP_THRESHOLD = 4;
export const SYSTEMS_DOOM_LOOP_THRESHOLD = 5;

export type KnoxResolvedAgentProfile = 'default' | 'systems' | 'rust';

const PROFILE_DEFAULTS: Record<KnoxResolvedAgentProfile, { maxSteps: number; doomLoopThreshold: number }> = {
	default: { maxSteps: DEFAULT_AGENT_MAX_STEPS, doomLoopThreshold: DEFAULT_DOOM_LOOP_THRESHOLD },
	rust: { maxSteps: 0, doomLoopThreshold: RUST_DOOM_LOOP_THRESHOLD },
	systems: { maxSteps: 0, doomLoopThreshold: SYSTEMS_DOOM_LOOP_THRESHOLD },
};

export function resolveAgentProfile(raw: unknown): KnoxResolvedAgentProfile {
	if (raw === 'systems') {
		return 'systems';
	}
	if (raw === 'rust') {
		return 'rust';
	}
	return 'default';
}

export function resolveAgentMaxSteps(
	raw: unknown,
	profile: unknown = 'default',
): number | null {
	const resolved = resolveAgentProfile(profile);
	if (raw === 0) {
		return null;
	}
	if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
		return Math.min(Math.floor(raw), ABSOLUTE_MAX_AGENT_STEPS);
	}
	const fallback = PROFILE_DEFAULTS[resolved].maxSteps;
	return fallback > 0 ? fallback : null;
}

export function shouldDisableToolsForMaxSteps(
	toolLoopSteps: number,
	maxSteps: number | null,
): boolean {
	return maxSteps !== null && toolLoopSteps >= maxSteps;
}

export function buildAgentMaxStepsSummaryInstruction(maxSteps: number): string {
	return [
		`[Agent max steps] You have reached the maximum of ${maxSteps} tool rounds for this turn.`,
		'Do not call any tools.',
		'Summarize what you accomplished, what is still unfinished, and the recommended next steps for the user.',
	].join(' ');
}

export function resolveDoomLoopThreshold(
	raw: unknown,
	profile: unknown = 'default',
): number | null {
	const resolved = resolveAgentProfile(profile);
	if (raw === 0) {
		return null;
	}
	if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 2) {
		return Math.min(Math.floor(raw), 20);
	}
	return PROFILE_DEFAULTS[resolved].doomLoopThreshold;
}
