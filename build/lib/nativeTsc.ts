/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createRequire } from 'module';
import path from 'path';

/**
 * Absolute path to the TypeScript 7 native (Go) compiler launcher.
 *
 * TS7 is installed under the `@typescript/native` alias at the repository root.
 * `lib/tsc.js` resolves the platform-specific native `tsc` binary and execs it —
 * this is the same fast Go compiler that `tsgo` used to invoke.
 */
const require = createRequire(import.meta.url);

export const nativeTscPath = path.join(
	path.dirname(require.resolve('@typescript/native/package.json')),
	'lib',
	'tsc.js',
);
