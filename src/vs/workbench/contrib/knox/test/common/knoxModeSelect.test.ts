/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { knoxNextPermissionMode } from '../../common/knoxChat.js';
import {
	knoxAgentModeSupported,
	knoxCyclePermissionMode,
	knoxJobsChipCountLabel,
	knoxModeSelectCanChange,
	knoxModeSelectFallback,
} from '../../common/knoxModeSelect.js';

suite('knox mode select (T5.2)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const tools = { title: 'Agent', provider: 'knoxchat', capabilities: { tools: true } };
	const chatOnly = { title: 'Chat', provider: 'ollama', model: 'llama3' };

	test('falls back to Chat when the model cannot run tools', () => {
		assert.strictEqual(knoxAgentModeSupported(tools), true);
		assert.strictEqual(knoxAgentModeSupported(chatOnly), false);
		assert.strictEqual(knoxModeSelectFallback('agent', chatOnly), 'chat');
		assert.strictEqual(knoxModeSelectFallback('agent', tools), 'agent');
	});

	test('blocks Chat/Agent switches while streaming or when agent is unsupported', () => {
		assert.strictEqual(knoxModeSelectCanChange('chat', 'agent', false, tools), true);
		assert.strictEqual(knoxModeSelectCanChange('chat', 'agent', true, tools), false);
		assert.strictEqual(knoxModeSelectCanChange('chat', 'chat', false, tools), false);
		assert.strictEqual(knoxModeSelectCanChange('chat', 'agent', false, chatOnly), false);
	});

	test('cycles permission Ask → Edits → Auto', () => {
		assert.strictEqual(knoxNextPermissionMode('default'), 'acceptEdits');
		assert.strictEqual(knoxCyclePermissionMode('acceptEdits'), 'fullAuto');
		assert.strictEqual(knoxCyclePermissionMode('fullAuto'), 'default');
	});

	test('jobs badge is shown only when something is running', () => {
		assert.deepStrictEqual(knoxJobsChipCountLabel(0), { count: 0, showBadge: false });
		assert.deepStrictEqual(knoxJobsChipCountLabel(2), { count: 2, showBadge: true });
	});
});
