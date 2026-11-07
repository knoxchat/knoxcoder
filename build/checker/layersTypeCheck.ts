/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import { availableParallelism, freemem } from 'os';
import { join } from 'path';
import { nativeTscExtraArgs, nativeTscPath } from '../lib/nativeTsc.ts';

//
// Type checks the sources of every target environment against the lib and type
// definitions that environment actually provides. A file that reaches out to an
// API of another layer fails to compile here.
//
// NOTE: The type based layer checks live in build/checker/layersChecker.ts.
//

const PROJECTS = [
	'browser',
	'worker',
	'node',
	'electron-browser',
	'electron-main',
	'electron-utility',
];

/**
 * Memory to budget for a single type check. The largest of the projects peaks at
 * around 3.5GB, so this leaves a little room on top of that.
 */
const MEMORY_PER_CHECK = 4 * 1024 * 1024 * 1024;

/** Share of the free memory to leave untouched so the machine does not start swapping. */
const MEMORY_HEADROOM = 0.25;

/**
 * Absolute path to the native TypeScript 7 launcher (tsrs, or Go `tsc` when
 * tsrs has no binary for this host). Invoking it via `node` keeps us off the
 * JavaScript `@typescript/typescript6` install.
 */
const tscPath = nativeTscPath;

/**
 * The projects overlap heavily but are independent, so they can be checked in
 * parallel. Each check is memory hungry enough that running all of them at once
 * can push a smaller machine into swapping, which costs far more than checking
 * the projects one after another, so free memory is what decides how many run
 * at a time.
 */
function getConcurrency(): number {
	const affordableChecks = Math.floor(freemem() * (1 - MEMORY_HEADROOM) / MEMORY_PER_CHECK);

	return Math.max(1, Math.min(PROJECTS.length, availableParallelism(), affordableChecks));
}

function typeCheck(project: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = cp.spawn(process.execPath, [tscPath, ...nativeTscExtraArgs, '--project', join(import.meta.dirname, `tsconfig.${project}.json`), '--pretty', 'false'], { stdio: ['ignore', 'pipe', 'pipe'] });

		let output = '';
		child.stdout.on('data', data => output += data.toString());
		child.stderr.on('data', data => output += data.toString());

		child.on('error', reject);
		// `close` rather than `exit`, so the captured output is complete before it is inspected.
		child.on('close', code => resolve(code === 0 ? '' : output.trim() || `tsc exited with code ${code ?? 'unknown'}.`));
	});
}

async function typeCheckAll(projects: readonly string[], concurrency: number): Promise<string[]> {
	const results: string[] = [];
	let next = 0;

	async function runNext(): Promise<void> {
		while (next < projects.length) {
			const index = next++;
			results[index] = await typeCheck(projects[index]);
		}
	}

	await Promise.all(Array.from({ length: concurrency }, runNext));

	return results;
}

// Report the output in a stable order once all checks are done.
const results = await typeCheckAll(PROJECTS, getConcurrency());

for (const result of results) {
	if (result) {
		console.log(result);
	}
}

process.exitCode = results.some(result => result) ? 1 : 0;
