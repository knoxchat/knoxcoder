/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as semver from '../../../base/common/semver/semver.js';
import { IUpdate } from './update.js';

export interface IGitHubReleaseAsset {
	readonly name: string;
	readonly browser_download_url: string;
}

export interface IGitHubRelease {
	readonly tag_name: string;
	readonly html_url?: string;
	readonly published_at?: string;
	readonly target_commitish?: string;
	readonly assets?: readonly IGitHubReleaseAsset[];
}

export interface IGitHubAssetQuery {
	readonly platform: 'win32' | 'linux' | 'darwin';
	readonly arch: string;
	readonly target?: 'archive' | 'user' | 'system';
}

export interface IAvailableUpdateResult {
	readonly isLatest: boolean;
	readonly update?: IUpdate;
	readonly squirrelFeedUrl?: string;
}

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com', 'api.github.com']);

export function parseGitHubRepository(updateUrl: string | undefined): { owner: string; repo: string } | undefined {
	if (!updateUrl) {
		return undefined;
	}

	let parsed: URL;
	try {
		parsed = new URL(updateUrl);
	} catch {
		return undefined;
	}

	if (!GITHUB_HOSTS.has(parsed.hostname.toLowerCase())) {
		return undefined;
	}

	const parts = parsed.pathname.split('/').filter(Boolean);
	if (parsed.hostname.toLowerCase() === 'api.github.com') {
		if (parts[0] !== 'repos' || parts.length < 3) {
			return undefined;
		}
		return { owner: parts[1], repo: stripGitSuffix(parts[2]) };
	}

	if (parts.length < 2) {
		return undefined;
	}

	return { owner: parts[0], repo: stripGitSuffix(parts[1]) };
}

export function isGitHubUpdateUrl(updateUrl: string | undefined): boolean {
	return Boolean(parseGitHubRepository(updateUrl));
}

export function createGitHubLatestReleaseUrl(updateUrl: string | undefined): string | undefined {
	const repo = parseGitHubRepository(updateUrl);
	if (!repo) {
		return undefined;
	}

	return `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`;
}

export function isGitHubReleasePayload(value: unknown): value is IGitHubRelease {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const candidate = value as IGitHubRelease;
	return typeof candidate.tag_name === 'string' && Array.isArray(candidate.assets ?? []);
}

export function normalizeReleaseVersion(tag: string | undefined): string | undefined {
	if (!tag) {
		return undefined;
	}

	const cleaned = tag.trim().replace(/^v/i, '');
	return cleaned || undefined;
}

export function isCurrentVersionLatest(currentVersion: string | undefined, latestVersion: string | undefined): boolean {
	const current = normalizeReleaseVersion(currentVersion);
	const latest = normalizeReleaseVersion(latestVersion);
	if (!current || !latest) {
		return false;
	}

	try {
		return semver.compare(current, latest) >= 0;
	} catch {
		return current === latest;
	}
}

export function isInstallerPackageUrl(url: string | undefined): boolean {
	if (!url) {
		return false;
	}

	try {
		const pathname = new URL(url).pathname.toLowerCase();
		return pathname.endsWith('.exe') || pathname.endsWith('.msi');
	} catch {
		return false;
	}
}

export function selectGitHubReleaseAsset(release: IGitHubRelease, query: IGitHubAssetQuery): IGitHubReleaseAsset | undefined {
	const assets = (release.assets ?? []).filter(asset => matchesAsset(asset.name, query));
	if (assets.length === 0) {
		return undefined;
	}

	return assets.sort((a, b) => assetRank(b.name, query) - assetRank(a.name, query))[0];
}

export function selectSquirrelFeedUrl(release: IGitHubRelease, query: IGitHubAssetQuery): string | undefined {
	const expected = squirrelFeedAssetName(query);
	const asset = (release.assets ?? []).find(candidate => candidate.name.toLowerCase() === expected);
	return asset?.browser_download_url;
}

export function squirrelFeedAssetName(query: IGitHubAssetQuery): string {
	const arch = normalizeArch(query.arch);
	if (query.target) {
		return `latest-${query.platform}-${arch}-${query.target}.json`;
	}

	return `latest-${query.platform}-${arch}.json`;
}

