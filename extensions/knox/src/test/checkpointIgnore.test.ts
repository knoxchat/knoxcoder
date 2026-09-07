/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'node:assert';

import {
	DEFAULT_CHECKPOINT_IGNORE_PATTERNS,
	isIgnoredByCheckpointFilter,
	SECRET_IGNORE_PATTERNS,
	toIgnorePath,
} from '../checkpoints/checkpointIgnore';

const ignore = require('ignore');

suite('checkpointIgnore', () => {
	const filter = ignore().add(DEFAULT_CHECKPOINT_IGNORE_PATTERNS);

	test('ignores .env with no user knoxignore', () => {
		assert.strictEqual(filter.ignores('.env'), true);
		assert.strictEqual(filter.ignores('.env.local'), true);
		assert.strictEqual(filter.ignores('.env.production'), true);
	});

	test('ignores secret key material', () => {
		for (const pattern of [
			'server.pem',
			'id_rsa',
			'id_ed25519',
			'credentials.json',
			'auth.p12',
			'tls.pfx',
			'.npmrc',
			'.pypirc',
			'secrets.json',
			'release.keystore',
			'signing.key',
		]) {
			assert.strictEqual(filter.ignores(pattern), true, pattern);
		}
	});

	test('does not ignore ordinary source files', () => {
		assert.strictEqual(filter.ignores('src/index.ts'), false);
		assert.strictEqual(filter.ignores('README.md'), false);
	});

	test('still ignores junk and lockfiles', () => {
		assert.strictEqual(filter.ignores('node_modules/left-pad/index.js'), true);
		assert.strictEqual(filter.ignores('package-lock.json'), true);
		assert.strictEqual(filter.ignores('.knox-debug/checkpoints/x.json'), true);
	});

	test('directory patterns match trailing-slash paths used by the walker', () => {
		assert.strictEqual(filter.ignores(toIgnorePath('node_modules', true)), true);
		assert.strictEqual(filter.ignores(toIgnorePath('.git', true)), true);
		assert.strictEqual(filter.ignores(toIgnorePath('src', true)), false);
	});

	test('secret patterns are a subset of the default list', () => {
		for (const pattern of SECRET_IGNORE_PATTERNS) {
			assert.ok(
				DEFAULT_CHECKPOINT_IGNORE_PATTERNS.includes(pattern),
				pattern,
			);
		}
	});

	test('fails closed when the filter is missing or failed', () => {
		assert.strictEqual(
			isIgnoredByCheckpointFilter('src/a.ts', null, false),
			true,
		);
		assert.strictEqual(
			isIgnoredByCheckpointFilter('src/a.ts', filter, true),
			true,
		);
		assert.strictEqual(
			isIgnoredByCheckpointFilter('src/a.ts', filter, false),
			false,
		);
		assert.strictEqual(
			isIgnoredByCheckpointFilter('.env', filter, false),
			true,
		);
	});
});
