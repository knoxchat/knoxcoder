/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	knoxGetReasoningEffortConfig,
	knoxParseReasoningEffortByModel,
	knoxReasoningModelKeys,
	knoxResolveReasoningEffort,
} from '../../common/knoxReasoningEffort.js';

suite('knox reasoning effort (T5.1)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('hides the selector unless reasoning_effort is advertised', () => {
		assert.strictEqual(knoxGetReasoningEffortConfig({ title: 'plain' }), null);
		assert.ok(knoxGetReasoningEffortConfig({ title: 'r1', supportedParameters: ['reasoning_effort'] }));
		assert.deepStrictEqual(
			knoxGetReasoningEffortConfig({
				title: 'gated',
				supportedParameters: ['reasoning_effort'],
				completionOptions: { reasoning: { supported_efforts: ['low', 'high'], default_effort: 'high', mandatory: true } },
			}),
			{ allowed: ['low', 'high'], default: 'high' },
		);
	});

	test('sticky per-model effort wins over the model default, not a leftover global', () => {
		const model = { title: 'deepseek/deepseek-v4-flash', model: 'deepseek-v4-flash', supportedParameters: ['reasoning_effort'] };
		const keys = knoxReasoningModelKeys(model);
		assert.ok(keys.includes('deepseek/deepseek-v4-flash'));
		assert.strictEqual(
			knoxResolveReasoningEffort(model, { [keys[0]]: 'high' }, 'low'),
			'high',
		);
		assert.strictEqual(knoxResolveReasoningEffort(model, {}, 'low'), 'low');
		assert.strictEqual(knoxResolveReasoningEffort(model, { other: 'high' }, undefined), 'medium');
	});

	test('parses persisted sticky maps and ignores junk', () => {
		assert.deepStrictEqual(knoxParseReasoningEffortByModel('{"a":"high"}'), { a: 'high' });
		assert.deepStrictEqual(knoxParseReasoningEffortByModel('{'), {});
		assert.deepStrictEqual(knoxParseReasoningEffortByModel(undefined), {});
	});
});
