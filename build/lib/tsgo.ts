/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ansiColors from 'ansi-colors';
import * as cp from 'child_process';
import es from 'event-stream';
import fancyLog from 'fancy-log';
import * as path from 'path';
import { nativeTscExtraArgs, nativeTscPath } from './nativeTsc.ts';

const root = path.dirname(path.dirname(import.meta.dirname));
const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
const timestampRegex = /^\[\d{2}:\d{2}:\d{2}\]\s*/;

/**
 * Invokes the native TypeScript 7 CLI via {@link nativeTscPath} (tsrs,
 * including Windows ARM64; Go `tsc` only if the optional tsrs platform
 * package is missing).
 * Despite the historical "tsgo" naming in callers, this never runs the
 * JavaScript compiler from `@typescript/typescript6`.
 */
export function spawnTsgo(projectPath: string, config: { taskName: string; noEmit?: boolean }, onComplete?: () => Promise<void> | void): Promise<void> {
	function runReporter(output: string, failed: boolean) {
		const lines = (output || '').split('\n').filter(line => line.length > 0);
		const errorLines = lines.filter(line => /error \w+:/.test(line));
		fancyLog(`Finished ${ansiColors.green(config.taskName)} ${projectPath} with ${errorLines.length} errors.`);
		for (const line of errorLines) {
			fancyLog(line);
		}
		if (failed) {
			for (const line of lines.filter(line => !errorLines.includes(line))) {
				fancyLog(line);
			}
		}
	}

	const args = [nativeTscPath, ...nativeTscExtraArgs, '--project', projectPath, '--pretty', 'false', '--incremental'];
	if (config.noEmit) {
		// Emitting builds delete their build info before compiling, so concurrent type checks need a separate cache.
		const tsBuildInfoFile = path.join(path.dirname(projectPath), `${path.basename(projectPath, '.json')}.typecheck.tsbuildinfo`);
		args.push('--noEmit', '--tsBuildInfoFile', tsBuildInfoFile);
	} else {
		args.push('--sourceMap', '--inlineSources');
	}
	const child = cp.spawn(process.execPath, args, {
		cwd: root,
		stdio: ['ignore', 'pipe', 'pipe']
	});

	let stdoutData = '';
	let stderrData = '';

	child.stdout?.on('data', (data: Buffer) => {
		stdoutData += data.toString();
	});
	child.stderr?.on('data', (data: Buffer) => {
		stderrData += data.toString();
	});

	return new Promise<void>((resolve, reject) => {
		child.on('exit', code => {
			const allOutput = stdoutData + '\n' + stderrData;
			const lines = allOutput
				.split(/\r?\n/)
				.map(line => line.replace(ansiRegex, '').trim())
				.map(line => line.replace(timestampRegex, ''))
				.filter(line => line.length > 0)
				.filter(line => !/Starting compilation|File change detected|Compilation complete/i.test(line));

			runReporter(lines.join('\n'), code !== 0);

			if (code === 0) {
				Promise.resolve(onComplete?.()).then(() => resolve(), reject);
			} else {
				const detail = lines.length ? `\n${lines.join('\n')}` : '';
				reject(new Error(`tsc exited with code ${code ?? 'unknown'}${detail}`));
			}
		});

		child.on('error', err => {
			reject(err);
		});
	});
}

export function createTsgoStream(projectPath: string, config: { taskName: string; noEmit?: boolean }, onComplete?: () => Promise<void> | void): NodeJS.ReadWriteStream {
	const stream = es.through();

	spawnTsgo(projectPath, config, onComplete).then(() => {
		stream.emit('end');
	}).catch(err => {
		stream.emit('error', err);
	});

	return stream as NodeJS.ReadWriteStream;
}
