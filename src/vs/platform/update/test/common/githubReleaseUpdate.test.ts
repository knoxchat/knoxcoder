/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	canonicalizeGitHubDownloadUrl,
	createGitHubLatestFeedUrl,
	createGitHubLatestReleaseUrl,
	createGitHubReleaseByTagUrls,
	githubReleaseToUpdate,
	isCurrentVersionLatest,
	isDirectReleaseAssetUrl,
	isGitHubApiUrl,
	isGitHubLatestFeedUrl,
	isGitHubReleasePayload,
	isGitHubUpdateUrl,
	isInstallerPackageUrl,
	normalizeReleaseVersion,
	parseGitHubRepository,
	platformToGitHubAssetQuery,
	resolveForcedDownloadUrl,
	selectGitHubReleaseAsset,
	selectSquirrelFeedUrl,
	squirrelFeedAssetName,
	squirrelFeedToUpdate,
	type IGitHubRelease,
} from '../../common/githubReleaseUpdate.js';

suite('KnoxCoder GitHub auto-update', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('builds release-by-tag URLs for release notes', () => {
		assert.deepStrictEqual(createGitHubReleaseByTagUrls('https://github.com/knoxchat/knoxcoder', '1.138.2'), [
			'https://api.github.com/repos/knoxchat/knoxcoder/releases/tags/v1.138.2',
			'https://api.github.com/repos/knoxchat/knoxcoder/releases/tags/1.138.2',
		]);
		assert.deepStrictEqual(createGitHubReleaseByTagUrls('https://update.example', '1.0.0'), []);
	});

	test('parses the KnoxCoder GitHub repository', () => {
		assert.deepStrictEqual(parseGitHubRepository('https://github.com/knoxchat/knoxcoder'), { owner: 'knoxchat', repo: 'knoxcoder' });
		assert.deepStrictEqual(parseGitHubRepository('https://github.com/knoxchat/knoxcoder.git'), { owner: 'knoxchat', repo: 'knoxcoder' });
		assert.deepStrictEqual(parseGitHubRepository('https://api.github.com/repos/knoxchat/knoxcoder/releases/latest'), { owner: 'knoxchat', repo: 'knoxcoder' });
		assert.strictEqual(parseGitHubRepository('https://update.example/api'), undefined);
		assert.strictEqual(isGitHubUpdateUrl('https://github.com/knoxchat/knoxcoder'), true);
	});

	test('builds the GitHub latest-release API URL', () => {
		assert.strictEqual(
			createGitHubLatestReleaseUrl('https://github.com/knoxchat/knoxcoder'),
			'https://api.github.com/repos/knoxchat/knoxcoder/releases/latest',
		);
	});

	test('compares KnoxCoder versions from GitHub tags', () => {
		assert.strictEqual(normalizeReleaseVersion('v1.138.2'), '1.138.2');
		assert.strictEqual(normalizeReleaseVersion('v2.0.0-beta'), '2.0.0-beta');
		assert.strictEqual(isCurrentVersionLatest('1.138.1', '1.138.1'), true);
		assert.strictEqual(isCurrentVersionLatest('1.138.2', '1.138.1'), true);
		assert.strictEqual(isCurrentVersionLatest('1.138.1', 'v1.138.2'), false);
		assert.strictEqual(isCurrentVersionLatest('1.138.2', 'v2.0.0-beta'), false);
		assert.strictEqual(isCurrentVersionLatest('2.0.0-beta', 'v2.0.0-beta'), true);
		assert.strictEqual(isCurrentVersionLatest('2.0.0-beta', 'v2.0.0'), false);
		assert.strictEqual(isCurrentVersionLatest('2.2.0', 'v2.2.1'), false);
		assert.strictEqual(isCurrentVersionLatest('2.2.1', 'v2.2.1'), true);
		assert.strictEqual(isCurrentVersionLatest('2.2.1', 'v2.2.0'), true);
	});

	test('builds the unauthenticated latest-*.json feed URL', () => {
		assert.strictEqual(
			createGitHubLatestFeedUrl('https://github.com/knoxchat/knoxcoder', { platform: 'darwin', arch: 'arm64' }),
			'https://github.com/knoxchat/knoxcoder/releases/latest/download/latest-darwin-arm64.json',
		);
		assert.strictEqual(
			createGitHubLatestFeedUrl('https://github.com/knoxchat/knoxcoder', { platform: 'win32', arch: 'x64', target: 'user' }),
			'https://github.com/knoxchat/knoxcoder/releases/latest/download/latest-win32-x64-user.json',
		);
		assert.strictEqual(
			createGitHubLatestFeedUrl('https://github.com/knoxchat/knoxcoder', { platform: 'win32', arch: 'x64', target: 'system' }),
			'https://github.com/knoxchat/knoxcoder/releases/latest/download/latest-win32-x64-system.json',
		);
		assert.strictEqual(isGitHubLatestFeedUrl('https://github.com/knoxchat/knoxcoder/releases/latest/download/latest-linux-x64.json'), true);
		assert.strictEqual(isGitHubApiUrl('https://api.github.com/repos/knoxchat/knoxcoder/releases/latest'), true);
		assert.strictEqual(isGitHubApiUrl('https://github.com/knoxchat/knoxcoder/releases/latest/download/latest-linux-x64.json'), false);
		assert.deepStrictEqual(platformToGitHubAssetQuery('win32-x64'), { platform: 'win32', arch: 'x64', target: 'system' });
		assert.deepStrictEqual(platformToGitHubAssetQuery('win32-x64-user'), { platform: 'win32', arch: 'x64', target: 'user' });
		assert.deepStrictEqual(platformToGitHubAssetQuery('linux-arm64'), { platform: 'linux', arch: 'arm64' });
		assert.deepStrictEqual(platformToGitHubAssetQuery('darwin'), { platform: 'darwin', arch: 'x64' });
		assert.deepStrictEqual(platformToGitHubAssetQuery('darwin-arm64'), { platform: 'darwin', arch: 'arm64' });
	});

	test('parses latest-*.json and rewrites a CI run tag onto v<version>', () => {
		const update = squirrelFeedToUpdate({
			url: 'https://github.com/knoxchat/knoxcoder/releases/download/v36-build.1/KnoxCoder-2.2.1-linux-x64.tar.gz',
			name: '2.2.1',
			version: 'abc1234',
			productVersion: '2.2.1',
			sha256hash: 'deadbeef',
			timestamp: 1,
		});

		assert.deepStrictEqual(update, {
			url: 'https://github.com/knoxchat/knoxcoder/releases/download/v2.2.1/KnoxCoder-2.2.1-linux-x64.tar.gz',
			version: 'abc1234',
			productVersion: '2.2.1',
			sha256hash: 'deadbeef',
			timestamp: 1,
		});
		assert.strictEqual(
			canonicalizeGitHubDownloadUrl(
				'https://github.com/knoxchat/knoxcoder/releases/download/v2.2.1/KnoxCoder-2.2.1-linux-x64.tar.gz',
				'2.2.1',
			),
			'https://github.com/knoxchat/knoxcoder/releases/download/v2.2.1/KnoxCoder-2.2.1-linux-x64.tar.gz',
		);
	});

	test('Download Update prefers the package URL over the releases page', () => {
		const packageUrl = 'https://github.com/knoxchat/knoxcoder/releases/download/v2.2.1/KnoxCoder-2.2.1-linux-x64.tar.gz';
		assert.strictEqual(isDirectReleaseAssetUrl(packageUrl), true);
		assert.strictEqual(isDirectReleaseAssetUrl('https://github.com/knoxchat/knoxcoder/releases/latest'), false);
		assert.strictEqual(isDirectReleaseAssetUrl('https://github.com/knoxchat/knoxcoder/releases/latest/download/latest-linux-x64.json'), false);
		assert.strictEqual(
			resolveForcedDownloadUrl({ url: packageUrl }, 'https://github.com/knoxchat/knoxcoder/releases/latest'),
			packageUrl,
		);
		assert.strictEqual(
			resolveForcedDownloadUrl({ url: 'https://github.com/knoxchat/knoxcoder/releases/latest' }, 'https://github.com/knoxchat/knoxcoder/releases/latest'),
			'https://github.com/knoxchat/knoxcoder/releases/latest',
		);
	});

	test('picks the installer for the running KnoxCoder package', () => {
		const release = sampleRelease();

		assert.strictEqual(
			selectGitHubReleaseAsset(release, { platform: 'win32', arch: 'x64', target: 'user' })?.name,
			'KnoxCoder-1.138.2-win32-x64-user-setup.exe',
		);
		assert.strictEqual(
			selectGitHubReleaseAsset(release, { platform: 'win32', arch: 'x64', target: 'system' })?.name,
			'KnoxCoder-1.138.2-win32-x64-system-setup.exe',
		);
		assert.strictEqual(
			selectGitHubReleaseAsset(release, { platform: 'linux', arch: 'x64' })?.name,
			'KnoxCoder-1.138.2-linux-x64.tar.gz',
		);
		assert.strictEqual(
			selectGitHubReleaseAsset(release, { platform: 'darwin', arch: 'arm64' })?.name,
			'KnoxCoder-1.138.2-darwin-arm64.zip',
		);
		assert.strictEqual(
			selectGitHubReleaseAsset(release, { platform: 'linux', arch: 'arm64' })?.name,
			'KnoxCoder-1.138.2-linux-arm64.tar.gz',
		);
	});

	test('does not treat arm64 assets as x64', () => {
		const release: IGitHubRelease = {
			tag_name: 'v1.0.0',
			assets: [{ name: 'KnoxCoder-1.0.0-linux-arm64.tar.gz', browser_download_url: 'https://example/arm64' }],
		};

		assert.strictEqual(selectGitHubReleaseAsset(release, { platform: 'linux', arch: 'x64' }), undefined);
	});

	test('maps a GitHub release onto an installable KnoxCoder update', () => {
		const update = githubReleaseToUpdate(sampleRelease(), { platform: 'win32', arch: 'x64', target: 'user' }, 'https://github.com/knoxchat/knoxcoder/releases');

		assert.deepStrictEqual(update, {
			version: '1.138.2',
			productVersion: '1.138.2',
			url: 'https://example.test/KnoxCoder-1.138.2-win32-x64-user-setup.exe',
			timestamp: Date.parse('2026-10-02T00:00:00.000Z'),
		});
		assert.strictEqual(isInstallerPackageUrl(update?.url), true);
		assert.strictEqual(isGitHubReleasePayload(sampleRelease()), true);
		assert.strictEqual(isGitHubReleasePayload({ message: 'API rate limit exceeded' }), false);
	});

	test('falls back to the releases page when the platform asset is missing', () => {
		const update = githubReleaseToUpdate(
			{ tag_name: 'v1.138.2', html_url: 'https://github.com/knoxchat/knoxcoder/releases/tag/v1.138.2', assets: [] },
			{ platform: 'darwin', arch: 'arm64' },
			'https://github.com/knoxchat/knoxcoder/releases/latest',
		);

		assert.strictEqual(update?.url, 'https://github.com/knoxchat/knoxcoder/releases/latest');
		assert.strictEqual(isInstallerPackageUrl(update?.url), false);
	});

	test('finds a macOS auto-update feed next to the release assets', () => {
		assert.strictEqual(squirrelFeedAssetName({ platform: 'darwin', arch: 'arm64' }), 'latest-darwin-arm64.json');
		assert.strictEqual(
			selectSquirrelFeedUrl(sampleRelease(), { platform: 'darwin', arch: 'arm64' }),
			'https://example.test/latest-darwin-arm64.json',
		);
	});
});

