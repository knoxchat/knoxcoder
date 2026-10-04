/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	createGitHubLatestReleaseUrl,
	createGitHubReleaseByTagUrls,
	githubReleaseToUpdate,
	isCurrentVersionLatest,
	isGitHubReleasePayload,
	isGitHubUpdateUrl,
	isInstallerPackageUrl,
	normalizeReleaseVersion,
	parseGitHubRepository,
	selectGitHubReleaseAsset,
	selectSquirrelFeedUrl,
	squirrelFeedAssetName,
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