export function githubReleaseToUpdate(release: IGitHubRelease, query: IGitHubAssetQuery, fallbackUrl?: string): IUpdate | undefined {
	const productVersion = normalizeReleaseVersion(release.tag_name);
	if (!productVersion) {
		return undefined;
	}

	const asset = selectGitHubReleaseAsset(release, query);
	const url = asset?.browser_download_url || fallbackUrl || release.html_url;
	if (!url) {
		return undefined;
	}

	return {
		version: commitFromRelease(release) ?? productVersion,
		productVersion,
		url,
		timestamp: parseTimestamp(release.published_at),
	};
}

function stripGitSuffix(repo: string): string {
	return repo.replace(/\.git$/i, '');
}

function commitFromRelease(release: IGitHubRelease): string | undefined {
	const commitish = release.target_commitish?.trim();
	if (commitish && /^[0-9a-f]{7,40}$/i.test(commitish)) {
		return commitish;
	}

	return undefined;
}

function parseTimestamp(value: string | undefined): number | undefined {
	if (!value) {
		return undefined;
	}

	const timestamp = Date.parse(value);
	return Number.isNaN(timestamp) ? undefined : timestamp;
}

function normalizeArch(arch: string): string {
	const value = arch.toLowerCase();
	if (value === 'amd64' || value === 'x86_64') {
		return 'x64';
	}
	if (value === 'aarch64') {
		return 'arm64';
	}
	if (value === 'x86' || value === 'ia32') {
		return 'ia32';
	}

	return value;
}

function matchesAsset(fileName: string, query: IGitHubAssetQuery): boolean {
	const name = fileName.toLowerCase();
	if (name.endsWith('.json') || name.endsWith('.sha256') || name.endsWith('.blockmap')) {
		return false;
	}

	return matchesPlatform(name, query.platform) && matchesArch(name, query.arch) && matchesTarget(name, query);
}

function matchesPlatform(name: string, platform: IGitHubAssetQuery['platform']): boolean {
	switch (platform) {
		case 'win32':
			return name.includes('win32') || name.includes('windows');
		case 'linux':
			return name.includes('linux');
		case 'darwin':
			return name.includes('darwin') || name.includes('macos') || name.includes('osx');
	}
}

function matchesArch(name: string, arch: string): boolean {
	const normalized = normalizeArch(arch);
	if (normalized === 'arm64') {
		return name.includes('arm64') || name.includes('aarch64');
	}

	if (normalized === 'x64') {
		if (name.includes('arm64') || name.includes('aarch64')) {
			return false;
		}

		return name.includes('x64') || name.includes('amd64') || name.includes('x86_64');
	}

	if (normalized === 'ia32') {
		return name.includes('ia32') || name.includes('x86');
	}

	return name.includes(normalized);
}

function matchesTarget(name: string, query: IGitHubAssetQuery): boolean {
	if (query.platform === 'win32') {
		if (query.target === 'user') {
			return name.includes('user-setup') || (name.endsWith('.exe') && name.includes('user') && !name.includes('system'));
		}

		if (query.target === 'system') {
			return name.includes('system-setup') || (name.endsWith('.exe') && name.includes('system') && !name.includes('user'));
		}

		return name.endsWith('.zip');
	}

	if (query.platform === 'darwin') {
		return name.endsWith('.zip') || name.endsWith('.dmg');
	}

	return name.endsWith('.tar.gz') || name.endsWith('.deb') || name.endsWith('.rpm') || name.endsWith('.appimage');
}

function assetRank(fileName: string, query: IGitHubAssetQuery): number {
	const name = fileName.toLowerCase();
	if (query.platform === 'win32') {
		if (query.target === 'user' && name.includes('user-setup') && name.endsWith('.exe')) {
			return 5;
		}
		if (query.target === 'system' && name.includes('system-setup') && name.endsWith('.exe')) {
			return 5;
		}
		if (query.target === 'archive' && name.endsWith('.zip')) {
			return 4;
		}
	}

	if (query.platform === 'darwin') {
		if (name.endsWith('.zip')) {
			return 5;
		}
		if (name.endsWith('.dmg')) {
			return 3;
		}
	}

	if (query.platform === 'linux') {
		if (name.endsWith('.tar.gz')) {
			return 4;
		}
		if (name.endsWith('.deb')) {
			return 3;
		}
		if (name.endsWith('.rpm')) {
			return 2;
		}
	}

	return 1;
}