function sampleRelease(): IGitHubRelease {
	return {
		tag_name: 'v1.138.2',
		html_url: 'https://github.com/knoxchat/knoxcoder/releases/tag/v1.138.2',
		published_at: '2026-10-02T00:00:00.000Z',
		target_commitish: 'main',
		assets: [
			{ name: 'KnoxCoder-1.138.2-linux-x64.tar.gz', browser_download_url: 'https://example.test/KnoxCoder-1.138.2-linux-x64.tar.gz' },
			{ name: 'KnoxCoder-1.138.2-linux-arm64.tar.gz', browser_download_url: 'https://example.test/KnoxCoder-1.138.2-linux-arm64.tar.gz' },
			{ name: 'KnoxCoder-1.138.2-win32-x64.zip', browser_download_url: 'https://example.test/KnoxCoder-1.138.2-win32-x64.zip' },
			{ name: 'KnoxCoder-1.138.2-win32-x64-user-setup.exe', browser_download_url: 'https://example.test/KnoxCoder-1.138.2-win32-x64-user-setup.exe' },
			{ name: 'KnoxCoder-1.138.2-win32-x64-system-setup.exe', browser_download_url: 'https://example.test/KnoxCoder-1.138.2-win32-x64-system-setup.exe' },
			{ name: 'KnoxCoder-1.138.2-darwin-arm64.zip', browser_download_url: 'https://example.test/KnoxCoder-1.138.2-darwin-arm64.zip' },
			{ name: 'KnoxCoder-darwin-arm64.dmg', browser_download_url: 'https://example.test/KnoxCoder-darwin-arm64.dmg' },
			{ name: 'latest-darwin-arm64.json', browser_download_url: 'https://example.test/latest-darwin-arm64.json' },
		],
	};
}
