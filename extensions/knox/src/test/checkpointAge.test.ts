/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'node:assert';

import { formatCheckpointAge, latestCheckpointCreated } from '../checkpoints/manager/checkpointAge';

suite('checkpointAge (CP-37)', () => {
	test('formats last-checkpoint age for the status bar', () => {
		const now = Date.parse('2026-08-18T12:00:00.000Z');
		assert.strictEqual(formatCheckpointAge(new Date(now - 5_000), now), '5s');
		assert.strictEqual(formatCheckpointAge(new Date(now - 3 * 60_000), now), '3m');
		assert.strictEqual(formatCheckpointAge(new Date(now - 2 * 3_600_000), now), '2h');
		assert.strictEqual(formatCheckpointAge(new Date(now - 3 * 86_400_000), now), '3d');
	});

	test('picks the newest checkpoint timestamp', () => {
		const latest = latestCheckpointCreated([
			{ created: new Date('2026-08-17T00:00:00.000Z') },
			{ created: new Date('2026-08-18T00:00:00.000Z') },
			{ created: new Date('2026-08-16T00:00:00.000Z') },
		]);
		assert.strictEqual(latest?.toISOString(), '2026-08-18T00:00:00.000Z');
		assert.strictEqual(latestCheckpointCreated([]), undefined);
	});
});
