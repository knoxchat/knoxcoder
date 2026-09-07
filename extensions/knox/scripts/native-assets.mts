/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Native / WASM assets for the Knox system extension (Phase 5).
 *
 * - sqlite3: rebuild against Electron's Node ABI, then place node_sqlite3.node
 *   next to the bundle so `bindings` can find it.
 * - tree-sitter: copy language WASMs + query files (no runtime download).
 * - node-pty is not copied; the host prefers vscode.env.appRoot.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const knoxExtDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(knoxExtDir, '..', '..');

function log(message: string): void {
	console.log(`[knox native] ${message}`);
}

function warn(message: string): void {
	console.warn(`[knox native] ${message}`);
}

function copyFile(src: string, dest: string): void {
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	fs.copyFileSync(src, dest);
}

function copyDir(src: string, dest: string): void {
	if (!fs.existsSync(src)) {
		return;
	}
	fs.mkdirSync(dest, { recursive: true });
	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		const from = path.join(src, entry.name);
		const to = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			copyDir(from, to);
		} else if (entry.isFile()) {
			copyFile(from, to);
		}
	}
}

export function readElectronTarget(): { electronVersion: string; distUrl: string } {
	const npmrc = fs.readFileSync(path.join(repoRoot, '.npmrc'), 'utf8');
	const electronVersion = /^target="(.*)"$/m.exec(npmrc)?.[1];
	if (!electronVersion) {
		throw new Error('Could not read Electron target from repo .npmrc');
	}
	const distUrl = /^disturl="(.*)"$/m.exec(npmrc)?.[1] ?? 'https://electronjs.org/headers';
	return { electronVersion, distUrl };
}

export function sqlite3BinaryPath(): string {
	return path.join(knoxExtDir, 'node_modules', 'sqlite3', 'build', 'Release', 'node_sqlite3.node');
}

/**
 * Rebuild sqlite3 for this OS + Electron ABI. Falls back to the N-API prebuild
 * already installed by npm if the Electron rebuild fails (sqlite3 6.x is N-API
 * v6, which usually loads in Electron anyway).
 */
export function rebuildSqlite3ForElectron(): string | undefined {
	const binary = sqlite3BinaryPath();
	const sqliteDir = path.join(knoxExtDir, 'node_modules', 'sqlite3');
	if (!fs.existsSync(sqliteDir)) {
		warn('sqlite3 is not installed; Memory Brain will be unavailable until npm install');
		return undefined;
	}

	const { electronVersion, distUrl } = readElectronTarget();
	const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
	log(`Rebuilding sqlite3 for Electron ${electronVersion} (${process.platform}-${process.arch})`);
	const result = spawnSync(npm, ['rebuild', 'sqlite3'], {
		cwd: knoxExtDir,
		stdio: 'inherit',
		env: {
			...process.env,
			npm_config_runtime: 'electron',
			npm_config_target: electronVersion,
			npm_config_disturl: distUrl,
			npm_config_arch: process.env.npm_config_arch || process.arch,
			npm_config_build_from_source: 'true',
		},
		shell: process.platform === 'win32',
	});

	if (result.status !== 0) {
		warn(`Electron sqlite3 rebuild exited ${result.status}; using existing N-API binary if present`);
	}

	if (fs.existsSync(binary)) {
		return binary;
	}
	warn(`node_sqlite3.node missing at ${binary}`);
	return undefined;
}

function copySqliteBinaryTo(destDir: string, source: string): void {
	const dest = path.join(destDir, 'node_sqlite3.node');
	copyFile(source, dest);
	// T9.2: Unix dlopen typically needs +x. Packaging also sets this via setExecutableBit.
	if (process.platform !== 'win32') {
		try {
			fs.chmodSync(dest, 0o755);
		} catch {
			// ignore (read-only dest)
		}
	}
}

export function placeSqlite3Binary(outDir: string, source: string): void {
	copySqliteBinaryTo(path.join(outDir, 'build', 'Release'), source);
	copySqliteBinaryTo(path.join(outDir, 'src', 'build', 'Release'), source);
	copySqliteBinaryTo(path.join(knoxExtDir, 'build', 'Release'), source);
	log(`Placed node_sqlite3.node next to dist/ and extension build/Release`);
}

function webTreeSitterWasm(): string | undefined {
	try {
		return require.resolve('web-tree-sitter/web-tree-sitter.wasm');
	} catch {
		const fallback = path.join(knoxExtDir, 'node_modules', 'web-tree-sitter', 'web-tree-sitter.wasm');
		return fs.existsSync(fallback) ? fallback : undefined;
	}
}

function treeSitterWasmsDir(): string | undefined {
	const candidates = [
		path.join(knoxExtDir, 'node_modules', 'tree-sitter-wasms', 'out'),
	];
	try {
		const pkg = path.dirname(require.resolve('tree-sitter-wasms/package.json'));
		candidates.unshift(path.join(pkg, 'out'));
	} catch {
		// optional until npm install lands the package
	}
	return candidates.find(dir => fs.existsSync(dir));
}

export function copyTreeSitterAssets(outDir: string): void {
	const wasm = webTreeSitterWasm();
	if (wasm) {
		copyFile(wasm, path.join(outDir, 'web-tree-sitter.wasm'));
		copyFile(wasm, path.join(outDir, 'src', 'web-tree-sitter.wasm'));
		log('Copied web-tree-sitter.wasm');
	} else {
		warn('web-tree-sitter.wasm not found');
	}

	const wasms = treeSitterWasmsDir();
	if (wasms) {
		copyDir(wasms, path.join(outDir, 'src', 'tree-sitter-wasms'));
		copyDir(wasms, path.join(outDir, 'tree-sitter-wasms'));
		log(`Copied tree-sitter language WASMs from ${wasms}`);
	} else {
		warn('tree-sitter-wasms not installed; language WASMs will be missing until npm install');
	}

	copyDir(path.join(knoxExtDir, 'tree-sitter'), path.join(outDir, 'tree-sitter'));
	copyDir(path.join(knoxExtDir, 'tag-qry'), path.join(outDir, 'tag-qry'));
}

/**
 * After esbuild: sqlite3 .node + tree-sitter assets. Does not copy node-pty.
 *
 * Electron sqlite3 rebuild runs in CI / `npm run rebuild-native` / when the
 * binary is missing, so local `compile-extension:knox` stays fast.
 */
export function copyKnoxNativeAssets(outDir: string, opts?: { rebuildSqlite?: boolean }): void {
	const binaryMissing = !fs.existsSync(sqlite3BinaryPath());
	const rebuild = opts?.rebuildSqlite === true
		|| process.env.KNOX_REBUILD_NATIVE === '1'
		|| process.env.CI === 'true'
		|| binaryMissing;
	const sqlite = rebuild
		? rebuildSqlite3ForElectron()
		: sqlite3BinaryPath();
	if (sqlite && fs.existsSync(sqlite)) {
		placeSqlite3Binary(outDir, sqlite);
	}
	copyTreeSitterAssets(outDir);
}
