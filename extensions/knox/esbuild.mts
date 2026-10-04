/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Packaging + gulp bundle for the in-tree Knox extension.
 *
 * KN-200–202: host / core / knoxdev-package live under extensions/knox/src.
 * Dev compile (`gulp compile-extension:knox --copy-to-out`) also writes
 * `out/extension.js`, which `scripts/code.sh` loads through package.json `main`.
 *
 * KN-384: `fromLocal()` rewrites `main` `/out/` → `/dist/` when this file exists,
 * so the packaged outfile must be `dist/extension.js`. Product packaging is
 * gulp `compile-extension:knox` + `compile-extension-knox-native` only (this
 * script also copies natives). Knox is a `nativeExtensions` member, not a
 * `builtInExtensions` marketplace entry.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { run } from '../esbuild-extension-common.mts';
import { copyKnoxNativeAssets } from './scripts/copy-native.mts';
import { assertKnoxNativeInventory } from './scripts/inventory-gate.mts';
import {
	copyXhrSyncWorker,
	knoxBundlePlugins,
	knoxNodeModuleDirs,
} from './scripts/knox-esbuild-plugins.mts';

const extensionDir = import.meta.dirname;
const knoxCoreDir = path.join(extensionDir, 'src', 'core');
const knoxPkgDir = path.join(extensionDir, 'src', 'pkg');
const hostEntry = path.join(extensionDir, 'src', 'extension.ts');
const importMetaUrlShim = path.join(extensionDir, 'scripts', 'importMetaUrl.js');
const coreShim = path.join(extensionDir, 'scripts', 'core-package-shim.js');
const srcDir = path.join(extensionDir, 'src');
const outDir = path.join(extensionDir, 'dist');

const copyToOut = process.argv.includes('--copy-to-out');
const isDev = process.argv.includes('--dev');
const skipNative = process.argv.includes('--skip-native');

function nodeModuleDirs(): string[] {
	return knoxNodeModuleDirs(extensionDir);
}

async function copyDistToOut(distDir: string): Promise<void> {
	const dest = path.join(extensionDir, 'out');
	await fs.promises.mkdir(dest, { recursive: true });
	await fs.promises.cp(distDir, dest, { recursive: true });
}

await run({
	platform: 'node',
	entryPoints: {
		extension: hostEntry,
	},
	srcDir,
	outdir: outDir,
	additionalWatchPaths: [
		path.join(extensionDir, 'src'),
	],
	additionalOptions: {
		absWorkingDir: extensionDir,
		nodePaths: nodeModuleDirs(),
		external: ['vscode', 'sqlite3', 'node-pty', './xhr-sync-worker.js'],
		loader: { '.node': 'file', '.json': 'json' },
		inject: fs.existsSync(importMetaUrlShim) ? [importMetaUrlShim] : undefined,
		define: { 'import.meta.url': 'importMetaUrl' },
		supported: { 'dynamic-import': false },
		minify: !isDev,
		sourcemap: true,
		plugins: knoxBundlePlugins({ knoxCoreDir, knoxPkgDir, coreShim }),
	},
	beforeBuild: () => {
		assertKnoxNativeInventory();
		copyXhrSyncWorker(extensionDir, outDir);
		const configYaml = path.join(knoxPkgDir, 'config-yaml', 'index.ts');
		if (!fs.existsSync(configYaml)) {
			throw new Error(`Knox pkg is missing (${configYaml}). Expected KN-200 sources under extensions/knox/src/pkg.`);
		}
		const coreEntry = path.join(knoxCoreDir, 'core', 'index.ts');
		if (!fs.existsSync(coreEntry)) {
			throw new Error(`Knox core is missing (${coreEntry}). Expected KN-201 sources under extensions/knox/src/core.`);
		}
		if (!fs.existsSync(hostEntry)) {
			throw new Error(`Knox host entry not found: ${hostEntry}`);
		}
	},
}, process.argv, async (builtDir) => {
	copyXhrSyncWorker(extensionDir, builtDir);
	if (!skipNative) {
		await copyKnoxNativeAssets(builtDir);
	}
	if (copyToOut && !process.argv.includes('--outputRoot')) {
		await copyDistToOut(builtDir);
	}
	const bundle = path.join(builtDir, 'extension.js');
	if (!fs.existsSync(bundle)) {
		throw new Error(`Knox esbuild did not produce ${bundle}`);
	}
	console.log(`Knox host bundle: ${bundle}`);
});
