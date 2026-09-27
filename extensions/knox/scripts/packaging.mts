/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * KN-384: Knox is an in-tree native extension, not a marketplace builtin.
 *
 * Compile surface (gulp):
 *   - `compile-extension:knox` — esbuild.mts (JS bundle; copies natives)
 *   - `compile-extension-knox-native` — copy-native.mts (sqlite3, rg, pty, …)
 *
 * Product packaging (`compile-native-extensions-build`) includes `knox` via
 * `nativeExtensions` in build/lib/extensions.ts and runs the same esbuild.mts
 * in production mode. There is no `builtInExtensions` VSIX download.
 *
 * KN-391: gulp spawn cwd and `build/npm/dirs.ts` are `extensions/knox` only.
 * Do not add leftover `./knox` as an npm dir or join the leftover tree from repo root.
 */

export const KNOX_NATIVE_EXTENSION_NAME = 'knox';

export const KNOX_GULP_COMPILE_JS_TASK = 'compile-extension:knox';
export const KNOX_GULP_COMPILE_NATIVE_TASK = 'compile-extension-knox-native';
export const KNOX_GULP_COMPILE_TASKS = [
	KNOX_GULP_COMPILE_JS_TASK,
	KNOX_GULP_COMPILE_NATIVE_TASK,
] as const;

/** Removed in KN-204 / never a packaging path. */
export const KNOX_GULP_FORBIDDEN_TASKS = [
	'compile-extension-knox-gui',
	'compile-extension-knox-core',
	['copy', 'gui'].join('-'),
] as const;

export function isKnoxMarketplaceBuiltinName(name: string | undefined | null): boolean {
	if (!name) {
		return false;
	}
	const n = name.toLowerCase();
	return n === 'knox' || n === 'vscode.knox' || n.includes('knoxchat');
}

export function knoxMarketplaceBuiltinNames(
	extensions: Array<{ name?: string }>,
): string[] {
	return extensions
		.map((entry) => entry.name)
		.filter((name): name is string => isKnoxMarketplaceBuiltinName(name));
}

export function assertNoKnoxMarketplaceBuiltins(product: {
	builtInExtensions?: Array<{ name?: string }>;
	webBuiltInExtensions?: Array<{ name?: string }>;
}): void {
	const hit = knoxMarketplaceBuiltinNames([
		...(product.builtInExtensions ?? []),
		...(product.webBuiltInExtensions ?? []),
	]);
	if (hit.length > 0) {
		throw new Error(
			`KN-384: Knox is an in-tree nativeExtensions member '${KNOX_NATIVE_EXTENSION_NAME}'; ` +
			`remove ${hit.join(', ')} from product.json builtInExtensions.`,
		);
	}
}

export function nativeExtensionsIncludesKnox(names: readonly string[]): boolean {
	return names.includes(KNOX_NATIVE_EXTENSION_NAME);
}

/**
 * Generic tsgo typecheck is for other esbuild extensions. Knox is gulp
 * `compile-extension:knox` + `compile-extension-knox-native` only.
 */
export function shouldSkipGenericTsgoForExtension(extensionName: string): boolean {
	return extensionName === KNOX_NATIVE_EXTENSION_NAME;
}

