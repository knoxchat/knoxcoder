/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'node:assert';

import { generateCheckpointId, isCheckpointId } from '../checkpoints/checkpointId';

suite('checkpointId', () => {
	test('generateCheckpointId returns a UUID-based cp_ id', () => {
		const id = generateCheckpointId();
		assert.ok(id.startsWith('cp_'));
		assert.ok(isCheckpointId(id));
		assert.doesNotMatch(id, /^cp_\d+_/);
	});

	test('generated ids are unique', () => {
		const ids = new Set(Array.from({ length: 50 }, () => generateCheckpointId()));
		assert.strictEqual(ids.size, 50);
	});

	test('isCheckpointId rejects legacy timestamp ids and garbage', () => {
		assert.strictEqual(isCheckpointId('cp_1234567890_abc123def'), false);
		assert.strictEqual(isCheckpointId('not-an-id'), false);
		assert.strictEqual(isCheckpointId(''), false);
	});
});
