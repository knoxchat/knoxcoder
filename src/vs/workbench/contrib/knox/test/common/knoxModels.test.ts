/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	knoxChatModelOptions,
	knoxFindModelForRole,
	knoxModelRoleUsesChatFallback,
	knoxModelsForRole,
	knoxModelSelectTitle,
	knoxModelSupportsTools,
	knoxNextChatModelTitle,
	knoxSelectedModelForRole,
	KNOX_MODEL_ROLES,
} from '../../common/knoxModels.js';

suite('knox models (T5.1)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('lists chat-role models and parks missing API keys at the end', () => {
		const options = knoxChatModelOptions([
			{ title: 'NoKey', apiKey: '', roles: ['chat'] },
			{ title: 'GPT', apiKey: 'sk', roles: ['chat'] },
			{ title: 'ApplyOnly', roles: ['apply'] },
		]);
		assert.deepStrictEqual(options.map(o => o.value), ['GPT', 'NoKey']);
		assert.strictEqual(options[1].missingApiKey, true);
	});

	test('detects tool support from capabilities, then parameters, then provider heuristics', () => {
		assert.strictEqual(knoxModelSupportsTools(undefined), false);
		assert.strictEqual(knoxModelSupportsTools({ title: 'Local', provider: 'ollama', model: 'llama3' }), false);
		assert.strictEqual(knoxModelSupportsTools({ title: 'Forced', provider: 'ollama', capabilities: { tools: true } }), true);
		assert.strictEqual(knoxModelSupportsTools({ title: 'Params', supportedParameters: ['tools'] }), true);
		assert.strictEqual(knoxModelSupportsTools({ title: 'Sonnet', provider: 'anthropic', model: 'claude-sonnet-4' }), true);
		assert.strictEqual(knoxModelSupportsTools({ title: 'Knox', provider: 'knoxchat', model: 'any' }), true);
	});

	test('cycles chat models wrapping in both directions', () => {
		const options = knoxChatModelOptions([
			{ title: 'A', roles: ['chat'] },
			{ title: 'B', roles: ['chat'] },
			{ title: 'C', roles: ['chat'] },
		]);
		assert.strictEqual(knoxNextChatModelTitle(options, 'A', 1), 'B');
		assert.strictEqual(knoxNextChatModelTitle(options, 'C', 1), 'A');
		assert.strictEqual(knoxNextChatModelTitle(options, 'A', -1), 'C');
		assert.strictEqual(knoxModelSelectTitle({ title: 'GPT-4o', model: 'gpt-4o' }), 'GPT-4o');
	});

	test('resolves role models from modelsByRole, then roles on the model list', () => {
		assert.deepStrictEqual([...KNOX_MODEL_ROLES], ['chat', 'edit', 'apply', 'summarize', 'viewRead', 'realTimeSearch']);
		assert.strictEqual(knoxModelRoleUsesChatFallback('apply'), true);
		assert.strictEqual(knoxModelRoleUsesChatFallback('summarize'), false);
		assert.deepStrictEqual(
			knoxModelsForRole({
				modelsByRole: { chat: [{ title: 'ChatA' }], apply: [] },
			}, 'chat').map(m => m.title),
			['ChatA'],
		);
		assert.deepStrictEqual(
			knoxModelsForRole({
				models: [
					{ title: 'ChatA', roles: ['chat'] },
					{ title: 'ApplyA', roles: ['apply'] },
				],
			}, 'apply').map(m => m.title),
			['ApplyA'],
		);
		assert.strictEqual(
			knoxSelectedModelForRole({ selectedModelByRole: { edit: { title: 'EditA' } } }, 'edit')?.title,
			'EditA',
		);
		assert.strictEqual(
			knoxSelectedModelForRole({ models: [{ title: 'ChatA' }] }, 'chat', 'ChatA')?.title,
			'ChatA',
		);
		assert.strictEqual(knoxFindModelForRole({ models: [{ title: 'X', provider: 'test' }] }, 'summarize', 'X')?.provider, 'test');
		assert.strictEqual(knoxFindModelForRole({}, 'apply', 'Missing')?.title, 'Missing');
	});
});
