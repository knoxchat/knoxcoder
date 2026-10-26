/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	assertProductUpdateUrls,
	isDisallowedUpdateDownloadUrl,
	isKnoxCoderReleaseAssetUrl,
	loadProduct,
	magicOk,
} from './check-update-feeds.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('check-update-feeds', () => {
	it('product.json points auto-update at knoxchat/knoxcoder', () => {
		const product = loadProduct();
		assert.deepEqual(assertProductUpdateUrls(product), []);
		assert.equal(product.updateUrl, 'https://github.com/knoxchat/knoxcoder');
		assert.equal(product.downloadUrl, 'https://github.com/knoxchat/knoxcoder/releases/latest');
		assert.match(fs.readFileSync(path.join(root, 'product.json'), 'utf8'), /knoxchat\/knoxcoder/);
		assert.doesNotMatch(fs.readFileSync(path.join(root, 'product.json'), 'utf8'), /update\.code\.visualstudio\.com/);
	});

	it('rejects VS Code CDN and microsoft/vscode assets', () => {
		assert.equal(isDisallowedUpdateDownloadUrl('https://update.code.visualstudio.com/api/releases/stable'), true);
		assert.equal(isDisallowedUpdateDownloadUrl('https://github.com/microsoft/vscode/releases/latest'), true);
		assert.equal(isKnoxCoderReleaseAssetUrl('https://github.com/microsoft/vscode/releases/download/1.143.1/VSCodeSetup.exe'), false);
		assert.equal(
			isKnoxCoderReleaseAssetUrl('https://github.com/knoxchat/knoxcoder/releases/download/v2.2.2/KnoxCoder-2.2.2-win32-x64-user-setup.exe'),
			true,
		);
	});

	it('accepts package magic bytes without downloading the whole file', () => {
		assert.equal(magicOk('KnoxCoder.exe', Buffer.from([0x4d, 0x5a, 0x90, 0x00])), true);
		assert.equal(magicOk('KnoxCoder.exe', Buffer.from([0x00, 0x00])), false);
		assert.equal(magicOk('KnoxCoder.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04])), true);
		assert.equal(magicOk('KnoxCoder.tar.gz', Buffer.from([0x1f, 0x8b, 0x08, 0x00])), true);
	});
});
