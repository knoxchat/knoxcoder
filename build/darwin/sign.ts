/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import { sign, type SignOptions } from '@electron/osx-sign';
import { spawn } from '@malept/cross-spawn-promise';

const root = path.dirname(path.dirname(import.meta.dirname));
const baseDir = path.dirname(import.meta.dirname);
const product = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8'));

function getElectronVersion(): string {
	const npmrc = fs.readFileSync(path.join(root, '.npmrc'), 'utf8');
	const target = /^target="(.*)"$/m.exec(npmrc)![1];
	return target;
}

function getEntitlementsForFile(filePath: string): string {
	if (filePath.includes(' Helper (GPU).app')) {
		return path.join(baseDir, 'azure-pipelines', 'darwin', 'helper-gpu-entitlements.plist');
	} else if (filePath.includes(' Helper (Renderer).app')) {
		return path.join(baseDir, 'azure-pipelines', 'darwin', 'helper-renderer-entitlements.plist');
	} else if (filePath.includes(' Helper (Plugin).app')) {
		return path.join(baseDir, 'azure-pipelines', 'darwin', 'helper-plugin-entitlements.plist');
	} else if (filePath.includes(' Helper.app')) {
		return path.join(baseDir, 'azure-pipelines', 'darwin', 'helper-entitlements.plist');
	}
	return path.join(baseDir, 'azure-pipelines', 'darwin', 'app-entitlements.plist');
}

async function retrySignOnKeychainError<T>(fn: () => Promise<T>, maxRetries: number = 3): Promise<T> {
	let lastError: Error | undefined;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error as Error;

			// Check if this is the specific keychain error we want to retry
			const errorMessage = error instanceof Error ? error.message : String(error);
			const isKeychainError = errorMessage.includes('The specified item could not be found in the keychain.');

			if (!isKeychainError || attempt === maxRetries) {
				throw error;
			}

			console.log(`Signing attempt ${attempt} failed with keychain error, retrying...`);
			console.log(`Error: ${errorMessage}`);

			const delay = 1000 * Math.pow(2, attempt - 1);
			console.log(`Waiting ${Math.round(delay)}ms before retry ${attempt}/${maxRetries}...`);
			await new Promise(resolve => setTimeout(resolve, delay));
		}
	}

	throw lastError;
}

function resolveArch(): string {
	const arch = process.env['VSCODE_ARCH'];
	if (arch) {
		return arch;
	}

	switch (process.arch) {
		case 'arm64':
			return 'arm64';
		case 'x64':
			return 'x64';
		default:
			throw new Error(`Unsupported architecture: ${process.arch}`);
	}
}

async function setPlistString(plistPath: string, key: string, value: string): Promise<void> {
	try {
		await spawn('plutil', ['-replace', key, '-string', value, plistPath]);
	} catch {
		await spawn('plutil', ['-insert', key, '-string', value, plistPath]);
	}
}

async function main(buildDir?: string): Promise<void> {
	const tempDir = process.env['AGENT_TEMPDIRECTORY'];
	const arch = resolveArch();
	const identity = process.env['CODESIGN_IDENTITY'] ?? process.env['APPLE_SIGNING_IDENTITY'];

	if (!buildDir) {
		throw new Error('Build directory argument is required');
	}

	if (!identity) {
		throw new Error('$CODESIGN_IDENTITY or $APPLE_SIGNING_IDENTITY not set');
	}

	const appRoot = path.join(buildDir, `VSCode-darwin-${arch}`);
	const appName = product.nameLong + '.app';
	const infoPlistPath = path.resolve(appRoot, appName, 'Contents', 'Info.plist');

	const appOpts: SignOptions = {
		app: path.join(appRoot, appName),
		platform: 'darwin',
		optionsForFile: (filePath) => ({
			entitlements: getEntitlementsForFile(filePath),
			hardenedRuntime: true,
		}),
		preAutoEntitlements: false,
		preEmbedProvisioningProfile: false,
		version: getElectronVersion(),
		identity,
		...(tempDir ? { keychain: path.join(tempDir, 'buildagent.keychain') } : {}),
	};

	// Only overwrite plist entries for x64 and arm64 builds,
	// universal will get its copy from the x64 build.
	if (arch !== 'universal') {
		await setPlistString(infoPlistPath, 'NSAppleEventsUsageDescription', 'An application in Visual Studio Code wants to use AppleScript.');
		await setPlistString(infoPlistPath, 'NSMicrophoneUsageDescription', 'An application in Visual Studio Code wants to use the Microphone.');
		await setPlistString(infoPlistPath, 'NSCameraUsageDescription', 'An application in Visual Studio Code wants to use the Camera.');
		await setPlistString(infoPlistPath, 'NSAudioCaptureUsageDescription', 'An application in Visual Studio Code wants to use Audio Capture.');
		await setPlistString(infoPlistPath, 'NSLocalNetworkUsageDescription', 'The app uses your local network for DNS resolution and to connect to locally running services.');
	}

	await retrySignOnKeychainError(() => sign(appOpts));
}

if (import.meta.main) {
	main(process.argv[2]).catch(async err => {
		console.error(err);
		const tempDir = process.env['AGENT_TEMPDIRECTORY'];
		if (tempDir) {
			const keychain = path.join(tempDir, 'buildagent.keychain');
			const identities = await spawn('security', ['find-identity', '-p', 'codesigning', '-v', keychain]);
			console.error(`Available identities:\n${identities}`);
			const dump = await spawn('security', ['dump-keychain', keychain]);
			console.error(`Keychain dump:\n${dump}`);
		}
		process.exit(1);
	});
}
