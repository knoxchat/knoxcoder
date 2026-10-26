/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Confirms KnoxCoder auto-update feeds on github.com/knoxchat/knoxcoder.
 *
 * Does not download Microsoft VS Code builds. JSON feeds are fetched in full
 * (a few hundred bytes). Package URLs are probed with a 16-byte Range GET so
 * CI can confirm the asset exists without pulling the installer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const KNOXCODER_RELEASE_HOSTS = new Set(['github.com', 'www.github.com']);
const REQUIRED_FEEDS = [
	'latest-darwin-arm64.json',
	'latest-linux-x64.json',
	'latest-linux-arm64.json',
	'latest-win32-x64-user.json',
	'latest-win32-x64-system.json',
	'latest-win32-x64-archive.json',
	'latest-win32-arm64-user.json',
	'latest-win32-arm64-system.json',
	'latest-win32-arm64-archive.json',
];
const OPTIONAL_FEEDS = [
	'latest-darwin-x64.json',
];

export function loadProduct(productPath = path.join(root, 'product.json')) {
	return JSON.parse(fs.readFileSync(productPath, 'utf8'));
}

export function isDisallowedUpdateDownloadUrl(url) {
	if (!url) {
		return false;
	}

	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}

	const host = parsed.hostname.toLowerCase();
	if (host === 'update.code.visualstudio.com' || host === 'vscode.download.prss.microsoft.com') {
		return true;
	}
	if (host.endsWith('.visualstudio.com') && (host.includes('vscode') || host.includes('vsassets'))) {
		return true;
	}

	const parts = parsed.pathname.split('/').filter(Boolean);
	if (KNOXCODER_RELEASE_HOSTS.has(host) || host === 'api.github.com') {
		const owner = host === 'api.github.com' ? parts[1] : parts[0];
		const repo = (host === 'api.github.com' ? parts[2] : parts[1])?.replace(/\.git$/i, '');
		return owner?.toLowerCase() === 'microsoft' && repo?.toLowerCase() === 'vscode';
	}

	return false;
}

export function isKnoxCoderReleaseAssetUrl(url) {
	if (!url || isDisallowedUpdateDownloadUrl(url)) {
		return false;
	}

	try {
		const parsed = new URL(url);
		if (!KNOXCODER_RELEASE_HOSTS.has(parsed.hostname.toLowerCase())) {
			return false;
		}

		return /^\/knoxchat\/knoxcoder\/releases\/download\/[^/]+\/.+/i.test(parsed.pathname);
	} catch {
		return false;
	}
}

export function assertProductUpdateUrls(product) {
	const problems = [];
	for (const key of ['updateUrl', 'downloadUrl', 'releaseNotesUrl']) {
		const value = product[key];
		if (typeof value !== 'string' || !value.includes('github.com/knoxchat/knoxcoder')) {
			problems.push(`${key} must point at github.com/knoxchat/knoxcoder (got ${value})`);
		}
		if (isDisallowedUpdateDownloadUrl(value)) {
			problems.push(`${key} is a VS Code download URL: ${value}`);
		}
	}

	if (product.updateUrl !== 'https://github.com/knoxchat/knoxcoder') {
		problems.push(`updateUrl must be https://github.com/knoxchat/knoxcoder (got ${product.updateUrl})`);
	}

	return problems;
}

export function feedUrl(name, repo = 'knoxchat/knoxcoder') {
	return `https://github.com/${repo}/releases/latest/download/${name}`;
}

export function magicOk(fileName, bytes) {
	if (!bytes || bytes.length < 2) {
		return false;
	}

	const name = fileName.toLowerCase();
	if (name.endsWith('.exe') || name.endsWith('.dll') || name.endsWith('.msi')) {
		return bytes[0] === 0x4d && bytes[1] === 0x5a;
	}
	if (name.endsWith('.zip')) {
		return bytes[0] === 0x50 && bytes[1] === 0x4b;
	}
	if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) {
		return bytes[0] === 0x1f && bytes[1] === 0x8b;
	}
	if (name.endsWith('.dmg')) {
		return true;
	}
	if (name.endsWith('.deb')) {
		return bytes.subarray(0, 7).toString('ascii') === '!<arch>';
	}
	if (name.endsWith('.rpm')) {
		return bytes[0] === 0xed && bytes[1] === 0xab;
	}

	return true;
}

