/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Vite wrapper for the Knox sidebar webview.
 *
 * Not an esbuild media script: Vite cannot be dropped into esbuildMediaScripts.
 * compile-extension-media / watch-extension-media invoke this file the same way
 * as simple-browser's esbuild.webview.mts (--watch, --outputRoot).
 *
 * Output: extensions/knox/gui/assets/index.js + index.css (stable names).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const extDir = path.resolve(import.meta.dirname, '..');
const guiSrcDir = path.join(extDir, 'gui-src');
const defaultOutDir = path.join(extDir, 'gui');

function parseArgs(args: string[]): { isWatch: boolean; outDir: string } {
	let outDir = defaultOutDir;
	const outputRootIndex = args.indexOf('--outputRoot');
	if (outputRootIndex >= 0) {
		const outputRoot = args[outputRootIndex + 1];
		if (!outputRoot) {
			throw new Error('build-gui.mts: --outputRoot requires a path');
		}
		outDir = path.join(outputRoot, 'gui');
	}
	return {
		isWatch: args.includes('--watch'),
		outDir,
	};
}

function assertViteInstalled(): string {
	const viteEntry = path.join(guiSrcDir, 'node_modules', 'vite', 'dist', 'node', 'index.js');
	if (!fs.existsSync(viteEntry)) {
		throw new Error(
			`Knox GUI dependencies are missing. Run npm install in ${guiSrcDir} (or npm install at the repo root so postinstall covers extensions/knox/gui-src).`,
		);
	}
	return viteEntry;
}

function assertGuiAssets(outDir: string): void {
	const js = path.join(outDir, 'assets', 'index.js');
	const css = path.join(outDir, 'assets', 'index.css');
	const missing = [js, css].filter(p => !fs.existsSync(p));
	if (missing.length) {
		throw new Error(`Knox GUI build did not emit stable assets:\n${missing.join('\n')}`);
	}
}

async function main(): Promise<void> {
	const { isWatch, outDir } = parseArgs(process.argv.slice(2));
	const viteEntry = assertViteInstalled();
	const { build } = await import(pathToFileURL(viteEntry).href) as typeof import('vite');

	fs.mkdirSync(outDir, { recursive: true });

	const result = await build({
		configFile: path.join(guiSrcDir, 'vite.config.ts'),
		root: guiSrcDir,
		base: './',
		logLevel: 'info',
		build: {
			outDir,
			emptyOutDir: true,
			watch: isWatch ? {} : null,
		},
	});

	if (isWatch) {
		// vite.build({ watch }) returns a Rollup watcher and does not exit.
		const watcher = result as { on: (event: string, cb: (...args: unknown[]) => void) => void };
		watcher.on('event', (event: { code?: string; error?: Error }) => {
			if (event.code === 'END') {
				try {
					assertGuiAssets(outDir);
					console.log(`knox gui rebuilt -> ${outDir}`);
				} catch (err) {
					console.error(err);
				}
			} else if (event.code === 'ERROR') {
				console.error(event.error ?? event);
			}
		});
		return;
	}

	assertGuiAssets(outDir);
	console.log(`knox gui -> ${outDir}`);
}

try {
	await main();
} catch (err) {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
}
