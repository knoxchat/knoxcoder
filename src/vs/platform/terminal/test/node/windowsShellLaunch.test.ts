/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IShellLaunchConfig } from '../../common/terminal.js';
import { applyWindowsScriptHostRewrite, getWindowsCmdExePath, isWindowsScriptHostPath } from '../../node/windowsShellLaunch.js';

suite('windowsShellLaunch', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('detects cmd/bat shells that CreateProcess cannot launch', () => {
		assert.strictEqual(isWindowsScriptHostPath('C:\\Windows\\System32\\cmd.exe'), false);
		assert.strictEqual(isWindowsScriptHostPath('C:\\Program Files\\Git\\git-bash.exe'), false);
		assert.strictEqual(isWindowsScriptHostPath('C:\\Program Files\\nodejs\\npm.cmd'), true);
		assert.strictEqual(isWindowsScriptHostPath('C:\\tools\\env.bat'), true);
		assert.strictEqual(isWindowsScriptHostPath(undefined), false);
	});

	test('uses Sysnative when a 32-bit process is running on 64-bit Windows', () => {
		assert.strictEqual(
			getWindowsCmdExePath({ windir: 'C:\\Windows' }),
			'C:\\Windows\\System32\\cmd.exe',
		);
		assert.strictEqual(
			getWindowsCmdExePath({ windir: 'C:\\Windows', PROCESSOR_ARCHITEW6432: 'AMD64' }),
			'C:\\Windows\\Sysnative\\cmd.exe',
		);
	});

	test('rewrites .cmd launches through cmd.exe to avoid error 193', () => {
		const config: IShellLaunchConfig = { executable: 'C:\\Program Files\\nodejs\\npm.cmd', args: ['test'] };
		assert.strictEqual(applyWindowsScriptHostRewrite(config, { windir: 'C:\\Windows' }), true);
		assert.strictEqual(config.executable, 'C:\\Windows\\System32\\cmd.exe');
		assert.deepStrictEqual(config.args, ['/d', '/c', 'C:\\Program Files\\nodejs\\npm.cmd', 'test']);
	});

	test('leaves PE shells unchanged', () => {
		const config: IShellLaunchConfig = { executable: 'C:\\Windows\\System32\\cmd.exe', args: [] };
		assert.strictEqual(applyWindowsScriptHostRewrite(config, { windir: 'C:\\Windows' }), false);
		assert.strictEqual(config.executable, 'C:\\Windows\\System32\\cmd.exe');
	});
});
