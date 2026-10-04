#!/usr/bin/env node
/**
 * Release readiness check and version bump (v2-impl.md, "Release checklist").
 *
 *   node scripts/ci/release-check.mjs              # check the current tree
 *   node scripts/ci/release-check.mjs --tag v2.0.0 # also require package.json == tag (CI on tag push)
 *   node scripts/ci/release-check.mjs --bump 2.0.0 [--date YYYY-MM-DD] [--write]
 *        # dry-run by default: promotes CHANGELOG [Unreleased] to [<version>] and sets package.json version.
 *
 * Exits non-zero when a check fails.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => readFileSync(join(root, p), 'utf8');
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** Promote `## [Unreleased]` to a dated version heading and add a fresh empty Unreleased section. */
export function promoteChangelog(text, version, date) {
	if (!/^## \[Unreleased\][ \t]*$/m.test(text)) {
		throw new Error('CHANGELOG.md has no "## [Unreleased]" heading');
	}
	if (new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm').test(text)) {
		throw new Error(`CHANGELOG.md already has a [${version}] section`);
	}
	return text.replace(/^## \[Unreleased\][ \t]*$/m, `## [Unreleased]\n\n## [${version}] - ${date}`);
}

export function setPackageVersion(json, version) {
	return json.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
}

function check(tag) {
	const problems = [];
	const pkg = JSON.parse(read('package.json'));
	const changelog = read('CHANGELOG.md');
	const version = pkg.version;

	if (!SEMVER.test(version)) { problems.push(`package.json version "${version}" is not semver`); }
	if (tag && tag !== `v${version}`) { problems.push(`tag ${tag} does not match package.json version ${version}`); }

	const stable = !version.includes('-');
	const heading = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]( - \\d{4}-\\d{2}-\\d{2})?\\s*$`, 'm');
	if (!heading.test(changelog)) { problems.push(`CHANGELOG.md has no "## [${version}]" section`); }

	if (stable) {
		const unreleased = changelog.split(/^## \[Unreleased\][ \t]*$/m)[1]?.split(/^## \[/m)[0] ?? '';
		if (unreleased.trim()) { problems.push('CHANGELOG.md [Unreleased] still has entries; promote them to the release section'); }
		if (!/^## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}/m.test(changelog.split(/^## \[Unreleased\][ \t]*$/m)[1] ?? '')) {
			problems.push('CHANGELOG.md release section has no date');
		}
		const product = JSON.parse(read('product.json'));
		if (product.quality !== 'stable') { problems.push(`product.json quality is "${product.quality}", expected "stable"`); }
		const ci = read('.github/workflows/knox-ci.yml');
		if (/^\s*continue-on-error:\s*true/m.test(ci)) {
			console.warn('  WARN .github/workflows/knox-ci.yml still has continue-on-error: true (GUI job does not gate packaging)');
		}
		const security = read('SECURITY.md');
		if (!security.includes(version.replace(/\.\d+$/, '.x'))) {
			problems.push(`SECURITY.md supported-versions table does not mention ${version.replace(/\.\d+$/, '.x')}`);
		}
	}
	return { version, stable, problems };
}

function main(argv) {
	const arg = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
	const bump = arg('--bump');

	if (bump) {
		if (!SEMVER.test(bump)) { console.error(`Invalid version: ${bump}`); return 2; }
		const date = arg('--date') ?? new Date().toISOString().slice(0, 10);
		const nextChangelog = promoteChangelog(read('CHANGELOG.md'), bump, date);
		const nextPkg = setPackageVersion(read('package.json'), bump);
		if (argv.includes('--write')) {
			writeFileSync(join(root, 'CHANGELOG.md'), nextChangelog);
			writeFileSync(join(root, 'package.json'), nextPkg);
			console.log(`Bumped to ${bump} (${date}). Review with git diff, then run this script without --bump.`);
		} else {
			console.log(`Dry run: would set package.json to ${bump} and promote CHANGELOG [Unreleased] to [${bump}] - ${date}. Add --write to apply.`);
		}
		return 0;
	}

	const { version, stable, problems } = check(arg('--tag'));
	console.log(`Release check for ${version} (${stable ? 'stable' : 'prerelease: stable-only checks skipped'})`);
	for (const p of problems) { console.error(`  FAIL ${p}`); }
	if (!problems.length) { console.log('  OK'); }
	return problems.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	process.exit(main(process.argv.slice(2)));
}
