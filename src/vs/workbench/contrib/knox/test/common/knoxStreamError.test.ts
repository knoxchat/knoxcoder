/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { describeKnoxStreamError, knoxStatusCodeFromMessage, knoxStreamErrorKind } from '../../common/knoxStreamError.js';

suite('knox stream error', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses HTTP status codes from error messages', () => {
		assert.strictEqual(knoxStatusCodeFromMessage('HTTP 429 rate limit'), 429);
		assert.strictEqual(knoxStatusCodeFromMessage('404 Not Found'), 404);
		assert.strictEqual(knoxStatusCodeFromMessage('no status'), undefined);
	});

	test('classifies 429 / 404 / 401 / overloaded', () => {
		assert.strictEqual(knoxStreamErrorKind(429, 'HTTP 429'), 'rateLimit');
		assert.strictEqual(knoxStreamErrorKind(404, 'HTTP 404'), 'notFound');
		assert.strictEqual(knoxStreamErrorKind(401, 'HTTP 401'), 'unauthorized');
		assert.strictEqual(knoxStreamErrorKind(undefined, 'Provider overloaded'), 'overloaded');
		assert.strictEqual(knoxStreamErrorKind(undefined, 'malformed chunk'), 'overloaded');
		assert.strictEqual(knoxStreamErrorKind(500, 'boom'), 'generic');
	});

	test('builds dialog copy for known statuses', () => {
		const model = { title: 'Haiku', provider: 'anthropic', model: 'claude', apiBase: 'https://api' };
		const rate = describeKnoxStreamError(new Error('HTTP 429 Too Many Requests'), model);
		assert.strictEqual(rate.kind, 'rateLimit');
		assert.ok(rate.title.startsWith('429'));
		assert.ok(rate.detail.includes('Haiku'));

		const missing = describeKnoxStreamError(new Error('404 Not Found'), model);
		assert.strictEqual(missing.kind, 'notFound');
		assert.ok(missing.detail.includes('https://api'));
		assert.ok(missing.detail.includes('claude'));

		const auth = describeKnoxStreamError(new Error('401 Unauthorized'), model);
		assert.strictEqual(auth.kind, 'unauthorized');
		assert.ok(auth.detail.toLowerCase().includes('api key'));

		const overloaded = describeKnoxStreamError(new Error('The server is overloaded'), model);
		assert.strictEqual(overloaded.kind, 'overloaded');
		assert.ok(overloaded.detail.includes('anthropic'));
	});
});
