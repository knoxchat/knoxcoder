import assert from 'node:assert/strict';
import test from 'node:test';
import { promoteChangelog, setPackageVersion } from './release-check.mjs';

test('promoteChangelog moves Unreleased under a dated heading', () => {
	const out = promoteChangelog('# C\n\n## [Unreleased]\n\n- a\n\n## [1.0.0] - 2026-01-01\n', '2.0.0', '2026-10-06');
	assert.match(out, /## \[Unreleased\]\n\n## \[2\.0\.0\] - 2026-10-06\n\n- a/);
});

test('promoteChangelog refuses duplicates and missing Unreleased', () => {
	assert.throws(() => promoteChangelog('## [2.0.0] - x\n', '2.0.0', 'd'));
	assert.throws(() => promoteChangelog('## [Unreleased]\n## [2.0.0] - x\n', '2.0.0', 'd'));
});

test('setPackageVersion only touches the first version field', () => {
	const out = setPackageVersion('{\n  "version": "2.0.0-beta",\n  "x": {"version": "1"}\n}', '2.0.0');
	assert.match(out, /"version": "2\.0\.0",/);
	assert.match(out, /"x": \{"version": "1"\}/);
});
