/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Size control for the native assets that `copy-native.mts` places in `dist/`.
 *
 * The desktop installers ship every byte of `extensions/knox/dist`, so anything that is not
 * needed at runtime on the target platform is filtered out here instead of being copied:
 *
 *   - tree-sitter grammars that no Knox code path can load,
 *   - node-pty prebuilds for other platforms, `.pdb` debug symbols, sources and build intermediates,
 *   - sqlite3 amalgamation sources and build intermediates.
 *
 * All predicates take a path *relative to the package root* using forward slashes
 * (`''` is the package root itself) and return `true` when the entry must be copied.
 * They are pure so `packaging.test.ts` can cover them without touching the file system.
 */

/**
 * Grammars loaded by `core/util/treeSitter.ts` (`tree-sitter-<name>.wasm`).
 *
 * MUST stay in sync with the `LanguageName` enum; `packaging.test.ts` fails when a language is
 * added to the enum without being listed here (that would silently break the repo map on
 * packaged builds, where a missing wasm just makes `getParserForFile` return `undefined`).
 */
export const SHIPPED_TREE_SITTER_LANGUAGES: readonly string[] = [
	'bash',
	'c',
	'c_sharp',
	'cpp',
	'css',
	'elisp',
	'elixir',
	'elm',
	'embedded_template',
	'go',
	'html',
	'java',
	'javascript',
	'json',
	'lua',
	'ocaml',
	'php',
	'python',
	'ql',
	'rescript',
	'ruby',
	'rust',
	'solidity',
	'systemrdl',
	'toml',
	'tsx',
	'typescript',
];

export function treeSitterWasmFileName(language: string): string {
	return `tree-sitter-${language}.wasm`;
}

/** `tree-sitter-wasms/out/*.wasm` entries worth shipping. */
export function shouldShipTreeSitterWasm(fileName: string): boolean {
	return SHIPPED_TREE_SITTER_LANGUAGES.some((language) => treeSitterWasmFileName(language) === fileName);
}

export interface NativeTarget {
	readonly platform: string;
	readonly arch: string;
}

/** Debug symbols and compiler/linker intermediates: never useful in a shipped extension. */
const BUILD_ARTIFACT_FILE = /\.(pdb|ipdb|iobj|obj|o|a|lib|exp|ilk|tlog|mk|map)$/i;
const BUILD_ARTIFACT_NAMES = new Set(['Makefile', '.forge-meta', 'config.gypi', 'gyp-mac-tool']);
const TEST_FILE = /\.test\.js$/;

function segments(rel: string): string[] {
	return rel === '' ? [] : rel.split('/');
}

function isBuildArtifact(name: string): boolean {
	return BUILD_ARTIFACT_FILE.test(name) || BUILD_ARTIFACT_NAMES.has(name);
}

/**
 * node-pty is an optional fallback for `builtin_pty_*` (VS Code's own ABI-matched copy is
 * preferred, see `nativePtyModuleCandidates`). It ships prebuilds for every platform and ~28 MB
 * of `.pdb` files per Windows architecture, so keep only what the current target can load:
 * `lib/`, `build/Release` (freshly rebuilt for Electron), `bin/<platform>-<arch>-<abi>` and
 * `prebuilds/<platform>-<arch>`.
 */
export function shouldCopyNodePtyEntry(rel: string, target: NativeTarget): boolean {
	const parts = segments(rel);
	if (parts.length === 0) {
		return true;
	}
	const [top, second, ...rest] = parts;
	const name = parts[parts.length - 1];
	const targetId = `${target.platform}-${target.arch}`;

	switch (top) {
		case 'package.json':
		case 'LICENSE':
			return parts.length === 1;
		case 'lib':
			return !isBuildArtifact(name) && !TEST_FILE.test(name) && !/^testUtils/.test(name);
		case 'build':
			if (second === undefined) {
				return true;
			}
			// Only build/Release; obj.target, .deps, node-addon-api stamps and *.mk are intermediates.
			if (second !== 'Release') {
				return false;
			}
			if (rest.length === 0) {
				return true;
			}
			return !['obj', 'obj.target', '.deps', 'node-addon-api'].includes(rest[0]) && !isBuildArtifact(name);
		case 'prebuilds':
			if (second === undefined) {
				return true;
			}
			return second === targetId && !isBuildArtifact(name);
		case 'bin':
			if (second === undefined) {
				return true;
			}
			return second.startsWith(`${targetId}-`) && !isBuildArtifact(name);
		default:
			// deps/, src/, scripts/, third_party/, typings/, node-addon-api/, binding.gyp, README.md, ...
			return false;
	}
}

/**
 * sqlite3 only needs its JS wrapper and the compiled binding. Its `deps/` folder holds the
 * SQLite amalgamation tarball, `src/` the C++ sources, and `build/` the compiler output.
 */
export function shouldCopySqliteEntry(rel: string): boolean {
	const parts = segments(rel);
	if (parts.length === 0) {
		return true;
	}
	const [top, second, ...rest] = parts;
	switch (top) {
		case 'package.json':
		case 'LICENSE':
			return parts.length === 1;
		case 'lib':
			return true;
		case 'build':
			if (second === undefined) {
				return true;
			}
			if (second !== 'Release') {
				return false;
			}
			return rest.length === 0 || (rest.length === 1 && rest[0].endsWith('.node'));
		default:
			return false;
	}
}
