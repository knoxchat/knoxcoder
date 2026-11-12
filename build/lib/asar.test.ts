/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { createAsar } from './asar.ts';

const require = createRequire(import.meta.url);

describe('createAsar', () => {
	it('resolves the pinned @electron/asar whose Filesystem is a constructor', () => {
		assert.equal(require('@electron/asar/package.json').version, '3.2.1');
		const stream = createAsar('.', [], [], [], 'node_modules.asar');
		assert.equal(typeof stream.pipe, 'function');
		stream.end();
	});
});
