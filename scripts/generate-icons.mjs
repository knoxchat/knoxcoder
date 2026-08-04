#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESOURCES = path.join(ROOT, 'resources');
const SRC_PNG = path.join(RESOURCES, 'logo.png');
const SRC_SVG = path.join(RESOURCES, 'logo.svg');

const PNG_OPTIONS = {
	compressionLevel: 9,
	adaptiveFiltering: true,
	palette: false
};

async function resolveSource() {
	try {
		await fs.access(SRC_PNG);
		return { path: SRC_PNG, isSvg: false };
	} catch {
		try {
			await fs.access(SRC_SVG);
			return { path: SRC_SVG, isSvg: true };
		} catch {
			throw new Error('Neither resources/logo.png nor resources/logo.svg was found.');
		}
	}
}

function sharpInput(source) {
	return source.isSvg
		? sharp(source.path, { density: 384, unlimited: true })
		: sharp(source.path, { unlimited: true });
}

async function resizePng(source, size, outputPath) {
	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	await sharpInput(source)
		.resize(size, size, {
			fit: 'contain',
			kernel: sharp.kernel.lanczos3,
			background: { r: 0, g: 0, b: 0, alpha: 0 }
		})
		.png(PNG_OPTIONS)
		.toFile(outputPath);
}

async function writeIco(outputPath, pngPaths) {
	const icoBuffer = await pngToIco(pngPaths);
	await fs.writeFile(outputPath, icoBuffer);
}

async function writeMacIconset(source, iconsetDir) {
	await fs.mkdir(iconsetDir, { recursive: true });

	const entries = [
		['icon_16x16.png', 16],
		['icon_16x16@2x.png', 32],
		['icon_32x32.png', 32],
		['icon_32x32@2x.png', 64],
		['icon_128x128.png', 128],
		['icon_128x128@2x.png', 256],
		['icon_256x256.png', 256],
		['icon_256x256@2x.png', 512],
		['icon_512x512.png', 512],
		['icon_512x512@2x.png', 1024]
	];

	for (const [name, size] of entries) {
		await resizePng(source, size, path.join(iconsetDir, name));
	}
}

function writeXpm(pngPath, xpmPath) {
	const pnm = execFileSync('pngtopnm', [pngPath], {
		encoding: 'buffer',
		maxBuffer: 64 * 1024 * 1024
	});
	const xpmText = execFileSync('ppmtoxpm', ['-name', 'code'], {
		input: pnm,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024
	});
	return fs.writeFile(xpmPath, xpmText);
}

function writeIcns(iconsetDir, icnsPath) {
	execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath], { stdio: 'inherit' });
}

async function refreshDevElectronIcon(icnsPath) {
	const electronApp = path.join(ROOT, '.build/electron/KnoxCoder.app');
	const electronIcns = path.join(electronApp, 'Contents/Resources/KnoxCoder.icns');

	try {
		await fs.access(electronIcns);
	} catch {
		return;
	}

	await fs.copyFile(icnsPath, electronIcns);
	await fs.utimes(electronApp, new Date(), new Date());

	if (process.platform === 'darwin') {
		try {
			execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', electronApp], {
				stdio: 'ignore'
			});
		} catch {
			// Best-effort cache bust for local dev bundles.
		}
	}
}

async function main() {
	const source = await resolveSource();
	const tmpDir = await fs.mkdtemp(path.join(ROOT, '.icon-gen-'));

	console.log(`Generating icons from ${path.relative(ROOT, source.path)}`);

	try {
		// Linux
		const linuxPng = path.join(RESOURCES, 'linux/code.png');
		await resizePng(source, 1024, linuxPng);
		try {
			await writeXpm(linuxPng, path.join(RESOURCES, 'linux/rpm/code.xpm'));
		} catch (error) {
			console.warn('Skipping RPM XPM generation (install netpbm to enable it):', error.message);
		}

		// Windows tiles
		await resizePng(source, 150, path.join(RESOURCES, 'win32/code_150x150.png'));
		await resizePng(source, 70, path.join(RESOURCES, 'win32/code_70x70.png'));

		// Server / web
		await resizePng(source, 192, path.join(RESOURCES, 'server/code-192.png'));
		await resizePng(source, 512, path.join(RESOURCES, 'server/code-512.png'));

		// Windows ICO (include common DPI sizes for crisp taskbar/start-menu rendering)
		const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
		const icoInputs = [];
		for (const size of icoSizes) {
			const pngPath = path.join(tmpDir, `ico-${size}.png`);
			await resizePng(source, size, pngPath);
			icoInputs.push(pngPath);
		}

		await writeIco(path.join(RESOURCES, 'win32/code.ico'), icoInputs);
		await writeIco(path.join(RESOURCES, 'server/favicon.ico'), [
			path.join(tmpDir, 'ico-16.png'),
			path.join(tmpDir, 'ico-32.png'),
			path.join(tmpDir, 'ico-48.png')
		]);

		// macOS .icns
		if (process.platform === 'darwin') {
			const iconsetDir = path.join(tmpDir, 'code.iconset');
			const icnsPath = path.join(RESOURCES, 'darwin/code.icns');
			await writeMacIconset(source, iconsetDir);
			writeIcns(iconsetDir, icnsPath);
			await refreshDevElectronIcon(icnsPath);
		} else {
			console.warn('Skipping .icns generation (requires macOS iconutil).');
		}

		console.log('Done. Generated:');
		console.log('  resources/linux/code.png');
		console.log('  resources/linux/rpm/code.xpm');
		console.log('  resources/win32/code.ico');
		console.log('  resources/win32/code_150x150.png');
		console.log('  resources/win32/code_70x70.png');
		console.log('  resources/server/code-192.png');
		console.log('  resources/server/code-512.png');
		console.log('  resources/server/favicon.ico');
		if (process.platform === 'darwin') {
			console.log('  resources/darwin/code.icns');
		}
	} finally {
		await fs.rm(tmpDir, { recursive: true, force: true });
	}
}

main().catch(error => {
	console.error(error);
	process.exit(1);
});
