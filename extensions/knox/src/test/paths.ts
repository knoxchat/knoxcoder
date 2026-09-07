/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';

export function knoxExtensionRoot(): string {
	let dir = __dirname;
	while (dir !== path.dirname(dir)) {
		const pkgPath = path.join(dir, 'package.json');
		if (fs.existsSync(pkgPath)) {
			try {
				const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name?: string };
				if (pkg.name === 'knox') {
					return dir;
				}
			} catch {
				// keep walking
			}
		}
		dir = path.dirname(dir);
	}
	throw new Error('knox extension root not found from ' + __dirname);
}

export function knoxcoderRepoRoot(): string {
	return path.resolve(knoxExtensionRoot(), '..', '..');
}
