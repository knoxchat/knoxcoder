/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
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

const mxcArchitectures = ['x64', 'arm64'];

/**
 * Returns a glob filter that strips @microsoft/mxc-sdk `bin/<arch>` payload for
 * architectures other than the build target.
 */
export function getMxcExcludeFilter(arch: string): string[] {
	const target = mxcArchitectures.includes(arch) ? arch : undefined;
	const nonTargetArchitectures = mxcArchitectures.filter(a => a !== target);

	return [
		'**',
		...nonTargetArchitectures.map(a => `!**/node_modules/@microsoft/mxc-sdk/bin/${a}/**`),
	];
}

/**
 * Returns a glob filter that strips @vscode/ripgrep-universal bin directories
 * for architectures other than the build target.
 */
export function getRipgrepExcludeFilter(platform: string, arch: string): string[] {
	const { nodePlatform, nodeArch } = toNodePlatformArch(platform, arch);
	const target = `${nodePlatform}-${nodeArch}`;
	const nonTargetPlatforms = ripgrepUniversalPlatforms.filter(p => p !== target);

	const excludes = nonTargetPlatforms.map(p => `!**/node_modules/@vscode/ripgrep-universal/bin/${p}/**`);

	return ['**', ...excludes];
}

/**
 * foundry-local-sdk ships a prebuilt N-API addon (`foundry_local_napi.node`)
 * for every platform inside its tarball, and its native core libraries are
 * fetched per-RID into `foundry-local-core/<platform>-<arch>/` at install time.
 * The addon requires a newer glibc than VS Code's minimum supported Linux
 * distros, so we deliberately do NOT ship any of this native payload: it is
 * downloaded on demand at runtime (see foundryLocalRuntime.ts). Packaging the
 * multi-arch prebuilds also breaks cross-platform CI (rcedit on non-PE files,
 * dpkg-shlibdeps on foreign-arch ELFs).
 */
export function getFoundryLocalExcludeFilter(): string[] {
	return [
		'**',
		'!**/foundry-local-sdk/prebuilds/**',
		'!**/foundry-local-sdk/foundry-local-core/**',
	];
}
