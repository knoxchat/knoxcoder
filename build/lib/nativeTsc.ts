/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createRequire } from 'module';
import path from 'path';

/**
 * Absolute path to the tsrs (Rust TypeScript 7) launcher.
 *
 * `lib/tsrs.js` resolves the platform-specific native binary and execs it.
 * This replaces the Go `@typescript/native` (`lib/tsc.js`) compiler used previously.
 */
const require = createRequire(import.meta.url);

export const nativeTscPath = path.join(
	path.dirname(require.resolve('tsrs/package.json')),
	'lib',
	'tsrs.js',
);

/** tsrs performance preset. Safe on typecheck and emit. */
export const nativeTscExtraArgs = ['--fast'];

// gulpfile.editor.ts spawns `node ${nativeTscPath}` and inherits this process env.
process.env.TSRS_FAST ??= '1';
