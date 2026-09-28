/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { execFileSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

const IMPORT_RE = /from\s+['"][^'"]*knox\/(core|gui|extensions|knoxdev)/;
const SKIP = new Set(['node_modules', 'out', 'out-build', 'dist', '.git']);
const TEXT_FILE_RE = /\.(ts|tsx|mts|cts|js|mjs|cjs|json|md|yml|yaml|sh|txt|html|css)$/i;
const HISTORY_REL_PATHS = new Set(['knox-native.md', 'CHANGELOG.md']);

/** A git-ignored directory is a local reference checkout, not part of the tree. */
function isGitIgnored(target: string): boolean {
	try {
		execFileSync('git', ['check-ignore', '-q', target], { cwd: process.cwd(), stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

function legacyPathMarkers(): string[] {
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

function walk(dir: string, files: string[], repoRoot: string, extensions: RegExp): void {
	if (!existsSync(dir)) {
		return;
	}
	for (const name of readdirSync(dir)) {
		// Electron's fs opens `.asar` files as archives and throws on invalid fixtures.
		if (SKIP.has(name) || name.startsWith('.') || name.endsWith('.asar')) {
			continue;
		}
		if (name === 'knox' && resolve(dir) === resolve(repoRoot)) {
			continue;
		}
		const full = join(dir, name);
		if (statSync(full).isDirectory()) {
			walk(full, files, repoRoot, extensions);
			continue;
		}
		if (extensions.test(name)) {
			files.push(full);
		}
	}
}

function rel(repoRoot: string, file: string): string {
	return relative(repoRoot, file).replace(/\\/g, '/');
}

suite('Knox native inventory gate (KN-207 / KN-390 / KN-391 / KN-392)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('extensions/ and src/ have no leftover product imports', () => {
		const root = process.cwd();
		const files: string[] = [];
		walk(join(root, 'extensions'), files, root, /\.(ts|tsx|mts|js|mjs|cts)$/);
		walk(join(root, 'src'), files, root, /\.(ts|tsx|mts|js|mjs|cts)$/);
		const hits = files.filter(file => IMPORT_RE.test(readFileSync(file, 'utf8'))).map(file => rel(root, file));
		assert.deepStrictEqual(hits, []);
	});

	test('living trees mention leftover paths only in knox-native.md and CHANGELOG.md', () => {
		const root = process.cwd();
		const files: string[] = [];
		walk(root, files, root, TEXT_FILE_RE);
		const markers = legacyPathMarkers();
		const hits = files.filter(file => {
			if (HISTORY_REL_PATHS.has(rel(root, file))) {
				return false;
			}
			const text = readFileSync(file, 'utf8');
			return markers.some(marker => text.includes(marker));
		}).map(file => rel(root, file));
		assert.deepStrictEqual(hits, []);
	});

	test('gulp and npm dirs do not point at leftover ./knox', () => {
		const root = process.cwd();
		const dirs = readFileSync(join(root, 'build/npm/dirs.ts'), 'utf8');
		const gulp = readFileSync(join(root, 'build/gulpfile.extensions.ts'), 'utf8');
		const leftoverRoot = 'knox';
		const quotedDirs = [...dirs.matchAll(/'([^']*)'/g)].map(match => match[1]);
		assert.ok(quotedDirs.includes('extensions/knox'));
		assert.ok(!quotedDirs.some(entry => entry === leftoverRoot || entry.startsWith(`${leftoverRoot}/`)));
		assert.ok(gulp.includes("path.join(root, 'extensions', 'knox'"));
		assert.ok(!/path\.join\(\s*root\s*,\s*(['"])knox\1/.test(gulp));
	});

	test('leftover product directory at repo root is gone', () => {
		const leftover = join(process.cwd(), 'knox');
		assert.ok(!existsSync(leftover) || isGitIgnored(leftover), 'KN-392: leftover product directory at repo root must be deleted');
	});
});
