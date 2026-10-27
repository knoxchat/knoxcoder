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
	BMP_ICO_MAX,
	WIN_ICO_SIZES,
	encodeIco,
	encodePng,
	icoEncodingForSize,
	lanczosKernel,
	parseIcoDirectory,
	resizeRgbaLanczos,
} from './generate-app-icons.mts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function solidRgba(width: number, height: number, r: number, g: number, b: number, a: number): Buffer {
	const buf = Buffer.alloc(width * height * 4);
	for (let i = 0; i < buf.length; i += 4) {
		buf[i] = r;
		buf[i + 1] = g;
		buf[i + 2] = b;
		buf[i + 3] = a;
	}
	return buf;
}

describe('Windows ICO packing', () => {
	it('stores GDI sizes as BMP and the 256 face as PNG', () => {
		assert.equal(icoEncodingForSize(16), 'bmp');
		assert.equal(icoEncodingForSize(48), 'bmp');
		assert.equal(icoEncodingForSize(96), 'bmp');
		assert.equal(icoEncodingForSize(BMP_ICO_MAX), 'bmp');
		assert.equal(icoEncodingForSize(256), 'png');
	});

	it('writes a complete directory with 256 encoded as PNG', () => {
		const frames = [
			{ width: 16, height: 16, rgba: solidRgba(16, 16, 32, 201, 151, 255), encoding: 'bmp' as const },
			{ width: 48, height: 48, rgba: solidRgba(48, 48, 32, 201, 151, 255), encoding: 'bmp' as const },
			{ width: 256, height: 256, rgba: solidRgba(256, 256, 32, 201, 151, 255), encoding: 'png' as const },
		];
		const ico = encodeIco(frames);
		const entries = parseIcoDirectory(ico);
		assert.equal(entries.length, 3);
		assert.deepEqual(entries.map(entry => [entry.width, entry.encoding]), [
			[16, 'bmp'],
			[48, 'bmp'],
			[256, 'png'],
		]);
		assert.equal(ico.readUInt16LE(0), 0);
		assert.equal(ico.readUInt16LE(2), 1);
		assert.ok(entries[2].bytesInRes < 256 * 256 * 4, '256 PNG must be smaller than an uncompressed BMP');
	});

	it('includes every Windows shell/high-DPI face in the committed app icon', () => {
		const icoPath = path.join(root, 'resources', 'win32', 'code.ico');
		const entries = parseIcoDirectory(fs.readFileSync(icoPath));
		assert.deepEqual(entries.map(entry => entry.width), [...WIN_ICO_SIZES]);
		for (const entry of entries) {
			assert.equal(entry.encoding, icoEncodingForSize(entry.width), `${entry.width}px encoding`);
			assert.equal(entry.bitCount, 32);
			assert.ok(entry.bytesInRes > 0);
		}
	});
});

describe('Lanczos resize', () => {
	it('is 1 at the origin and 0 outside the lobe', () => {
		assert.equal(lanczosKernel(0), 1);
		assert.equal(lanczosKernel(3), 0);
		assert.equal(lanczosKernel(-3), 0);
	});

	it('preserves a solid opaque color when downscaling', () => {
		const src = solidRgba(32, 32, 16, 112, 255, 255);
		const dst = resizeRgbaLanczos(src, 32, 32, 8, 8);
		assert.equal(dst.length, 8 * 8 * 4);
		for (let i = 0; i < dst.length; i += 4) {
			assert.ok(Math.abs(dst[i] - 16) <= 1);
			assert.ok(Math.abs(dst[i + 1] - 112) <= 1);
			assert.ok(Math.abs(dst[i + 2] - 255) <= 1);
			assert.equal(dst[i + 3], 255);
		}
	});

	it('does not introduce an opaque halo on a fully transparent source', () => {
		const src = solidRgba(16, 16, 0, 0, 0, 0);
		const dst = resizeRgbaLanczos(src, 16, 16, 4, 4);
		for (let i = 0; i < dst.length; i += 4) {
			assert.equal(dst[i + 3], 0);
		}
	});
});

describe('PNG encoder', () => {
	it('writes a valid PNG signature and IHDR', () => {
		const png = encodePng(solidRgba(2, 2, 255, 0, 0, 128), 2, 2);
		assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
		assert.equal(png.toString('ascii', 12, 16), 'IHDR');
		assert.equal(png.readUInt32BE(16), 2);
		assert.equal(png.readUInt32BE(20), 2);
		assert.equal(png[25], 6);
	});
});
