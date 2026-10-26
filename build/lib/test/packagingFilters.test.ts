/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { minimatch } from 'minimatch';
import { suite, test } from 'node:test';
import {
	getWrongArchNativeExcludeFilter,
	windowsNativeArchFromPath,
} from '../packagingFilters.ts';

function excludedBy(filePath: string, platform: string, arch: string): boolean {
	const globs = getWrongArchNativeExcludeFilter(platform, arch);
	return globs.some(glob => minimatch(filePath, glob.slice(1), { dot: true }));
}

suite('Windows native arch packaging filters', () => {
	test('reads napi, js-debug, and esbuild native names', () => {
		assert.equal(windowsNativeArchFromPath('crypt32-ia32-ICQ243Y3.node'), 'ia32');
		assert.equal(windowsNativeArchFromPath('crypt32-x64-DGNGT7PC.node'), 'x64');
		assert.equal(
			windowsNativeArchFromPath('extensions/ms-vscode.js-debug/src/win32-app-container-tokens.win32-arm64-msvc-4ZJZ3U55.node'),
			'arm64',
		);
		assert.equal(windowsNativeArchFromPath('kerberos-F63X3WJO.node'), undefined);
		assert.equal(windowsNativeArchFromPath('bin/win32-x64-148/node-pty.node'), 'x64');
	});

	test('x64 packages drop ia32 crypt32 and arm64 js-debug natives', () => {
		assert.equal(excludedBy('extensions/knox/dist/crypt32-ia32-ICQ243Y3.node', 'win32', 'x64'), true);
		assert.equal(excludedBy('extensions/knox/dist/crypt32-x64-DGNGT7PC.node', 'win32', 'x64'), false);
		assert.equal(
			excludedBy('extensions/ms-vscode.js-debug/src/win32-app-container-tokens.win32-arm64-msvc-4ZJZ3U55.node', 'win32', 'x64'),
			true,
		);
		assert.equal(
			excludedBy('extensions/ms-vscode.js-debug/src/win32-app-container-tokens.win32-x64-msvc-VCQE7GJP.node', 'win32', 'x64'),
			false,
		);
		assert.equal(excludedBy('node_modules/node-pty/bin/win32-x64-148/node-pty.node', 'win32', 'x64'), false);
		assert.deepEqual(getWrongArchNativeExcludeFilter('linux', 'x64'), []);
	});
});
