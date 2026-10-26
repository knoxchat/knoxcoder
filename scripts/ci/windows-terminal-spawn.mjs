/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Windows terminal diagnostics for KnoxCoder error 193 (ERROR_BAD_EXE_FORMAT).
 *
 * Inspects PE machine types of KnoxCoder.exe, node-pty native modules,
 * conpty.dll, and OpenConsole.exe. Optionally lists them; never downloads
 * Microsoft VS Code builds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PE_MACHINE = {
	0x14c: 'ia32',
	0x8664: 'x64',
	0xaa64: 'arm64',
};

export function readPeMachine(filePath) {
	const fd = fs.openSync(filePath, 'r');
	try {
		const header = Buffer.alloc(0x40);
		fs.readSync(fd, header, 0, header.length, 0);
		if (header[0] !== 0x4d || header[1] !== 0x5a) {
			return { ok: false, reason: 'not MZ' };
		}

		const peOffset = header.readUInt32LE(0x3c);
		const pe = Buffer.alloc(6);
		fs.readSync(fd, pe, 0, pe.length, peOffset);
		if (pe.toString('ascii', 0, 2) !== 'PE') {
			return { ok: false, reason: 'not PE' };
		}

		const machine = pe.readUInt16LE(4);
		return { ok: true, machine, arch: PE_MACHINE[machine] ?? `0x${machine.toString(16)}` };
	} finally {
		fs.closeSync(fd);
	}
}

export function readPeMachineFromBuffer(buffer) {
	if (!buffer || buffer.length < 0x46) {
		return { ok: false, reason: 'too short' };
	}
	if (buffer[0] !== 0x4d || buffer[1] !== 0x5a) {
		return { ok: false, reason: 'not MZ' };
	}

	const peOffset = buffer.readUInt32LE(0x3c);
	if (peOffset + 6 > buffer.length || buffer.toString('ascii', peOffset, peOffset + 2) !== 'PE') {
		return { ok: false, reason: 'not PE' };
	}

	const machine = buffer.readUInt16LE(peOffset + 4);
	return { ok: true, machine, arch: PE_MACHINE[machine] ?? `0x${machine.toString(16)}` };
}

function walk(dir, files = []) {
	if (!fs.existsSync(dir)) {
		return files;
	}

	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(full, files);
		} else {
			files.push(full);
		}
	}

	return files;
}

function interesting(filePath) {
	const name = path.basename(filePath).toLowerCase();
	return name === 'knoxcoder.exe'
		|| name === 'code.exe'
		|| name === 'conpty.dll'
		|| name === 'openconsole.exe'
		|| name.endsWith('.node');
}

function isOtherPlatformNativePath(filePath) {
	const normalized = filePath.replaceAll('\\', '/').toLowerCase();
	return /\/(?:bin\/)?(?:darwin|linux|alpine|freebsd|android)-[^/]*\//.test(normalized);
}

function shouldInspect(filePath, expectedArch) {
	if (!interesting(filePath) || isOtherPlatformNativePath(filePath)) {
		return false;
	}

	const normalized = filePath.replaceAll('\\', '/').toLowerCase();
	if (normalized.includes('/third_party/conpty/')) {
		return expectedArch ? normalized.includes(`/win10-${expectedArch.toLowerCase()}/`) : true;
	}

	return true;
}

function basenameLower(filePath) {
	return path.basename(filePath).toLowerCase();
}

export function inspectWindowsTerminalBinaries(rootDir, expectedArch) {
	const files = walk(rootDir).filter(filePath => shouldInspect(filePath, expectedArch));
	const problems = [];
	const inspected = [];
	for (const filePath of files) {
		const result = readPeMachine(filePath);
		const name = basenameLower(filePath);
		if (!result.ok && name.endsWith('.node')) {
			inspected.push({ filePath, skipped: true, ...result });
			continue;
		}

		inspected.push({ filePath, ...result });
		if (!result.ok) {
			problems.push(`${filePath}: ${result.reason}`);
			continue;
		}
		if (expectedArch && result.arch !== expectedArch) {
			problems.push(`${filePath}: arch ${result.arch} does not match expected ${expectedArch} (Windows error 193)`);
		}
	}

	const peFiles = inspected.filter(file => file.ok);
	if (peFiles.length === 0) {
		problems.push(`${rootDir}: no Windows PE terminal binaries found (would miss error 193)`);
	}

	const hasConpty = peFiles.some(file => basenameLower(file.filePath) === 'conpty.dll' && (!expectedArch || file.arch === expectedArch));
	const hasOpenConsole = peFiles.some(file => basenameLower(file.filePath) === 'openconsole.exe' && (!expectedArch || file.arch === expectedArch));
	if (!hasConpty || !hasOpenConsole) {
		problems.push(`${rootDir}: missing target-arch conpty.dll / OpenConsole.exe (Windows error 193)`);
	}

	return { files: inspected, problems };
}

function arg(name, fallback) {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 ? process.argv[index + 1] : fallback;
}

function flag(name) {
	return process.argv.includes(`--${name}`);
}

function defaultRoots() {
	const roots = [];
	const appDir = arg('app-dir');
	if (appDir) {
		roots.push(path.resolve(appDir));
	}

	const nodePty = arg('node-pty-dir', path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules', 'node-pty'));
	if (fs.existsSync(nodePty)) {
		roots.push(nodePty);
	}

	return roots;
}

function main() {
	const expectedArch = arg('arch', process.arch === 'arm64' ? 'arm64' : 'x64');
	const roots = defaultRoots();
	if (roots.length === 0) {
		console.error('No app-dir or node-pty directory to inspect');
		process.exit(1);
	}

	const allProblems = [];
	for (const rootDir of roots) {
		const { files, problems } = inspectWindowsTerminalBinaries(rootDir, expectedArch);
		console.log(`Inspected ${files.length} PE files under ${rootDir} (expected ${expectedArch})`);
		for (const file of files) {
			console.log(`  ${file.ok ? file.arch : file.reason}\t${file.filePath}`);
		}
		allProblems.push(...problems);
	}

	if (allProblems.length) {
		for (const problem of allProblems) {
			console.error(problem);
		}
		process.exit(1);
	}

	if (flag('spawn')) {
		if (process.platform !== 'win32') {
			console.log('Skipping cmd.exe spawn off Windows');
			return;
		}

		console.error('Spawn checks run from Electron unit tests (node-pty is Electron-ABI). Use scripts/test.bat.');
		if (flag('require-spawn')) {
			process.exit(1);
		}
	}
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	main();
}
