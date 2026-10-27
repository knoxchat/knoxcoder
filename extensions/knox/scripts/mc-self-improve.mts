/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * MC-48: manual self-analysis of this repo (knoxchat/knoxcoder).
 *
 *   npm run mc:self-improve [-- --since "90 days ago"] [--history history.json]
 *
 * Writes `docs/self-improve/<date>-self-improve.md`. Local only: no network, no issue is opened.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(root, '..', '..');

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

const cache = path.join(root, 'node_modules', '.cache');
fs.mkdirSync(cache, { recursive: true });
const outfile = path.join(cache, 'knox-self-improve.mjs');
try {
	await build({
		entryPoints: [path.join(root, 'src/core/context/memory/selfImprove/selfAnalysis.ts')],
		bundle: true,
		platform: 'node',
		format: 'esm',
		outfile,
		logLevel: 'error',
		external: ['sqlite3', 'sqlite'],
	});
	const { runSelfAnalysis } = await import(pathToFileURL(outfile).href);

	const scanDirs = ['extensions/knox', 'src/vs/workbench/contrib/knox'];
	const gitLog = execFileSync(
		'git',
		['log', `--since=${arg('since') ?? '90 days ago'}`, '--name-only', '--pretty=format:@@%h', '--', ...scanDirs],
		{ cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
	);
	const historyPath = arg('history');
	const baseline = JSON.parse(
		fs.readFileSync(path.join(root, 'src/core/context/memory/bench/baseline.json'), 'utf8'),
	);
	const knoxDir = process.env.KNOX_GLOBAL_DIR ?? path.join(os.homedir(), '.knoxcoder');
	const brainSqlitePath = arg('brain') ?? path.join(knoxDir, 'memory', 'brain.sqlite');
	const auditEventsPath = arg('audit') ?? path.join(knoxDir, 'checkpoints', 'events.jsonl');
	const file = await runSelfAnalysis({
		repoRoot,
		scanDirs,
		packageDir: root,
		outDir: path.join(root, 'docs', 'self-improve'),
		gitLog,
		history: historyPath ? JSON.parse(fs.readFileSync(path.resolve(historyPath), 'utf8')) : undefined,
		baseline,
		brainSqlitePath: fs.existsSync(brainSqlitePath) ? brainSqlitePath : undefined,
		auditEventsPath: fs.existsSync(auditEventsPath) ? auditEventsPath : undefined,
	});
	console.log(`[mc:self-improve] wrote ${path.relative(repoRoot, file)}`);
} finally {
	fs.rmSync(outfile, { force: true });
	fs.rmSync(`${outfile}.map`, { force: true });
}
