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

	return ['**', ...ripgrepExcludes, ...prebuildExcludes];
}
