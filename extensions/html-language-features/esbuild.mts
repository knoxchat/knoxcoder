/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'node:path';
import { run } from '../esbuild-extension-common.mts';

const extensionRoot = import.meta.dirname;

await Promise.all([
	// Build client
	run({
		platform: 'node',
		entryPoints: {
			'htmlClientMain': path.join(extensionRoot, 'client', 'src', 'node', 'htmlClientMain.ts'),
		},
		srcDir: path.join(extensionRoot, 'client', 'src'),
		outdir: path.join(extensionRoot, 'client', 'dist', 'node'),
		additionalOptions: {
			tsconfig: path.join(extensionRoot, 'client', 'tsconfig.json'),
		},
	}, process.argv),

	// Build server
	run({
		platform: 'node',
		format: 'esm',
		entryPoints: {
			'htmlServerMain': path.join(extensionRoot, 'server', 'src', 'node', 'htmlServerNodeMain.ts'),
		},
		srcDir: path.join(extensionRoot, 'server', 'src'),
		outdir: path.join(extensionRoot, 'server', 'dist', 'node'),
		additionalOptions: {
			tsconfig: path.join(extensionRoot, 'server', 'tsconfig.json'),
			external: ['vscode', 'typescript', 'fs'],
			banner: {
				// `@vscode/l10n` is bundled as CommonJS and still calls `require('fs')` internally.
				// `@typescript/typescript6` (bundled for script tags in HTML) also uses `__filename`/`__dirname`
				// at module init for filesystem case-sensitivity checks. Those CJS globals are missing in ESM.
				js: `import { createRequire } from 'module'; import { fileURLToPath } from 'url'; import { dirname } from 'path'; const require = createRequire(import.meta.url); const __filename = fileURLToPath(import.meta.url); const __dirname = dirname(__filename);`,
			},
		},
	}, process.argv),
]);
