/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'node:assert';
import * as path from 'node:path';

import {
	resolveCheckpointStoragePathFor,
	workspaceStorageKey,
} from '../checkpoints/store/workspaceStore';

suite('checkpoint storage path', () => {
	const globalCheckpointsPath = path.join('/tmp', 'fake-home', '.knox', 'checkpoints');
	const workspacePath = path.join('/tmp', 'demo-project');

	test('stores workspace checkpoints under ~/.knox, not the project root', () => {
		const resolved = resolveCheckpointStoragePathFor(workspacePath, { globalCheckpointsPath });
		assert.strictEqual(
			resolved,
			path.join(globalCheckpointsPath, 'workspaces', workspaceStorageKey(workspacePath)),
		);
		assert.ok(!resolved.includes('.knox-debug'));
		assert.ok(!resolved.startsWith(workspacePath));
	});

	test('falls back to the global checkpoints dir with no workspace', () => {
		assert.strictEqual(
			resolveCheckpointStoragePathFor(undefined, { globalCheckpointsPath }),
			globalCheckpointsPath,
		);
	});
});
