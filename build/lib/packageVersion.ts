/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Numeric x.y.z from an npm version. Windows VersionInfoVersion / Inno
 * RawVersion cannot include a prerelease suffix.
 */
export function numericPackageVersion(npmVersion: string): string {
	return npmVersion.replace(/-.*$/, '');
}

/**
 * Map an npm/semver version onto a Linux package Version.
 *
 * RPM rejects `-` in Version (`Illegal char '-'`). Debian and RPM both treat
 * `~` as a prerelease marker so `2.0.0~beta` sorts before `2.0.0`. Remaining
 * hyphens inside the prerelease identifier become `.`.
 *
 * `2.0.0-beta`   → `2.0.0~beta`
 * `2.0.0-rc.1`   → `2.0.0~rc.1`
 * `2.0.0`        → `2.0.0`
 */
export function linuxPackageVersion(npmVersion: string): string {
	const dash = npmVersion.indexOf('-');
	if (dash < 0) {
		assertNumericVersion(npmVersion, npmVersion);
		return npmVersion;
	}

	const numeric = npmVersion.slice(0, dash);
	assertNumericVersion(numeric, npmVersion);
	const prerelease = npmVersion.slice(dash + 1).replace(/-/g, '.');
	if (!prerelease || /[^A-Za-z0-9.+]/.test(prerelease)) {
		throw new Error(`Cannot map npm version '${npmVersion}' to a Linux package Version`);
	}

	return `${numeric}~${prerelease}`;
}

/**
 * Product version embedded in CI artifact names such as
 * `KnoxCoder-2.0.0-beta-linux-arm64.tar.gz`. Stops before the platform token
 * so a stable `2.0.0` is not parsed as `2.0.0-linux`.
 */
export function versionFromKnoxCoderAssetName(fileName: string): string | undefined {
	const match = /KnoxCoder-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-(?:linux|win32|darwin|macos)/i.exec(fileName);
	return match?.[1];
}

function assertNumericVersion(numeric: string, original: string): void {
	if (!/^\d+\.\d+\.\d+$/.test(numeric)) {
		throw new Error(`Invalid numeric version in '${original}'`);
	}
}
