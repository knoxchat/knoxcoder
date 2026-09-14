/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	ABSOLUTE_MAX_AGENT_STEPS,
	DEFAULT_AGENT_MAX_STEPS,
	buildAgentMaxStepsSummaryInstruction,
	resolveAgentMaxSteps,
	shouldDisableToolsForMaxSteps,
} from '../../common/knoxAgentMaxSteps.js';

suite('resolveAgentMaxSteps', () => {
	test('defaults to unlimited when unset or invalid', () => {
		assert.strictEqual(resolveAgentMaxSteps(undefined), null);
		assert.strictEqual(resolveAgentMaxSteps(null), null);
		assert.strictEqual(resolveAgentMaxSteps('40'), null);
		assert.strictEqual(resolveAgentMaxSteps(NaN), null);
		assert.strictEqual(resolveAgentMaxSteps(-1), null);
		assert.strictEqual(DEFAULT_AGENT_MAX_STEPS, 0);
	});

	test('treats 0 as unlimited', () => {
		assert.strictEqual(resolveAgentMaxSteps(0), null);
	});

	test('accepts positive integers and floors floats', () => {
		assert.strictEqual(resolveAgentMaxSteps(25), 25);
		assert.strictEqual(resolveAgentMaxSteps(25.9), 25);
	});

	test('clamps absurd values', () => {
		assert.strictEqual(resolveAgentMaxSteps(ABSOLUTE_MAX_AGENT_STEPS + 50), ABSOLUTE_MAX_AGENT_STEPS);
	});

	test('does not cap systems or rust profiles unless maxSteps is set', () => {
		assert.strictEqual(resolveAgentMaxSteps(undefined, 'systems'), null);
		assert.strictEqual(resolveAgentMaxSteps(80, 'systems'), 80);
		assert.strictEqual(resolveAgentMaxSteps(undefined, 'rust'), null);
		assert.strictEqual(resolveAgentMaxSteps(45, 'rust'), 45);
	});
});

suite('shouldDisableToolsForMaxSteps', () => {
	test('never disables when unlimited', () => {
		assert.strictEqual(shouldDisableToolsForMaxSteps(999, null), false);
	});

	test('disables at and above the cap', () => {
		assert.strictEqual(shouldDisableToolsForMaxSteps(39, 40), false);
		assert.strictEqual(shouldDisableToolsForMaxSteps(40, 40), true);
		assert.strictEqual(shouldDisableToolsForMaxSteps(41, 40), true);
	});
});

suite('buildAgentMaxStepsSummaryInstruction', () => {
	test('includes the max and forbids further tools', () => {
		const text = buildAgentMaxStepsSummaryInstruction(40);
		assert.ok(text.includes('40'));
		assert.ok(text.toLowerCase().includes('do not call any tools'));
	});
});
