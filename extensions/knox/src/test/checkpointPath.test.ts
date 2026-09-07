/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'node:assert';
import * as path from 'node:path';

import {
	isUnsafeCheckpointRelativePath,
	tryResolveSandboxedWorkspacePath,
} from '../checkpoints/checkpointPath';

suite('checkpointPath sandbox', () => {
	suite('posix', () => {
		const root = '/Users/knox/proj';
		const posix = path.posix;

		test('allows a normal relative file', () => {
			const result = tryResolveSandboxedWorkspacePath(root, 'src/a.ts', posix);
			assert.deepStrictEqual(result, {
				ok: true,
				fullPath: '/Users/knox/proj/src/a.ts',
			});
		});

		test('rejects parent traversal', () => {
			const result = tryResolveSandboxedWorkspacePath(root, '../outside.txt', posix);
			assert.strictEqual(result.ok, false);
		});

		test('rejects nested traversal', () => {
			const result = tryResolveSandboxedWorkspacePath(
				root,
				'src/../../outside.txt',
				posix,
			);
			assert.strictEqual(result.ok, false);
		});

		test('rejects /etc/passwd', () => {
			const result = tryResolveSandboxedWorkspacePath(root, '/etc/passwd', posix);
			assert.strictEqual(result.ok, false);
		});

		test('rejects NUL bytes', () => {
			const result = tryResolveSandboxedWorkspacePath(root, 'src/\0a.ts', posix);
			assert.strictEqual(result.ok, false);
		});

		test('rejects empty path', () => {
			const result = tryResolveSandboxedWorkspacePath(root, '', posix);
			assert.strictEqual(result.ok, false);
		});
	});

	suite('win32', () => {
		const root = 'C:\\Users\\knox\\proj';
		const win32 = path.win32;

		test('allows a normal relative file', () => {
			const result = tryResolveSandboxedWorkspacePath(root, 'src\\a.ts', win32);
			assert.ok(result.ok);
			if (result.ok) {
				assert.strictEqual(result.fullPath, 'C:\\Users\\knox\\proj\\src\\a.ts');
			}
		});

		test('rejects parent traversal', () => {
			const result = tryResolveSandboxedWorkspacePath(
				root,
				'..\\outside.txt',
				win32,
			);
			assert.strictEqual(result.ok, false);
		});

		test('rejects C:\\ Windows paths', () => {
			const result = tryResolveSandboxedWorkspacePath(
				root,
				'C:\\Windows\\System32\\x',
				win32,
			);
			assert.strictEqual(result.ok, false);
		});

		test('rejects UNC paths', () => {
			const result = tryResolveSandboxedWorkspacePath(
				root,
				'\\\\server\\share\\file.txt',
				win32,
			);
			assert.strictEqual(result.ok, false);
		});

		test('isUnsafeCheckpointRelativePath matches sandbox failures', () => {
			assert.strictEqual(
				isUnsafeCheckpointRelativePath('..\\outside.txt', win32, root),
				true,
			);
			assert.strictEqual(
				isUnsafeCheckpointRelativePath('src\\ok.ts', win32, root),
				false,
			);
		});
	});
});
