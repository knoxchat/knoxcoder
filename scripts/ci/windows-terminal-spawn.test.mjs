/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { isDisallowedUpdateDownloadUrl } from './check-update-feeds.mjs';
import { PE_MACHINE, inspectWindowsTerminalBinaries, readPeMachineFromBuffer } from './windows-terminal-spawn.mjs';

function makePe(machine) {
	const buffer = Buffer.alloc(0x80);
	buffer[0] = 0x4d;
	buffer[1] = 0x5a;
	buffer.writeUInt32LE(0x40, 0x3c);
	buffer.write('PE\0\0', 0x40);
	buffer.writeUInt16LE(machine, 0x44);
	return buffer;
}

describe('windows-terminal-spawn PE inspection', () => {
	it('reads x64 and arm64 machine types', () => {
		assert.equal(readPeMachineFromBuffer(makePe(0x8664)).arch, 'x64');
		assert.equal(readPeMachineFromBuffer(makePe(0xaa64)).arch, 'arm64');
		assert.equal(PE_MACHINE[0x14c], 'ia32');
	});

	it('rejects non-PE buffers that would surface as Windows error 193', () => {
		assert.equal(readPeMachineFromBuffer(Buffer.from('npm.cmd')).ok, false);
		assert.equal(readPeMachineFromBuffer(Buffer.from([0x4d, 0x5a])).ok, false);
	});

	it('does not treat VS Code downloads as KnoxCoder terminal fixtures', () => {
		assert.equal(isDisallowedUpdateDownloadUrl('https://update.code.visualstudio.com/win32-x64/stable'), true);
	});

	it('skips Darwin node-pty stubs and requires target-arch ConPTY', () => {
		const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knox-win-pty-'));
		try {
			const darwinNode = path.join(rootDir, 'bin', 'darwin-arm64-148', 'node-pty.node');
			const x64Dir = path.join(rootDir, 'third_party', 'conpty', '1.0', 'win10-x64');
			const arm64Dir = path.join(rootDir, 'third_party', 'conpty', '1.0', 'win10-arm64');
			fs.mkdirSync(path.dirname(darwinNode), { recursive: true });
			fs.mkdirSync(x64Dir, { recursive: true });
			fs.mkdirSync(arm64Dir, { recursive: true });
			fs.writeFileSync(darwinNode, 'not a pe');
			fs.writeFileSync(path.join(x64Dir, 'conpty.dll'), makePe(0x8664));
			fs.writeFileSync(path.join(x64Dir, 'OpenConsole.exe'), makePe(0x8664));
			fs.writeFileSync(path.join(arm64Dir, 'conpty.dll'), makePe(0xaa64));
			fs.writeFileSync(path.join(arm64Dir, 'OpenConsole.exe'), makePe(0xaa64));

			const x64 = inspectWindowsTerminalBinaries(rootDir, 'x64');
			assert.equal(x64.problems.length, 0);
			assert.ok(x64.files.every(file => !file.filePath.includes('darwin-arm64')));
			assert.ok(x64.files.some(file => file.ok && file.arch === 'x64' && file.filePath.endsWith('conpty.dll')));

			const empty = inspectWindowsTerminalBinaries(path.join(rootDir, 'missing'), 'x64');
			assert.ok(empty.problems.some(problem => problem.includes('no Windows PE')));
		} finally {
			fs.rmSync(rootDir, { recursive: true, force: true });
		}
	});
});
