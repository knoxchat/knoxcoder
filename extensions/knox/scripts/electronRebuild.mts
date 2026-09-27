/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * KN-383: rebuild sqlite3 + node-pty for this fork's Electron.
 *
 * `npm install` compiles against the *system* Node ABI (Node 24 → 137).
 * Electron 43.3.0 reports `process.versions.modules === "148"`. Copy-native
 * passes `forceABI` so `@electron/rebuild` still targets 148 if `node-abi`
 * lags a new Electron. Skip with `KNOX_SKIP_ELECTRON_REBUILD=1` when there is
 * no compiler or Electron headers.
 */

export const KNOX_ELECTRON_VERSION = '43.3.0';
export const KNOX_ELECTRON_ABI = 148;
export const KNOX_SKIP_ELECTRON_REBUILD = 'KNOX_SKIP_ELECTRON_REBUILD';
export const KNOX_FORCE_ELECTRON_REBUILD = 'KNOX_FORCE_ELECTRON_REBUILD';
export const KNOX_ELECTRON_REBUILD_MODULES = ['sqlite3', 'node-pty'] as const;

/** NODE_MODULE_VERSION for Electron releases this fork has shipped. */
export const KNOX_ELECTRON_ABI_BY_VERSION: Record<string, number> = {
	'43.3.0': 148,
};

export function readKnoxElectronVersion(pkg: {
	devDependencies?: { electron?: string };
	dependencies?: { electron?: string };
}): string {
	return pkg.devDependencies?.electron ?? pkg.dependencies?.electron ?? KNOX_ELECTRON_VERSION;
}

export function knoxElectronModulesAbi(electronVersion: string): number {
	return KNOX_ELECTRON_ABI_BY_VERSION[electronVersion] ?? KNOX_ELECTRON_ABI;
}

export function shouldSkipKnoxElectronRebuild(
	env: Record<string, string | undefined> = process.env,
): boolean {
	return env[KNOX_SKIP_ELECTRON_REBUILD] === '1';
}

export function shouldForceKnoxElectronRebuild(
	env: Record<string, string | undefined> = process.env,
): boolean {
	return env[KNOX_FORCE_ELECTRON_REBUILD] === '1';
}

export type KnoxElectronRebuildOptions = {
	buildPath: string;
	electronVersion: string;
	onlyModules: string[];
	force: boolean;
	forceABI: number;
	types: Array<'prod' | 'optional'>;
};

export function knoxElectronRebuildOptions(opts: {
	buildPath: string;
	electronVersion?: string;
	force?: boolean;
}): KnoxElectronRebuildOptions {
	const electronVersion = opts.electronVersion ?? KNOX_ELECTRON_VERSION;
	return {
		buildPath: opts.buildPath,
		electronVersion,
		onlyModules: [...KNOX_ELECTRON_REBUILD_MODULES],
		force: opts.force ?? false,
		forceABI: knoxElectronModulesAbi(electronVersion),
		types: ['prod', 'optional'],
	};
}
