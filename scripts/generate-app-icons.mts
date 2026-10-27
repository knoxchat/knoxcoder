/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * High-quality app icon rasterizer + Windows ICO packer.
 *
 * Windows desktop icons were blurry because the previous pipeline:
 *   1. Rasterized the SVG with macOS `sips` (poor AA, often a low-res intermediate).
 *   2. Packed only 16/32/48/256, all as uncompressed BMP.
 *   3. Stored 256 as BMP (~270KB). Explorer / rcedit / high-DPI scaling then
 *      upscaled the 48px face instead of using a crisp 96/256 PNG.
 *
 * This writer:
 *   - Renders the SVG with resvg (geometricPrecision) at 4x and Lanczos-3
 *     downscales with premultiplied alpha.
 *   - Packs every Windows shell size: 16, 20, 24, 32, 40, 48, 64, 96, 128, 256.
 *   - Encodes sizes up to 128 as 32-bit BMP+AND (GDI / classic shell; PNG-in-ICO is
 *     only reliable for the 256 face).
 *   - Encodes 256 as PNG (Vista+ requirement, and small enough for rcedit).
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import type { Resvg as ResvgClass } from '@resvg/resvg-js';

const require = createRequire(import.meta.url);

export const WIN_ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256] as const;
export const FAVICON_SIZES = [16, 32, 48] as const;
/** Sizes at or below this are stored as 32-bit BMP; 256 is PNG. */
export const BMP_ICO_MAX = 128;
const SUPER_SAMPLE = 4;
const LANCZOS_A = 3;

export type IcoEncoding = 'bmp' | 'png';

export interface IcoFrame {
	width: number;
	height: number;
	rgba: Buffer;
	encoding?: IcoEncoding;
}

export interface IcoDirectoryEntry {
	width: number;
	height: number;
	planes: number;
	bitCount: number;
	bytesInRes: number;
	imageOffset: number;
	encoding: IcoEncoding;
}

interface LanczosTap {
	index: number;
	weight: number;
}

export function icoEncodingForSize(size: number): IcoEncoding {
	return size <= BMP_ICO_MAX ? 'bmp' : 'png';
}

function loadResvg(): typeof ResvgClass {
	try {
		return (require('@resvg/resvg-js') as { Resvg: typeof ResvgClass }).Resvg;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`@resvg/resvg-js is required to rasterize resources/logo.svg (${message}). Run npm ci.`);
	}
}

export function lanczosKernel(x: number, a: number = LANCZOS_A): number {
	if (x === 0) {
		return 1;
	}
	const abs = Math.abs(x);
	if (abs >= a) {
		return 0;
	}
	const px = Math.PI * x;
	return (a * Math.sin(px) * Math.sin(px / a)) / (px * px);
}

function clamp(value: number, min: number, max: number): number {
	return value < min ? min : value > max ? max : value;
}

/**
 * Lanczos-3 resize of straight RGBA using premultiplied samples so transparent
 * edges do not pick up a dark fringe.
 */
export function resizeRgbaLanczos(src: Buffer, srcW: number, srcH: number, dstW: number, dstH: number): Buffer {
	if (srcW === dstW && srcH === dstH) {
		return Buffer.from(src);
	}
	const dst = Buffer.alloc(dstW * dstH * 4);
	const xRatio = srcW / dstW;
	const yRatio = srcH / dstH;
	const kernelX: LanczosTap[][] = new Array(dstW);
	for (let x = 0; x < dstW; x++) {
		const center = (x + 0.5) * xRatio - 0.5;
		const xStart = Math.floor(center - LANCZOS_A + 1);
		const xEnd = Math.floor(center + LANCZOS_A);
		const taps: LanczosTap[] = [];
		let weightSum = 0;
		for (let sx = xStart; sx <= xEnd; sx++) {
			const weight = lanczosKernel(center - sx);
			if (weight === 0) {
				continue;
			}
			taps.push({ index: clamp(sx, 0, srcW - 1), weight });
			weightSum += weight;
		}
		for (const tap of taps) {
			tap.weight /= weightSum;
		}
		kernelX[x] = taps;
	}

	for (let y = 0; y < dstH; y++) {
		const center = (y + 0.5) * yRatio - 0.5;
		const yStart = Math.floor(center - LANCZOS_A + 1);
		const yEnd = Math.floor(center + LANCZOS_A);
		const yTaps: LanczosTap[] = [];
		let yWeightSum = 0;
		for (let sy = yStart; sy <= yEnd; sy++) {
			const weight = lanczosKernel(center - sy);
			if (weight === 0) {
				continue;
			}
			yTaps.push({ index: clamp(sy, 0, srcH - 1), weight });
			yWeightSum += weight;
		}
		for (const tap of yTaps) {
			tap.weight /= yWeightSum;
		}

		for (let x = 0; x < dstW; x++) {
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			for (const yTap of yTaps) {
				const row = yTap.index * srcW * 4;
				for (const xTap of kernelX[x]) {
					const i = row + xTap.index * 4;
					const weight = xTap.weight * yTap.weight;
					const srcA = src[i + 3] / 255;
					r += src[i] * srcA * weight;
					g += src[i + 1] * srcA * weight;
					b += src[i + 2] * srcA * weight;
					a += srcA * weight;
				}
			}
			const o = (y * dstW + x) * 4;
			if (a < 1e-6) {
				dst[o] = 0;
				dst[o + 1] = 0;
				dst[o + 2] = 0;
				dst[o + 3] = 0;
			} else {
				dst[o] = clamp(Math.round(r / a), 0, 255);
				dst[o + 1] = clamp(Math.round(g / a), 0, 255);
				dst[o + 2] = clamp(Math.round(b / a), 0, 255);
				dst[o + 3] = clamp(Math.round(a * 255), 0, 255);
			}
		}
	}
	return dst;
}

