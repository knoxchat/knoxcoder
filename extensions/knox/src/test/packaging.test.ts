/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { knoxExtensionRoot } from './paths';

suite('Knox packaging (tests are not runtime deps)', () => {
	test('host package.json does not depend on vitest or mocha', () => {
		const pkg = JSON.parse(
			fs.readFileSync(path.join(knoxExtensionRoot(), 'package.json'), 'utf8'),
		) as {
			dependencies?: Record<string, string>;
			optionalDependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		for (const name of ['vitest', 'mocha']) {
			assert.strictEqual(pkg.dependencies?.[name], undefined, name);
			assert.strictEqual(pkg.optionalDependencies?.[name], undefined, name);
		}
		assert.ok(pkg.devDependencies?.['@types/mocha'], '@types/mocha is a types-only devDependency');
	});

	test('GUI vitest stays a gui-src devDependency', () => {
		const guiPkg = JSON.parse(
			fs.readFileSync(path.join(knoxExtensionRoot(), 'gui-src', 'package.json'), 'utf8'),
		) as {
			scripts?: Record<string, string>;
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		assert.ok(guiPkg.scripts?.test?.includes('vitest'));
		assert.strictEqual(guiPkg.dependencies?.vitest, undefined);
		assert.ok(guiPkg.devDependencies?.vitest, 'vitest must be gui-src dev-only');
	});

	test('system identity is vscode.knox with desktop main, not a web extension', () => {
		const pkg = JSON.parse(
			fs.readFileSync(path.join(knoxExtensionRoot(), 'package.json'), 'utf8'),
		) as {
			name: string;
			publisher: string;
			main?: string;
			browser?: string;
		};
		assert.strictEqual(pkg.publisher, 'vscode');
		assert.strictEqual(pkg.name, 'knox');
		assert.ok(pkg.main, 'desktop host entry');
		assert.strictEqual(pkg.browser, undefined, 'no browser field so compile-web skips Knox');
	});

	test('.vscodeignore force-includes gui, dist, and sqlite .node', () => {
		const ignore = fs.readFileSync(path.join(knoxExtensionRoot(), '.vscodeignore'), 'utf8');
		assert.ok(ignore.includes('!gui/**'));
		assert.ok(ignore.includes('!dist/**'));
		assert.ok(ignore.includes('!dist/**/*.node'));
		assert.ok(ignore.includes('!build/Release/*.node'));
	});

	test('gitignore excludes Knox build outputs so Linux/Windows CI rebuilds them', () => {
		const gitignore = fs.readFileSync(
			path.join(knoxExtensionRoot(), '..', '..', '.gitignore'),
			'utf8',
		);
		assert.ok(gitignore.includes('extensions/knox/gui/'));
		assert.ok(gitignore.includes('extensions/knox/**/*.node'));
		assert.ok(gitignore.includes('extensions/knox/build/'));
		assert.ok(gitignore.includes('extensions/**/dist/'));
		assert.ok(gitignore.includes('/extensions/**/out/'));
		const extensionsTs = fs.readFileSync(
			path.join(knoxExtensionRoot(), '..', '..', 'build', 'lib', 'extensions.ts'),
			'utf8',
		);
		assert.ok(extensionsTs.includes('ensureKnoxPackagingArtifacts'));
	});

	test('nativeExtensions in the gulp packer lists knox', () => {
		const extensionsTs = fs.readFileSync(
			path.join(knoxExtensionRoot(), '..', '..', 'build', 'lib', 'extensions.ts'),
			'utf8',
		);
		const block = /export const nativeExtensions = \[([\s\S]*?)\]/.exec(extensionsTs);
		assert.ok(block, 'nativeExtensions export');
		assert.ok(block[1].includes("'knox'"), block[1]);
	});
});
