/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const extensionsRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(extensionsRoot, 'node_modules', 'typescript');

async function resolvePlatformLibDir() {
	const getExePathModule = await import(pathToFileURL(path.join(root, 'lib', 'getExePath.js')));
	const getExePath = getExePathModule.default;
	const exePath = getExePath();
	return path.dirname(exePath);
}

async function copyTypeScriptLibFiles() {
	const platformLibDir = await resolvePlatformLibDir();
	const libRoot = path.join(root, 'lib');
	await fs.promises.mkdir(libRoot, { recursive: true });

	for (const name of await fs.promises.readdir(platformLibDir)) {
		if (name.endsWith('.d.ts') || name === 'typesMap.json') {
			await fs.promises.copyFile(path.join(platformLibDir, name), path.join(libRoot, name));
		}
	}

	// TypeScript 7 does not ship the JS compiler API; copy it from the compatibility package.
	const ts6Lib = path.join(extensionsRoot, 'node_modules', '@typescript', 'typescript6', 'lib');
	for (const file of ['typescript.js', 'typescript.d.ts']) {
		const src = path.join(ts6Lib, file);
		if (fs.existsSync(src)) {
			await fs.promises.copyFile(src, path.join(libRoot, file));
		}
	}
}

function processRoot() {
	const toKeep = new Set([
		'lib',
		'package.json',
	]);
	for (const name of fs.readdirSync(root)) {
		if (!toKeep.has(name)) {
			const filePath = path.join(root, name);
			console.log(`Removed ${filePath}`);
			fs.rmSync(filePath, { recursive: true });
		}
	}
}

function processLib() {
	const toDelete = new Set([
		'tsc.js',
		'_tsc.js',
		'tsc6.js',
		'_tsc6.js',

		'typescriptServices.js',
		'_typescriptServices.js',
	]);

	const libRoot = path.join(root, 'lib');

	for (const name of fs.readdirSync(libRoot)) {
		if (name === 'lib.d.ts' || name.match(/^lib\..*\.d\.ts$/) || name === 'protocol.d.ts') {
			continue;
		}
		if (name === 'typescript.js' || name === 'typescript.d.ts') {
			// used by html and extension editing
			continue;
		}

		if (toDelete.has(name) || name.match(/\.d\.ts$/)) {
			try {
				fs.unlinkSync(path.join(libRoot, name));
				console.log(`removed '${path.join(libRoot, name)}'`);
			} catch (e) {
				console.warn(e);
			}
		}
	}
}

await copyTypeScriptLibFiles();
processRoot();
processLib();
