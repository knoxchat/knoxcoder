/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * KN-203 / KN-365 / KN-383 / KN-384: copy sqlite3, ripgrep, tree-sitter wasm, optional
 * node-pty, esbuild, bundled skills, and tree-sitter queries into the Knox
 * bundle directory. Sources are extensions/knox or the repo root — never ./knox.
 * The workspace (Remote-SSH) copy must include these addons; knox is a
 * nativeExtensions member so REH packages them per platform (not a
 * product.json builtInExtensions marketplace VSIX).
 *
 * KN-383: sqlite3 + node-pty are rebuilt for this fork's Electron
 * (43.3.0 → ABI 148) unless KNOX_SKIP_ELECTRON_REBUILD=1.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	KNOX_ELECTRON_VERSION,
	KNOX_SKIP_ELECTRON_REBUILD,
	knoxElectronRebuildOptions,
	readKnoxElectronVersion,
	shouldForceKnoxElectronRebuild,
	shouldSkipKnoxElectronRebuild,
} from './electronRebuild.mts';

const extensionDir = path.dirname(import.meta.dirname);
const repoRoot = path.dirname(path.dirname(extensionDir));

const ELECTRON_VERSION = readElectronVersion();

function readElectronVersion(): string {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
			devDependencies?: { electron?: string };
			dependencies?: { electron?: string };
		};
		return readKnoxElectronVersion(pkg);
	} catch {
		return KNOX_ELECTRON_VERSION;
	}
}

function copyDir(source: string, dest: string): void {
	fs.mkdirSync(dest, { recursive: true });
	fs.cpSync(source, dest, { recursive: true, dereference: true });
}

function copyFile(source: string, dest: string): void {
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	fs.copyFileSync(source, dest);
}

function firstExisting(candidates: string[]): string | undefined {
	return candidates.find((candidate) => fs.existsSync(candidate));
}

function sqliteBindingPath(moduleDir: string): string {
	return path.join(moduleDir, 'build', 'Release', 'node_sqlite3.node');
}

async function rebuildNativeForElectron(): Promise<void> {
	if (shouldSkipKnoxElectronRebuild()) {
		console.log(`Knox native: skipping @electron/rebuild (${KNOX_SKIP_ELECTRON_REBUILD}=1)`);
		return;
	}
	const rebuildEntry = path.join(extensionDir, 'node_modules', '@electron', 'rebuild', 'lib', 'main.js');
	if (!fs.existsSync(rebuildEntry)) {
		console.warn('Knox native: @electron/rebuild not found at', rebuildEntry);
		return;
	}
	const options = knoxElectronRebuildOptions({
		buildPath: extensionDir,
		electronVersion: ELECTRON_VERSION,
		force: shouldForceKnoxElectronRebuild(),
	});
	console.log(
		`Knox native: @electron/rebuild ${options.onlyModules.join(',')} for Electron ${options.electronVersion} (ABI ${options.forceABI})`,
	);
	const { rebuild } = await import(pathToFileURL(rebuildEntry).href) as {
		rebuild: (opts: typeof options) => Promise<void>;
	};
	await rebuild(options);
}

function copySqlite(destDir: string): void {
	const source = firstExisting([
		path.join(extensionDir, 'node_modules', 'sqlite3'),
	].filter((dir) => fs.existsSync(sqliteBindingPath(dir))));
	if (!source) {
		throw new Error(
			'Knox native: sqlite3 node_sqlite3.node not found. npm install sqlite3 in extensions/knox, then rebuild.',
		);
	}
	const dest = path.join(destDir, 'node_modules', 'sqlite3');
	fs.rmSync(dest, { recursive: true, force: true });
	copyDir(source, dest);
	if (!fs.existsSync(sqliteBindingPath(dest))) {
		throw new Error(`Knox native: sqlite3 copy is missing ${sqliteBindingPath(dest)}`);
	}
	console.log('Knox native: sqlite3 →', path.relative(extensionDir, sqliteBindingPath(dest)));
}

function copyRipgrep(destDir: string): void {
	const exe = process.platform === 'win32' ? 'rg.exe' : 'rg';
	const platformPkg = `@vscode/ripgrep-${process.platform}-${process.arch}`;
	const source = firstExisting([
		path.join(extensionDir, 'node_modules', platformPkg, 'bin', exe),
		path.join(extensionDir, 'node_modules', '@vscode', 'ripgrep', 'bin', exe),
		path.join(repoRoot, 'node_modules', '@vscode', 'ripgrep', 'bin', exe),
		path.join(repoRoot, 'node_modules', '@vscode', 'ripgrep-universal', 'bin', `${process.platform}-${process.arch}`, exe),
	]);
	if (!source) {
		throw new Error(`Knox native: ripgrep binary ${exe} not found for ${process.platform}-${process.arch}`);
	}
	const dest = path.join(destDir, 'node_modules', '@vscode', 'ripgrep', 'bin', exe);
	copyFile(source, dest);
	if (process.platform !== 'win32') {
		fs.chmodSync(dest, 0o755);
	}
	console.log('Knox native: ripgrep →', path.relative(extensionDir, dest));
}