/** Light unsharp mask so 16-48px faces stay as crisp as macOS @2x assets. */
export function unsharpRgba(src: Buffer, width: number, height: number, amount: number): Buffer {
	if (amount <= 0) {
		return src;
	}
	const out = Buffer.from(src);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			let count = 0;
			for (let dy = -1; dy <= 1; dy++) {
				const sy = clamp(y + dy, 0, height - 1);
				for (let dx = -1; dx <= 1; dx++) {
					const sx = clamp(x + dx, 0, width - 1);
					const i = (sy * width + sx) * 4;
					r += src[i];
					g += src[i + 1];
					b += src[i + 2];
					a += src[i + 3];
					count++;
				}
			}
			const o = (y * width + x) * 4;
			out[o] = clamp(Math.round(src[o] + amount * (src[o] - r / count)), 0, 255);
			out[o + 1] = clamp(Math.round(src[o + 1] + amount * (src[o + 1] - g / count)), 0, 255);
			out[o + 2] = clamp(Math.round(src[o + 2] + amount * (src[o + 2] - b / count)), 0, 255);
			out[o + 3] = clamp(Math.round(src[o + 3] + amount * (src[o + 3] - a / count)), 0, 255);
		}
	}
	return out;
}

function sharpenAmountForSize(size: number): number {
	if (size <= 24) {
		return 0.55;
	}
	if (size <= 48) {
		return 0.4;
	}
	if (size <= 96) {
		return 0.22;
	}
	return 0;
}

export function renderSvgRgba(svg: Buffer | string, size: number, Resvg: typeof ResvgClass = loadResvg()): Buffer {
	const superSize = size * SUPER_SAMPLE;
	const resvg = new Resvg(svg, {
		fitTo: { mode: 'width', value: superSize },
		shapeRendering: 2,
		background: 'rgba(0,0,0,0)',
		font: { loadSystemFonts: false },
	});
	const image = resvg.render();
	const scaled = resizeRgbaLanczos(image.pixels, image.width, image.height, size, size);
	return unsharpRgba(scaled, size, size, sharpenAmountForSize(size));
}

function pngChunk(type: string, data: Buffer): Buffer {
	const chunk = Buffer.alloc(8 + data.length + 4);
	chunk.writeUInt32BE(data.length, 0);
	chunk.write(type, 4, 4, 'ascii');
	data.copy(chunk, 8);
	const crc = zlib.crc32(chunk.subarray(4, 8 + data.length));
	chunk.writeUInt32BE(crc >>> 0, 8 + data.length);
	return chunk;
}

export function encodePng(rgba: Buffer, width: number, height: number): Buffer {
	const stride = width * 4 + 1;
	const raw = Buffer.alloc(stride * height);
	for (let y = 0; y < height; y++) {
		raw[y * stride] = 0;
		rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk('IHDR', ihdr),
		pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
		pngChunk('IEND', Buffer.alloc(0)),
	]);
}

function andMaskRowBytes(width: number): number {
	return ((width + 31) >> 5) << 2;
}

export function encodeBmpIcon(rgba: Buffer, width: number, height: number): Buffer {
	const xorSize = width * height * 4;
	const maskStride = andMaskRowBytes(width);
	const maskSize = maskStride * height;
	const dib = Buffer.alloc(40 + xorSize + maskSize);
	dib.writeUInt32LE(40, 0);
	dib.writeInt32LE(width, 4);
	dib.writeInt32LE(height * 2, 8);
	dib.writeUInt16LE(1, 12);
	dib.writeUInt16LE(32, 14);
	for (let y = 0; y < height; y++) {
		const srcY = height - 1 - y;
		for (let x = 0; x < width; x++) {
			const src = (srcY * width + x) * 4;
			const dst = 40 + (y * width + x) * 4;
			dib[dst] = rgba[src + 2];
			dib[dst + 1] = rgba[src + 1];
			dib[dst + 2] = rgba[src];
			dib[dst + 3] = rgba[src + 3];
			if (rgba[src + 3] < 128) {
				const maskRow = 40 + xorSize + y * maskStride;
				dib[maskRow + (x >> 3)] |= 0x80 >> (x & 7);
			}
		}
	}
	return dib;
}

