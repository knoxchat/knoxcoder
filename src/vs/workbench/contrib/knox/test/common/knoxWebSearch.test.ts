/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { knoxModelSupportsWebSearch } from '../../common/knoxWebSearch.js';

suite('knox web search (T5.1)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('shows the toggle from supportedParameters or explicit capabilities.webSearch', () => {
		assert.strictEqual(knoxModelSupportsWebSearch(undefined), false);
		assert.strictEqual(knoxModelSupportsWebSearch({ title: 'plain' }), false);
		assert.strictEqual(knoxModelSupportsWebSearch({ title: 'search', supportedParameters: ['web_search'] }), true);
		assert.strictEqual(knoxModelSupportsWebSearch({ title: 'opts', supportedParameters: ['web_search_options'] }), true);
		assert.strictEqual(knoxModelSupportsWebSearch({ title: 'cap', capabilities: { webSearch: true } }), true);
		assert.strictEqual(knoxModelSupportsWebSearch({ title: 'stale', capabilities: { webSearch: false } }), false);
	});
});
