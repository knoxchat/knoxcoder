/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'node:test';
import { linuxPackageVersion, numericPackageVersion, versionFromKnoxCoderAssetName } from './packageVersion.ts';

suite('packageVersion', () => {
	test('linuxPackageVersion maps npm prerelease hyphens to ~', () => {
		assert.strictEqual(linuxPackageVersion('2.0.0'), '2.0.0');
		assert.strictEqual(linuxPackageVersion('2.0.0-beta'), '2.0.0~beta');
		assert.strictEqual(linuxPackageVersion('2.0.0-rc.1'), '2.0.0~rc.1');
		assert.strictEqual(linuxPackageVersion('2.0.0-beta.1'), '2.0.0~beta.1');
		assert.ok(!linuxPackageVersion('2.0.0-beta').includes('-'));
	});

	test('numericPackageVersion strips the prerelease suffix', () => {
		assert.strictEqual(numericPackageVersion('2.0.0'), '2.0.0');
		assert.strictEqual(numericPackageVersion('2.0.0-beta'), '2.0.0');
		assert.strictEqual(numericPackageVersion('2.0.0-beta.1'), '2.0.0');
	});

	test('versionFromKnoxCoderAssetName keeps prerelease and stops at platform', () => {
		assert.strictEqual(versionFromKnoxCoderAssetName('KnoxCoder-2.0.0-linux-arm64.tar.gz'), '2.0.0');
		assert.strictEqual(versionFromKnoxCoderAssetName('KnoxCoder-2.0.0-beta-linux-arm64.rpm'), '2.0.0-beta');
		assert.strictEqual(versionFromKnoxCoderAssetName('KnoxCoder-2.0.0-rc.1-win32-x64-user-setup.exe'), '2.0.0-rc.1');
		assert.strictEqual(versionFromKnoxCoderAssetName('KnoxCoder-2.0.0-beta-darwin-arm64.dmg'), '2.0.0-beta');
		assert.strictEqual(versionFromKnoxCoderAssetName('latest-linux-arm64.json'), undefined);
	});
});