export function encodeIco(frames: readonly IcoFrame[]): Buffer {
	if (frames.length === 0) {
		throw new Error('ICO requires at least one frame');
	}
	const headerSize = 6 + 16 * frames.length;
	const images = frames.map(frame => {
		const encoding = frame.encoding ?? icoEncodingForSize(frame.width);
		const data = encoding === 'png'
			? encodePng(frame.rgba, frame.width, frame.height)
			: encodeBmpIcon(frame.rgba, frame.width, frame.height);
		return { width: frame.width, height: frame.height, encoding, data };
	});
	const ico = Buffer.alloc(headerSize + images.reduce((sum, image) => sum + image.data.length, 0));
	ico.writeUInt16LE(0, 0);
	ico.writeUInt16LE(1, 2);
	ico.writeUInt16LE(images.length, 4);
	let offset = headerSize;
	images.forEach((image, index) => {
		const entry = 6 + index * 16;
		ico[entry] = image.width >= 256 ? 0 : image.width;
		ico[entry + 1] = image.height >= 256 ? 0 : image.height;
		ico[entry + 2] = 0;
		ico[entry + 3] = 0;
		ico.writeUInt16LE(1, entry + 4);
		ico.writeUInt16LE(32, entry + 6);
		ico.writeUInt32LE(image.data.length, entry + 8);
		ico.writeUInt32LE(offset, entry + 12);
		image.data.copy(ico, offset);
		offset += image.data.length;
	});
	return ico;
}

export function parseIcoDirectory(buffer: Buffer): IcoDirectoryEntry[] {
	if (buffer.length < 6) {
		throw new Error('ICO too small');
	}
	const reserved = buffer.readUInt16LE(0);
	const type = buffer.readUInt16LE(2);
	const count = buffer.readUInt16LE(4);
	if (reserved !== 0 || type !== 1) {
		throw new Error(`Not an ICO (reserved=${reserved} type=${type})`);
	}
	const entries: IcoDirectoryEntry[] = [];
	for (let i = 0; i < count; i++) {
		const entry = 6 + i * 16;
		const bytesInRes = buffer.readUInt32LE(entry + 8);
		const imageOffset = buffer.readUInt32LE(entry + 12);
		const chunk = buffer.subarray(imageOffset, imageOffset + Math.min(8, bytesInRes));
		const isPng = chunk.length >= 8 && chunk[0] === 0x89 && chunk.toString('ascii', 1, 4) === 'PNG';
		entries.push({
			width: buffer[entry] || 256,
			height: buffer[entry + 1] || 256,
			planes: buffer.readUInt16LE(entry + 4),
			bitCount: buffer.readUInt16LE(entry + 6),
			bytesInRes,
			imageOffset,
			encoding: isPng ? 'png' : 'bmp',
		});
	}
	return entries;
}

function writeFile(filePath: string, data: Buffer): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, data);
}

export function generateWindowsIcons(svg: Buffer | string, destDir: string): { ico: Buffer; frames: IcoDirectoryEntry[] } {
	const frames: IcoFrame[] = WIN_ICO_SIZES.map(size => ({
		width: size,
		height: size,
		rgba: renderSvgRgba(svg, size),
		encoding: icoEncodingForSize(size),
	}));
	const ico = encodeIco(frames);
	writeFile(path.join(destDir, 'code.ico'), ico);
	writeFile(path.join(destDir, 'code_70x70.png'), encodePng(renderSvgRgba(svg, 70), 70, 70));
	writeFile(path.join(destDir, 'code_150x150.png'), encodePng(renderSvgRgba(svg, 150), 150, 150));
	return { ico, frames: parseIcoDirectory(ico) };
}

export function generateFavicon(svg: Buffer | string, destPath: string): Buffer {
	const frames: IcoFrame[] = FAVICON_SIZES.map(size => ({
		width: size,
		height: size,
		rgba: renderSvgRgba(svg, size),
		encoding: 'bmp',
	}));
	const ico = encodeIco(frames);
	writeFile(destPath, ico);
	return ico;
}

function main(): void {
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	const svgPath = path.join(root, 'resources', 'logo.svg');
	const svg = fs.readFileSync(svgPath);
	const winDir = path.join(root, 'resources', 'win32');
	const { frames } = generateWindowsIcons(svg, winDir);
	generateFavicon(svg, path.join(root, 'resources', 'server', 'favicon.ico'));
	console.log(`Wrote ${path.join(winDir, 'code.ico')} (${frames.length} faces):`);
	for (const frame of frames) {
		console.log(`  ${frame.width}x${frame.height} ${frame.encoding} ${frame.bytesInRes} bytes`);
	}
	console.log(`Wrote ${path.join(winDir, 'code_70x70.png')}`);
	console.log(`Wrote ${path.join(winDir, 'code_150x150.png')}`);
	console.log(`Wrote ${path.join(root, 'resources', 'server', 'favicon.ico')}`);
}

const invokedDirectly = Boolean(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (invokedDirectly) {
	main();
}
