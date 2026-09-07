/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { run } from '../esbuild-extension-common.mts';
import { copyKnoxNativeAssets } from './scripts/native-assets.mts';

const extDir = import.meta.dirname;
const srcDir = path.join(extDir, 'src');
const outDir = path.join(extDir, 'dist');
const require = createRequire(import.meta.url);

function copyXhrSyncWorker(destDir: string): void {
	let sourcePath: string;
	try {
		sourcePath = require.resolve('jsdom/lib/jsdom/living/xhr/xhr-sync-worker.js');
	} catch {
		return;
	}
	const destPath = path.join(destDir, 'xhr-sync-worker.js');
	fs.mkdirSync(destDir, { recursive: true });
	fs.copyFileSync(sourcePath, destPath);
}

function afterBundle(destDir: string): void {
	copyXhrSyncWorker(destDir);
	copyKnoxNativeAssets(destDir);
}

run({
	platform: 'node',
	entryPoints: {
		'src/extension': path.join(srcDir, 'extension.ts'),
	},
	srcDir,
	outdir: outDir,
	additionalWatchPaths: [
		path.join(extDir, 'core'),
		path.join(extDir, 'knoxdev-package', 'src'),
	],
	additionalOptions: {
		alias: {
			'core': path.join(extDir, 'core'),
			'knoxdev-package': path.join(extDir, 'knoxdev-package', 'src'),
		},
		loader: {
			'.node': 'file',
		},
		metafile: true,
		external: [
			'vscode',
			'esbuild',
			'sqlite3',
			// jsdom reads default-stylesheet.css via __dirname; bundling breaks that path.
			'jsdom',
			// T5.2: product node-pty from appRoot; do not copy into this extension.
			'node-pty',
			'mac-ca',
			'win-ca',
			'system-ca',
			'kerberos',
			'./xhr-sync-worker.js',
		],
		plugins: [
			{
				name: 'knox-drop-eval-harness',
				setup(build) {
					build.onResolve({ filter: /[\\/]core[\\/]eval([\\/]|$)/ }, (args) => ({
						path: args.path,
						namespace: 'knox-empty-eval',
					}));
					build.onLoad({ filter: /.*/, namespace: 'knox-empty-eval' }, () => ({
						contents: 'export default {};\n',
						loader: 'js',
					}));
				},
			},
			{
				name: 'knox-write-metafile',
				setup(build) {
					build.onEnd((result) => {
						if (!result.metafile) {
							return;
						}
						const dest = path.join(outDir, 'esbuild-meta.json');
						fs.mkdirSync(outDir, { recursive: true });
						fs.writeFileSync(dest, JSON.stringify(result.metafile));
					});
				},
			},
		],
	},
}, process.argv, afterBundle);
