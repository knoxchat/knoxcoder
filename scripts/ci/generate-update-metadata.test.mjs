/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'generate-update-metadata.mjs',
);

function runMetadata(dir, extraArgs = []) {
	return spawnSync(
		process.execPath,
		[
			script,
			'--assets-dir',
			dir,
			'--out-dir',
			dir,
			...extraArgs,
		],
		{ encoding: 'utf8' },
	);
}

describe('generate-update-metadata', () => {
	it('writes sha256hash into latest-*.json and SHA256SUMS', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knox-update-meta-'));
		const asset = 'KnoxCoder-2.0.0-linux-x64.tar.gz';
		const body = Buffer.from('knox-update-fixture');
		fs.writeFileSync(path.join(dir, asset), body);
		const result = spawnSync(
			process.execPath,
			[
				script,
				'--assets-dir',
				dir,
				'--out-dir',
				dir,
				'--version',
				'2.0.0',
				'--tag',
				'v2.0.0',
				'--commit',
				'abc1234',
			],
			{ encoding: 'utf8' },
		);
		assert.equal(result.status, 0, result.stderr || result.stdout);
		const expected = crypto.createHash('sha256').update(body).digest('hex');
		const json = JSON.parse(
			fs.readFileSync(path.join(dir, 'latest-linux-x64.json'), 'utf8'),
		);
		assert.equal(json.sha256hash, expected);
		assert.equal(json.productVersion, '2.0.0');
		const sums = fs.readFileSync(path.join(dir, 'SHA256SUMS'), 'utf8');
		assert.match(sums, new RegExp(`${expected}  ${asset}`));
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('auto-detects 2.2.1 from the asset name and ignores a CI run tag', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knox-update-meta-'));
		const asset = 'KnoxCoder-2.2.1-win32-x64-user-setup.exe';
		fs.writeFileSync(path.join(dir, asset), Buffer.from('knox-2.2.1-setup'));
		const result = runMetadata(dir, ['--tag', 'v36-build.1', '--commit', 'deadbeef']);
		assert.equal(result.status, 0, result.stderr || result.stdout);
		const json = JSON.parse(
			fs.readFileSync(path.join(dir, 'latest-win32-x64-user.json'), 'utf8'),
		);
		assert.equal(json.productVersion, '2.2.1');
		assert.equal(
			json.url,
			'https://github.com/knoxchat/knoxcoder/releases/download/v2.2.1/KnoxCoder-2.2.1-win32-x64-user-setup.exe',
		);
		assert.match(result.stderr || '', /ignoring v36-build\.1/);
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
