/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * MC-46: self-eval gate. Runs the memory bench and the golden evals, then compares the bench
 * summary with `bench/baseline.json`. Exits non-zero on any regression, so a change to retrieval
 * or replay thresholds cannot land silently.
 *
 *   npm run mc:gate
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareToBaseline } from '../src/core/context/memory/bench/gate.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(root, 'src/core/context/memory/bench/baseline.json');
const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'knox-mc-gate-')), 'bench.json');

function vitest(filters: string[], env: NodeJS.ProcessEnv = {}): boolean {
	const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
	const res = spawnSync(bin, ['vitest', 'run', '--config', 'src/core/vitest.config.ts', ...filters], {
		cwd: root,
		stdio: 'inherit',
		env: { ...process.env, ...env },
		shell: process.platform === 'win32',
	});
	return res.status === 0;
}

const failures: string[] = [];

console.log('[mc:gate] memory bench');
if (!vitest(['context/memory/bench'], { KNOX_BENCH_OUT: outFile })) {
	failures.push('memory bench suite failed');
}

console.log('[mc:gate] golden evals');
if (!vitest(['eval'])) {
	failures.push('golden eval suite failed');
}

if (fs.existsSync(outFile)) {
	const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
	const current = JSON.parse(fs.readFileSync(outFile, 'utf8'));
	const result = compareToBaseline(current, baseline);
	console.log('[mc:gate] current ', JSON.stringify(current));
	console.log('[mc:gate] baseline', JSON.stringify({
		recallAtK: baseline.recallAtK,
		precision: baseline.precision,
		falseInjectRate: baseline.falseInjectRate,
		tokensMean: baseline.tokensMean,
	}));
	failures.push(...result.failures);
} else {
	failures.push('memory bench did not produce a summary');
}

fs.rmSync(path.dirname(outFile), { recursive: true, force: true });

if (failures.length) {
	console.error('[mc:gate] FAILED:\n  - ' + failures.join('\n  - '));
	process.exit(1);
}
console.log('[mc:gate] OK');
