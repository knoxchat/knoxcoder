/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * KN-207: fail if fork-owned trees still import from the leftover product tree.
 * KN-390: fail if living trees still mention leftover path markers. Only
 * knox-native.md, knox-parity.md, and CHANGELOG.md may keep those strings as history.
 * KN-391: fail if gulp or npm dirs still point at leftover ./knox.
 * KN-392: fail if the leftover product directory at repo root still exists.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { assertNoLeftoverKnoxBuildPointers, leftoverKnoxRootNpmDir } from './packaging.mts';

const IMPORT_RE = /from\s+['"][^'"]*knox\/(core|gui|extensions|knoxdev)/;

const SKIP_DIR = new Set([
	'node_modules',
	'out',
	'out-build',
	'dist',
	'.git',
]);

const TEXT_FILE_RE = /\.(ts|tsx|mts|cts|js|mjs|cjs|json|md|yml|yaml|sh|txt|html|css)$/i;

const HISTORY_REL_PATHS = new Set([
	'knox-native.md',
	'knox-parity.md',
	'CHANGELOG.md',
]);

function defaultRepoRoot(): string {
	return path.resolve(import.meta.dirname, '../../..');
}

/** Leftover path markers, built so this file does not contain the literals. */
export function knoxLegacyPathMarkers(): string[] {
	return [
		['knox', 'core'].join('/'),
		['knox', 'gui'].join('/'),
		['knox', 'extensions'].join('/'),
		['knox', 'binary'].join('/'),
		['knox', 'knoxdev-package'].join('/'),
		['knox-native', 'impl'].join('-'),
		['copy', 'gui'].join('-'),
	];
}

function isRepoRootLeftoverTree(dir: string, name: string, repoRoot: string): boolean {
	return name === 'knox' && path.resolve(dir) === path.resolve(repoRoot);
}

function walk(dir: string, files: string[], repoRoot: string, extensions: RegExp): void {
	if (!fs.existsSync(dir)) {
		return;
	}
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (SKIP_DIR.has(entry.name) || entry.name.startsWith('.')) {
			continue;
		}
		if (entry.isDirectory() && isRepoRootLeftoverTree(dir, entry.name, repoRoot)) {
			continue;
		}
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(full, files, repoRoot, extensions);
			continue;
		}
		if (extensions.test(entry.name)) {
			files.push(full);
		}
	}
}

function rel(repoRoot: string, file: string): string {
	return path.relative(repoRoot, file).replace(/\\/g, '/');
}

export function findKnoxTreeImports(repoRoot: string): string[] {
	const files: string[] = [];
	walk(path.join(repoRoot, 'extensions'), files, repoRoot, /\.(ts|tsx|mts|js|mjs|cts)$/);
	walk(path.join(repoRoot, 'src'), files, repoRoot, /\.(ts|tsx|mts|js|mjs|cts)$/);
	const hits: string[] = [];
	for (const file of files) {
		const text = fs.readFileSync(file, 'utf8');
		if (IMPORT_RE.test(text)) {
			hits.push(rel(repoRoot, file));
		}
	}
	return hits.sort();
}

export function findLegacyKnoxPathMentions(repoRoot: string): string[] {
	const files: string[] = [];
	walk(repoRoot, files, repoRoot, TEXT_FILE_RE);
	const markers = knoxLegacyPathMarkers();
	const hits: string[] = [];
	for (const file of files) {
		if (HISTORY_REL_PATHS.has(rel(repoRoot, file))) {
			continue;
		}
		const text = fs.readFileSync(file, 'utf8');
		if (markers.some(marker => text.includes(marker))) {
			hits.push(rel(repoRoot, file));
		}
	}
	return hits.sort();
}

export function assertNoKnoxTreeImports(repoRoot = defaultRepoRoot()): void {
	const hits = findKnoxTreeImports(repoRoot);
	if (hits.length > 0) {
		throw new Error(`KN-207: leftover product imports remain:\n${hits.map(hit => `  ${hit}`).join('\n')}`);
	}
}

export function assertNoLegacyKnoxPathMentions(repoRoot = defaultRepoRoot()): void {
	const hits = findLegacyKnoxPathMentions(repoRoot);
	if (hits.length > 0) {
		throw new Error(
			`KN-390: leftover path mentions remain (only knox-native.md, knox-parity.md, and CHANGELOG.md are history):\n` +
			hits.map(hit => `  ${hit}`).join('\n'),
		);
	}
}

export function assertNoLeftoverKnoxGulpNpmPointers(repoRoot = defaultRepoRoot()): void {
	const dirsSource = fs.readFileSync(path.join(repoRoot, 'build', 'npm', 'dirs.ts'), 'utf8');
	const buildDir = path.join(repoRoot, 'build');
	const gulpSources = fs
		.readdirSync(buildDir)
		.filter((name) => /^gulpfile.*\.ts$/.test(name))
		.map((name) => fs.readFileSync(path.join(buildDir, name), 'utf8'));
	assertNoLeftoverKnoxBuildPointers({ dirsSource, gulpSources });
}

export function leftoverProductDirectoryPath(repoRoot: string): string {
	return path.join(repoRoot, leftoverKnoxRootNpmDir());
}

/** A git-ignored directory is a local reference checkout, not part of the tree. */
function isGitIgnored(repoRoot: string, target: string): boolean {
	try {
		execFileSync('git', ['check-ignore', '-q', target], { cwd: repoRoot, stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

export function leftoverProductDirectoryExists(repoRoot: string): boolean {
	const leftover = leftoverProductDirectoryPath(repoRoot);
	return fs.existsSync(leftover) && fs.statSync(leftover).isDirectory() && !isGitIgnored(repoRoot, leftover);
}

export function assertNoLeftoverKnoxDirectory(repoRoot = defaultRepoRoot()): void {
	if (leftoverProductDirectoryExists(repoRoot)) {
		throw new Error('KN-392: leftover product directory at repo root still exists — delete it');
	}
}

export function assertKnoxNativeInventory(repoRoot = defaultRepoRoot()): void {
	assertNoKnoxTreeImports(repoRoot);
	assertNoLegacyKnoxPathMentions(repoRoot);
	assertNoLeftoverKnoxGulpNpmPointers(repoRoot);
	assertNoLeftoverKnoxDirectory(repoRoot);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (invokedDirectly) {
	assertKnoxNativeInventory();
	console.log('KN-207/KN-390/KN-391/KN-392: no leftover product imports, path mentions, gulp/npm pointers, or leftover product directory');
}
