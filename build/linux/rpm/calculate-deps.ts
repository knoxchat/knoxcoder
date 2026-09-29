/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'child_process';
import { constants, existsSync, statSync } from 'fs';
import { additionalDeps } from './dep-lists.ts';

export function generatePackageDeps(files: string[]): Set<string>[] {
	const dependencies: Set<string>[] = files.map(file => calculatePackageDeps(file));
	const additionalDepsSet = new Set(additionalDeps);
	dependencies.push(additionalDepsSet);
	return dependencies;
}

// Based on https://source.chromium.org/chromium/chromium/src/+/main:chrome/installer/linux/rpm/calculate_package_deps.py.
function calculatePackageDeps(binaryPath: string): Set<string> {
	if (!existsSync(binaryPath)) {
		// The tunnel CLI is mixed in after the desktop package step. Skip it
		// when it is absent so prepare-rpm can still finish.
		console.error('Tried to stat ' + binaryPath + ' but failed.');
		return new Set();
	}
	if (!(statSync(binaryPath).mode & constants.S_IXUSR)) {
		throw new Error(`Binary ${binaryPath} needs to have an executable bit set.`);
	}

	const findRequiresResult = spawnSync('/usr/lib/rpm/find-requires', { input: binaryPath + '\n' });
	if (findRequiresResult.status !== 0) {
		throw new Error(`find-requires failed with exit code ${findRequiresResult.status}.\nstderr: ${findRequiresResult.stderr}`);
	}

	const requires = new Set(findRequiresResult.stdout.toString('utf-8').trimEnd().split('\n'));
	return requires;
}
