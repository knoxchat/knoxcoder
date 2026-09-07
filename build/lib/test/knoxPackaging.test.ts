/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { suite, test } from 'node:test';
import { isWebExtension, isWebExtensionsOutputRoot, nativeExtensions } from '../extensions.ts';
import type { IExtensionManifest } from '../extensions.ts';

const repositoryRoot = path.join(import.meta.dirname, '../../..');
const knoxPackageJsonPath = path.join(repositoryRoot, 'extensions/knox/package.json');

suite('Knox packaging (Phase 9)', () => {

	test('nativeExtensions includes knox (packageNativeLocalExtensionsStream)', () => {
		assert.ok(nativeExtensions.includes('knox'));
		assert.ok(nativeExtensions.includes('git'));
	});

	test('Knox is not a web extension (main without browser)', () => {
		const manifest = JSON.parse(fs.readFileSync(knoxPackageJsonPath, 'utf8')) as IExtensionManifest;
		assert.ok(manifest.main, 'expected main');
		assert.strictEqual(manifest.browser, undefined);
		assert.strictEqual(isWebExtension(manifest), false);
	});

	test('vscode-web media output root skips Knox GUI', () => {
		assert.strictEqual(isWebExtensionsOutputRoot('.build/web/extensions'), true);
		assert.strictEqual(isWebExtensionsOutputRoot('.build/extensions'), false);
		assert.strictEqual(isWebExtensionsOutputRoot(undefined), false);
	});
});
