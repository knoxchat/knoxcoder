/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Converts VS Code build platform/arch to the values that Node.js reports
 * at runtime via `process.platform` and `process.arch`.
 */
function toNodePlatformArch(platform: string, arch: string): { nodePlatform: string; nodeArch: string } {
	let nodePlatform = platform === 'alpine' ? 'linux' : platform;
	let nodeArch = arch;

	if (arch === 'armhf') {
		nodeArch = 'arm';
	} else if (arch === 'alpine') {
		nodePlatform = 'linux';
		nodeArch = 'x64';
	}

	return { nodePlatform, nodeArch };
}

const ripgrepUniversalPlatforms = [
	'darwin-arm64', 'darwin-x64',
	'linux-arm', 'linux-arm64', 'linux-ia32', 'linux-x64',
	'linux-ppc64', 'linux-riscv64', 'linux-s390x',
	'win32-arm64', 'win32-ia32', 'win32-x64',
];

// napi-prebuild / prebuildify folder names used by packages such as foundry-local-sdk.
const napiPrebuildDirs = [
	'darwin-arm64', 'darwin-x64',
	'linux-arm', 'linux-arm64', 'linux-ia32', 'linux-x64',
	'linuxmusl-arm', 'linuxmusl-arm64', 'linuxmusl-x64',
	'win32-arm64', 'win32-x64',
	'win32-arm64-msvc', 'win32-x64-msvc',
];

/**
 * Returns a glob filter that strips native binaries for architectures other
 * than the build target: @vscode/ripgrep-universal bins and npm `prebuilds/`
 * trees (e.g. foundry-local-sdk). Foreign-arch ELFs make rpmbuild's
 * `brp-strip` fail with "Unable to recognise the format of the input file".
 */
export function getRipgrepExcludeFilter(platform: string, arch: string): string[] {
	const { nodePlatform, nodeArch } = toNodePlatformArch(platform, arch);
	const target = `${nodePlatform}-${nodeArch}`;
	const keepPrebuilds = new Set([
		target,
		`${target}-msvc`,
	]);
	if (platform === 'alpine') {
		keepPrebuilds.add(`linuxmusl-${nodeArch}`);
	}

	const ripgrepExcludes = ripgrepUniversalPlatforms
		.filter(p => p !== target)
		.map(p => `!**/node_modules/@vscode/ripgrep-universal/bin/${p}/**`);
	const prebuildExcludes = napiPrebuildDirs
		.filter(dir => !keepPrebuilds.has(dir))
		.map(dir => `!**/prebuilds/${dir}/**`);

	return ['**', ...ripgrepExcludes, ...prebuildExcludes, ...getWrongArchNativeExcludeFilter(platform, arch)];
}

const WINDOWS_NATIVE_ARCHES = ['ia32', 'x64', 'arm64'] as const;
export type WindowsNativeArch = typeof WINDOWS_NATIVE_ARCHES[number];

/**
 * Arch encoded in a native path: napi `win32-<arch>`, js-debug
 * `*.win32-<arch>-msvc-*.node`, and esbuild file-loader names such as
 * `crypt32-ia32-<hash>.node`. Unnamed bindings (`kerberos-<hash>.node`)
 * return `undefined` so PE inspection remains the source of truth.
 */
export function windowsNativeArchFromPath(filePath: string): WindowsNativeArch | undefined {
	const normalized = filePath.replaceAll('\\', '/').toLowerCase();
	const win32 = /win32-(ia32|x64|arm64)(?=[/._-]|$)/.exec(normalized);
	if (win32) {
		return win32[1] as WindowsNativeArch;
	}

	const base = normalized.split('/').pop() ?? '';
	if (!base.endsWith('.node')) {
		return undefined;
	}
	const named = /(?:^|[._-])(ia32|x64|arm64)(?:[._-]|$)/.exec(base);
	return named ? named[1] as WindowsNativeArch : undefined;
}

/**
 * Optional Windows natives whose filename already names a different arch
 * than the package target. Loading them is Windows error 193; they also
 * make the PE machine-type gate fail.
 */
export function getWrongArchNativeExcludeFilter(platform: string, arch: string): string[] {
	if (platform !== 'win32') {
		return [];
	}

	const { nodeArch } = toNodePlatformArch(platform, arch);
	return WINDOWS_NATIVE_ARCHES
		.filter(nativeArch => nativeArch !== nodeArch)
		.flatMap(nativeArch => [
			`!**/*.win32-${nativeArch}*.node`,
			`!**/crypt32-${nativeArch}*.node`,
			`!**/*-${nativeArch}-*.node`,
			`!**/win32-${nativeArch}/**`,
			`!**/win32-${nativeArch}-*/**`,
		]);
}
