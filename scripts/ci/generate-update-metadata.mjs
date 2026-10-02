#!/usr/bin/env node
/**
 * Writes KnoxCoder auto-update JSON feeds next to packaged GitHub release assets.
 *
 * Each file is named `latest-<platform>-<arch>[-<target>].json` and points at the
 * matching installer/archive so macOS can background-download and Windows/Linux
 * can resolve a stable latest URL.
 */
import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 ? process.argv[index + 1] : fallback;
}

function classify(fileName) {
	const name = fileName.toLowerCase();
	const arch = name.includes('arm64') || name.includes('aarch64') ? 'arm64'
		: (name.includes('x64') || name.includes('amd64') || name.includes('x86_64')) && !name.includes('arm64') ? 'x64'
			: undefined;
	if (!arch) {
		return undefined;
	}

	if (name.includes('darwin') || name.includes('macos')) {
		if (name.endsWith('.zip')) {
			return { key: `darwin-${arch}`, rank: 2 };
		}
		if (name.endsWith('.dmg')) {
			return { key: `darwin-${arch}`, rank: 1 };
		}
	}

	if (name.includes('win32') || name.includes('windows')) {
		if (name.includes('user-setup') && name.endsWith('.exe')) {
			return { key: `win32-${arch}-user`, rank: 2 };
		}
		if (name.includes('system-setup') && name.endsWith('.exe')) {
			return { key: `win32-${arch}-system`, rank: 2 };
		}
		if (name.endsWith('.zip')) {
			return { key: `win32-${arch}-archive`, rank: 1 };
		}
	}

	if (name.includes('linux') && (name.endsWith('.tar.gz') || name.endsWith('.deb') || name.endsWith('.rpm'))) {
		return { key: `linux-${arch}`, rank: name.endsWith('.tar.gz') ? 2 : 1 };
	}

	return undefined;
}

function detectVersion(files) {
	for (const fileName of files) {
		const match = /KnoxCoder-(\d+\.\d+\.\d+)/i.exec(fileName);
		if (match) {
			return match[1];
		}
	}
	return undefined;
}

const assetsDir = path.resolve(arg('assets-dir', '.'));
const outDir = path.resolve(arg('out-dir', assetsDir));
const repo = arg('repo', 'knoxchat/knoxcoder');
const commit = arg('commit', '');
const files = fs.readdirSync(assetsDir).filter(name => fs.statSync(path.join(assetsDir, name)).isFile());
const version = arg('version', detectVersion(files));
const tag = arg('tag', version ? `v${version}` : '');

if (!version || !tag) {
	console.error('generate-update-metadata: could not determine KnoxCoder version/tag');
	process.exit(1);
}

const chosen = new Map();
for (const fileName of files) {
	const classified = classify(fileName);
	if (!classified) {
		continue;
	}
	const previous = chosen.get(classified.key);
	if (!previous || classified.rank > previous.rank) {
		chosen.set(classified.key, { fileName, rank: classified.rank });
	}
}

fs.mkdirSync(outDir, { recursive: true });
const timestamp = Date.now();
const pubDate = new Date(timestamp).toISOString();
let written = 0;

for (const [key, asset] of chosen) {
	const url = `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(asset.fileName)}`;
	const payload = {
		url,
		name: version,
		version: commit || version,
		productVersion: version,
		timestamp,
		notes: `KnoxCoder ${version}`,
		pub_date: pubDate,
	};
	const outPath = path.join(outDir, `latest-${key}.json`);
	fs.writeFileSync(outPath, `${JSON.stringify(payload, null, '\t')}\n`);
	console.log(`wrote ${path.basename(outPath)} -> ${asset.fileName}`);
	written++;
}

if (written === 0) {
	console.error('generate-update-metadata: no KnoxCoder packages found');
	process.exit(1);
}