function copyTreeSitter(destDir: string): void {
	const wasmRuntime = firstExisting([
		path.join(extensionDir, 'node_modules', 'web-tree-sitter', 'web-tree-sitter.wasm'),
		path.join(extensionDir, 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm'),
	]);
	if (!wasmRuntime) {
		throw new Error('Knox native: web-tree-sitter wasm not found in extensions/knox/node_modules');
	}
	copyFile(wasmRuntime, path.join(destDir, 'tree-sitter.wasm'));
	copyFile(wasmRuntime, path.join(destDir, 'web-tree-sitter.wasm'));

	const wasmsSrc = path.join(extensionDir, 'node_modules', 'tree-sitter-wasms', 'out');
	if (!fs.existsSync(wasmsSrc)) {
		throw new Error(`Knox native: tree-sitter-wasms not found at ${wasmsSrc}`);
	}
	const wasmsDest = path.join(destDir, 'tree-sitter-wasms');
	fs.rmSync(wasmsDest, { recursive: true, force: true });
	copyDir(wasmsSrc, wasmsDest);
	console.log('Knox native: tree-sitter wasm →', path.relative(extensionDir, destDir));
}

function copyNodePty(destDir: string): void {
	const source = firstExisting([
		path.join(extensionDir, 'node_modules', 'node-pty'),
	]);
	if (!source) {
		console.warn('Knox native: node-pty not installed; builtin_pty_* will use piped stdin or the workbench module');
		return;
	}
	const dest = path.join(destDir, 'node_modules', 'node-pty');
	fs.rmSync(dest, { recursive: true, force: true });
	copyDir(source, dest);
	console.log('Knox native: node-pty →', path.relative(extensionDir, dest));
}

function copyEsbuild(destDir: string): void {
	const esbuildSrc = firstExisting([
		path.join(extensionDir, 'node_modules', 'esbuild'),
		path.join(repoRoot, 'node_modules', 'esbuild'),
	]);
	const platformId = `${process.platform}-${process.arch}`;
	const platformSrc = firstExisting([
		path.join(extensionDir, 'node_modules', '@esbuild', platformId),
		path.join(repoRoot, 'node_modules', '@esbuild', platformId),
	]);
	if (!esbuildSrc) {
		console.warn('Knox native: esbuild package not found; require("esbuild") will fail if the host shells it');
		return;
	}
	const esbuildDest = path.join(destDir, 'node_modules', 'esbuild');
	fs.rmSync(esbuildDest, { recursive: true, force: true });
	copyDir(esbuildSrc, esbuildDest);
	if (platformSrc) {
		const platformDest = path.join(destDir, 'node_modules', '@esbuild', platformId);
		fs.rmSync(platformDest, { recursive: true, force: true });
		copyDir(platformSrc, platformDest);
	}
	console.log('Knox native: esbuild →', path.relative(extensionDir, esbuildDest));
}

function copyBundledSkills(destDir: string): void {
	const source = path.join(extensionDir, 'src', 'core', 'skills', 'bundled');
	if (!fs.existsSync(source)) {
		throw new Error(`Knox native: bundled skills missing at ${source}`);
	}
	const dest = path.join(destDir, 'bundled');
	fs.rmSync(dest, { recursive: true, force: true });
	copyDir(source, dest);
	console.log('Knox native: bundled skills →', path.relative(extensionDir, dest));
}

export async function copyKnoxNativeAssets(destDir: string): Promise<void> {
	fs.mkdirSync(destDir, { recursive: true });
	try {
		await rebuildNativeForElectron();
	} catch (error) {
		console.warn(
			'Knox native: @electron/rebuild failed, using existing sqlite3/node-pty bindings:',
			error instanceof Error ? error.message : error,
		);
	}
	copySqlite(destDir);
	copyRipgrep(destDir);
	copyTreeSitter(destDir);
	copyNodePty(destDir);
	copyEsbuild(destDir);
	copyBundledSkills(destDir);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
	const dest = process.argv[2]
		? path.resolve(process.argv[2])
		: path.join(extensionDir, 'dist');
	await copyKnoxNativeAssets(dest);
}