function arg(name) {
	return process.argv.includes(`--${name}`);
}

async function fetchJson(url, headers) {
	const response = await fetch(url, { headers, redirect: 'follow' });
	if (!response.ok) {
		return { ok: false, status: response.status };
	}

	return { ok: true, status: response.status, body: await response.json() };
}

async function probeAsset(url, headers) {
	const response = await fetch(url, {
		headers: { ...headers, Range: 'bytes=0-15' },
		redirect: 'follow',
	});
	if (!response.ok && response.status !== 206) {
		return { ok: false, status: response.status };
	}

	const bytes = Buffer.from(await response.arrayBuffer()).subarray(0, 16);
	return { ok: true, status: response.status, bytes, finalUrl: response.url };
}

export async function checkLiveFeeds(options = {}) {
	const repo = options.repo ?? 'knoxchat/knoxcoder';
	const headers = {};
	if (options.token) {
		headers.Authorization = `Bearer ${options.token}`;
		headers.Accept = 'application/octet-stream';
	}

	const problems = [];
	const checked = [];
	for (const name of REQUIRED_FEEDS.concat(options.includeOptional ? OPTIONAL_FEEDS : [])) {
		const url = feedUrl(name, repo);
		const feed = await fetchJson(url, headers);
		if (!feed.ok) {
			if (OPTIONAL_FEEDS.includes(name)) {
				continue;
			}
			problems.push(`${name}: HTTP ${feed.status}`);
			continue;
		}

		const payload = feed.body;
		if (!payload || typeof payload.url !== 'string' || typeof payload.productVersion !== 'string') {
			problems.push(`${name}: missing url/productVersion`);
			continue;
		}
		if (!isKnoxCoderReleaseAssetUrl(payload.url)) {
			problems.push(`${name}: package url is not a knoxchat/knoxcoder release asset (${payload.url})`);
			continue;
		}
		if (isDisallowedUpdateDownloadUrl(payload.url)) {
			problems.push(`${name}: package url is a VS Code download (${payload.url})`);
			continue;
		}

		const asset = await probeAsset(payload.url, headers);
		if (!asset.ok) {
			problems.push(`${name}: package probe HTTP ${asset.status} for ${payload.url}`);
			continue;
		}

		const assetName = decodeURIComponent(new URL(payload.url).pathname.split('/').pop() ?? '');
		if (!magicOk(assetName, asset.bytes)) {
			problems.push(`${name}: ${assetName} did not look like a ${path.extname(assetName)} package`);
			continue;
		}

		checked.push({ name, productVersion: payload.productVersion, url: payload.url });
	}

	return { problems, checked };
}

async function main() {
	const product = loadProduct();
	const productProblems = assertProductUpdateUrls(product);
	if (productProblems.length) {
		for (const problem of productProblems) {
			console.error(`product.json: ${problem}`);
		}
		process.exit(1);
	}

	console.log('product.json updateUrl/downloadUrl/releaseNotesUrl point at github.com/knoxchat/knoxcoder');

	if (arg('offline')) {
		return;
	}

	const { problems, checked } = await checkLiveFeeds({
		token: process.env.GITHUB_TOKEN,
		includeOptional: arg('include-optional'),
	});
	for (const item of checked) {
		console.log(`ok ${item.name} -> KnoxCoder ${item.productVersion}`);
	}
	if (problems.length) {
		for (const problem of problems) {
			console.error(problem);
		}
		process.exit(1);
	}

	console.log(`Checked ${checked.length} KnoxCoder release feeds. No vscode.com / microsoft/vscode downloads.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(error => {
		console.error(error);
		process.exit(1);
	});
}
