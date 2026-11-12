/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { existsSync } from 'fs';
import path from 'path';
import { suite, test } from 'node:test';
import { resolveNativeTsc, tsrsPlatformPackageNames } from './nativeTsc.ts';

function fakeResolve(installed: readonly string[]): (id: string) => string {
	const roots: Record<string, string> = {
		'tsrs/package.json': '/repo/node_modules/tsrs/package.json',
		'typescript/package.json': '/repo/node_modules/typescript/package.json',
	};
	for (const name of installed) {
		roots[`${name}/package.json`] = `/repo/node_modules/${name}/package.json`;
	}
	return (id: string) => {
		const resolved = roots[id];
		if (!resolved) {
			throw Object.assign(new Error(`Cannot find module '${id}'`), { code: 'MODULE_NOT_FOUND' });
		}
		return resolved;
	};
}

suite('nativeTsc', () => {
	test('tsrsPlatformPackageNames uses gnu/musl suffixes on Linux', () => {
		assert.deepStrictEqual(tsrsPlatformPackageNames('linux', 'arm64'), [
			'@tsrs/linux-arm64-gnu',
			'@tsrs/linux-arm64-musl',
		]);
		assert.deepStrictEqual(tsrsPlatformPackageNames('win32', 'arm64'), ['@tsrs/win32-arm64']);
		assert.deepStrictEqual(tsrsPlatformPackageNames('darwin', 'arm64'), ['@tsrs/darwin-arm64']);
	});

	test('uses tsrs when the platform package is installed', () => {
		const resolution = resolveNativeTsc({
			platform: 'darwin',
			arch: 'arm64',
			requireResolve: fakeResolve(['@tsrs/darwin-arm64']),
		});
		assert.strictEqual(resolution.kind, 'tsrs');
		assert.strictEqual(resolution.path, path.join('/repo/node_modules/tsrs', 'lib', 'tsrs.js'));
		assert.deepStrictEqual([...resolution.extraArgs], ['--fast']);
	});

	test('uses tsrs on Windows ARM64 when @tsrs/win32-arm64 is installed', () => {
		const resolution = resolveNativeTsc({
			platform: 'win32',
			arch: 'arm64',
			requireResolve: fakeResolve(['@tsrs/win32-arm64']),
		});
		assert.strictEqual(resolution.kind, 'tsrs');
		assert.strictEqual(resolution.path, path.join('/repo/node_modules/tsrs', 'lib', 'tsrs.js'));
		assert.deepStrictEqual([...resolution.extraArgs], ['--fast']);
	});

	test('falls back to TypeScript 7 Go tsc when the tsrs platform package is missing', () => {
		const resolution = resolveNativeTsc({
			platform: 'win32',
			arch: 'arm64',
			requireResolve: fakeResolve([]),
		});
		assert.strictEqual(resolution.kind, 'typescript-native');
		assert.strictEqual(resolution.path, path.join('/repo/node_modules/typescript', 'lib', 'tsc.js'));
		assert.deepStrictEqual([...resolution.extraArgs], []);
	});

	test('resolves tsrs on this machine when the host is a shipped desktop platform', () => {
		const resolution = resolveNativeTsc();
		const shipped = ['darwin', 'linux', 'win32'].includes(process.platform) && ['arm64', 'x64'].includes(process.arch);
		if (shipped) {
			assert.strictEqual(resolution.kind, 'tsrs');
			assert.deepStrictEqual([...resolution.extraArgs], ['--fast']);
		} else {
			assert.ok(resolution.kind === 'tsrs' || resolution.kind === 'typescript-native');
		}
		assert.ok(existsSync(resolution.path), `missing launcher ${resolution.path}`);
	});
});