function ignoreLines(ignoreFile: string): string[] {
	return ignoreFile
		.split(/\r?\n/)
		.map((line) => line.replace(/#.*$/, '').trim())
		.filter(Boolean);
}

/**
 * vsce treats `.vscodeignore` like gitignore. Unrooted `node_modules/**`
 * would drop sqlite3 / ripgrep / node-pty copied into `dist/node_modules`.
 */
export function vscodeIgnoreAllowsPackagedNatives(ignoreFile: string): boolean {
	const lines = ignoreLines(ignoreFile);
	const unrootedNodeModules = lines.some(
		(line) =>
			line === 'node_modules/**' ||
			line === 'node_modules' ||
			line === '**/node_modules/**',
	);
	const rootedNodeModules = lines.some(
		(line) => line === '/node_modules/**' || line === '/node_modules',
	);
	const reincludeDist = lines.some(
		(line) => line === '!dist/node_modules/**' || line === '!dist/**',
	);
	if (unrootedNodeModules && !reincludeDist) {
		return false;
	}
	return rootedNodeModules || reincludeDist || !unrootedNodeModules;
}

export function gulpFileHasKnoxPackagingTasks(gulpSource: string): boolean {
	const hasRequired = KNOX_GULP_COMPILE_TASKS.every((taskName) =>
		gulpSource.includes(`task.define('${taskName}'`),
	);
	const hasForbidden = KNOX_GULP_FORBIDDEN_TASKS.some((taskName) =>
		gulpSource.includes(`task.define('${taskName}'`),
	);
	return hasRequired && !hasForbidden;
}

export function gulpCompilationsExcludesKnoxTsconfig(gulpSource: string): boolean {
	return !/['"]extensions\/knox\/tsconfig\.json['"]/.test(gulpSource);
}

export function nativeExtensionsSourceIncludesKnox(extensionsTs: string): boolean {
	const block = extensionsTs.match(/export const nativeExtensions\s*=\s*\[([\s\S]*?)\]/);
	if (!block) {
		return false;
	}
	return /['"]knox['"]/.test(block[1]);
}

/**
 * KN-391: npm install + gulp compile only from the fork tree.
 * The leftover product directory at the repo root is not an npm dir and
 * gulp must not `path.join(root, 'knox')` (that is a different path than
 * `path.join(root, 'extensions', 'knox')`).
 */
export const KNOX_FORK_NPM_DIR = 'extensions/knox';

export function leftoverKnoxRootNpmDir(): string {
	return 'knox';
}

/** Leftover product npm dirs, built so this file does not contain KN-390 literals. */
export function leftoverKnoxNpmDirNames(): string[] {
	return [
		leftoverKnoxRootNpmDir(),
		['knox', 'core'].join('/'),
		['knox', 'gui'].join('/'),
		['knox', 'extensions'].join('/'),
		['knox', 'extensions', 'vscode'].join('/'),
		['knox', 'binary'].join('/'),
		['knox', 'knoxdev-package'].join('/'),
	];
}

export function parseQuotedNpmDirs(dirsSource: string): string[] {
	const block = dirsSource.match(/export const dirs\s*=\s*\[([\s\S]*?)\];/);
	if (!block) {
		return [];
	}
	return [...block[1].matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

export function normalizeNpmDirEntry(entry: string): string {
	return entry.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function npmDirEntriesPointAtLeftoverKnox(entries: readonly string[]): string[] {
	const leftoverRoot = leftoverKnoxRootNpmDir();
	return entries.filter((entry) => {
		const normalized = normalizeNpmDirEntry(entry);
		return normalized === leftoverRoot || normalized.startsWith(`${leftoverRoot}/`);
	});
}

export function npmDirsExcludeLeftoverKnox(dirsSource: string): boolean {
	const entries = parseQuotedNpmDirs(dirsSource);
	return entries.includes(KNOX_FORK_NPM_DIR) && npmDirEntriesPointAtLeftoverKnox(entries).length === 0;
}

export function gulpJoinsLeftoverKnoxRoot(source: string): boolean {
	return /path\.join\(\s*root\s*,\s*(['"])knox\1/.test(source);
}

export function gulpSpawnsFromForkKnox(source: string): boolean {
	return source.includes("path.join(root, 'extensions', 'knox'");
}

export function gulpDefinesForbiddenKnoxTasks(source: string): boolean {
	return KNOX_GULP_FORBIDDEN_TASKS.some((taskName) =>
		source.includes(`task.define('${taskName}'`),
	);
}

export function assertNoLeftoverKnoxBuildPointers(input: {
	dirsSource: string;
	gulpSources: readonly string[];
}): void {
	const entries = parseQuotedNpmDirs(input.dirsSource);
	if (!entries.includes(KNOX_FORK_NPM_DIR)) {
		throw new Error(`KN-391: build/npm/dirs.ts must include '${KNOX_FORK_NPM_DIR}'`);
	}
	const leftoverDirs = npmDirEntriesPointAtLeftoverKnox(entries);
	if (leftoverDirs.length > 0) {
		throw new Error(
			`KN-391: npm dirs still point at leftover ./knox: ${leftoverDirs.join(', ')}`,
		);
	}
	for (const gulpSource of input.gulpSources) {
		if (gulpJoinsLeftoverKnoxRoot(gulpSource)) {
			throw new Error("KN-391: gulp still path.join(root, 'knox') — leftover ./knox pointer");
		}
		if (gulpDefinesForbiddenKnoxTasks(gulpSource)) {
			throw new Error('KN-391: leftover gulp task that pointed at ./knox is still defined');
		}
	}
	if (!input.gulpSources.some((source) => gulpSpawnsFromForkKnox(source))) {
		throw new Error(`KN-391: gulp must spawn Knox scripts from ${KNOX_FORK_NPM_DIR}`);
	}
}
