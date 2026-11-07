/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createRequire } from 'module';
import path from 'path';

/**
 * Native TypeScript 7 CLI used by gulp compile, extension typecheck, and the
 * layers checker. Prefers tsrs (Rust). tsrs 0.23 has no Windows ARM64 package
 * (`@tsrs/win32-arm64` is still unpublished), so that host falls back to the
 * Go `typescript` launcher, which does ship `@typescript/typescript-win32-arm64`.
 *
 * `--fast` is tsrs-only. The Go fallback gets no extra args.
 */
const require = createRequire(import.meta.url);

export type NativeTscKind = 'tsrs' | 'typescript-native';

export interface NativeTscResolution {
	readonly kind: NativeTscKind;
	readonly path: string;
	readonly extraArgs: readonly string[];
}

export interface ResolveNativeTscOptions {
	readonly requireResolve?: (id: string) => string;
	readonly platform?: NodeJS.Platform | string;
	readonly arch?: string;
}

/** Optional-dependency names tsrs would load for this OS/CPU. */
export function tsrsPlatformPackageNames(os: string, cpu: string): string[] {
	if (os === 'linux') {
		return [`@tsrs/linux-${cpu}-gnu`, `@tsrs/linux-${cpu}-musl`];
	}
	return [`@tsrs/${os}-${cpu}`];
}

function packageRoot(requireResolve: (id: string) => string, id: string): string {
	return path.dirname(requireResolve(`${id}/package.json`));
}

function tryResolve(requireResolve: (id: string) => string, id: string): boolean {
	try {
		requireResolve(id);
		return true;
	} catch {
		return false;
	}
}

export function resolveNativeTsc(options: ResolveNativeTscOptions = {}): NativeTscResolution {
	const requireResolve = options.requireResolve ?? ((id: string) => require.resolve(id));
	const os = options.platform ?? process.platform;
	const cpu = options.arch ?? process.arch;
	const tsrsRoot = packageRoot(requireResolve, 'tsrs');
	const hasTsrsBinary = tsrsPlatformPackageNames(os, cpu).some(name => tryResolve(requireResolve, `${name}/package.json`));
	if (hasTsrsBinary) {
		return {
			kind: 'tsrs',
			path: path.join(tsrsRoot, 'lib', 'tsrs.js'),
			extraArgs: ['--fast'],
		};
	}

	return {
		kind: 'typescript-native',
		path: path.join(packageRoot(requireResolve, 'typescript'), 'lib', 'tsc.js'),
		extraArgs: [],
	};
}

const resolved = resolveNativeTsc();

export const nativeTscPath = resolved.path;
export const nativeTscExtraArgs = resolved.extraArgs;

if (resolved.kind === 'tsrs') {
	// gulpfile.editor.ts spawns `node ${nativeTscPath}` and inherits this process env.
	process.env.TSRS_FAST ??= '1';
} else {
	console.warn(`tsrs has no native binary for ${process.platform}-${process.arch}; using TypeScript 7 Go tsc (${nativeTscPath}).`);
}
