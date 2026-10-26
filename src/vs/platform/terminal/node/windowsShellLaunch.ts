/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from '../../../base/common/path.js';
import { isWindows } from '../../../base/common/platform.js';
import { IShellLaunchConfig } from '../common/terminal.js';

const WINDOWS_SCRIPT_HOST_EXTENSIONS = new Set(['.bat', '.cmd']);

/**
 * `CreateProcess` cannot launch `.cmd`/`.bat` files. Windows then reports
 * `ERROR_BAD_EXE_FORMAT` (193). Wrap those shells with `cmd.exe /d /c`.
 */
export function isWindowsScriptHostPath(filePath: string | undefined): boolean {
	if (!filePath) {
		return false;
	}

	return WINDOWS_SCRIPT_HOST_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function getWindowsCmdExePath(env: NodeJS.ProcessEnv = process.env): string {
	const windir = env.windir || 'C:\\Windows';
	const is32ProcessOn64Windows = Object.prototype.hasOwnProperty.call(env, 'PROCESSOR_ARCHITEW6432');
	return `${windir}\\${is32ProcessOn64Windows ? 'Sysnative' : 'System32'}\\cmd.exe`;
}

export function applyWindowsScriptHostRewrite(
	shellLaunchConfig: IShellLaunchConfig,
	env: NodeJS.ProcessEnv = process.env
): boolean {
	if (!isWindowsScriptHostPath(shellLaunchConfig.executable)) {
		return false;
	}

	const original = shellLaunchConfig.executable!;
	const originalArgs = shellLaunchConfig.args;
	shellLaunchConfig.executable = getWindowsCmdExePath(env);
	if (typeof originalArgs === 'string') {
		shellLaunchConfig.args = ['/d', '/c', original, originalArgs];
	} else {
		shellLaunchConfig.args = ['/d', '/c', original, ...(originalArgs ?? [])];
	}

	return true;
}

export function rewriteWindowsScriptHostLaunch(
	shellLaunchConfig: IShellLaunchConfig,
	env: NodeJS.ProcessEnv = process.env
): boolean {
	if (!isWindows) {
		return false;
	}

	return applyWindowsScriptHostRewrite(shellLaunchConfig, env);
}
