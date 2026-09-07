/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

import {
	buildRipgrepArgs,
	fileTypeToRipgrepFlags,
	mergeWorkspaceSearchResults,
	resolveRipgrepBinary,
	resolveSearchMaxResults,
	resolveSearchRoots,
	summarizeSearchOutput,
	SYSTEMS_SEARCH_MAX_RESULTS,
} from '../../core/tools/ripgrep';
import { knoxExtensionRoot, knoxcoderRepoRoot } from './paths';

const knoxRoot = knoxExtensionRoot();
const repoRoot = knoxcoderRepoRoot();
const bundledRg = resolveRipgrepBinary([], repoRoot);

suite('buildRipgrepArgs', () => {
	test('does not pass -I (that is --no-filename in ripgrep)', () => {
		const args = buildRipgrepArgs('exactSearchImpl');
		assert.ok(!args.includes('-I'));
		assert.ok(args.includes('-H'));
		assert.ok(args.includes('--heading'));
		assert.ok(args.includes('--line-number'));
		assert.ok(args.includes('--no-config'));
		assert.ok(args.includes('-e'));
		assert.ok(args.includes('-F'));
		assert.strictEqual(args[args.indexOf('-e') + 1], 'exactSearchImpl');
		assert.strictEqual(args[args.indexOf('--') + 1], '.');
	});

	test('treats queries with regex metacharacters as literals by default', () => {
		const snippet = 'fn ui(&mut self,';
		const args = buildRipgrepArgs(snippet);
		assert.ok(args.includes('-F'));
		assert.ok(!args.includes('-P'));
		assert.strictEqual(args[args.indexOf('-e') + 1], snippet);
	});

	test('opts into regex with pcre2 or fixedStrings=false', () => {
		const pcre = buildRipgrepArgs('foo|bar', { pcre2: true });
		assert.ok(pcre.includes('-P'));
		assert.ok(!pcre.includes('-F'));

		const rustRe = buildRipgrepArgs('foo|bar', { fixedStrings: false });
		assert.ok(!rustRe.includes('-F'));
		assert.ok(!rustRe.includes('-P'));
	});

	test('never passes both -F and -P', () => {
		const args = buildRipgrepArgs('TODO', {
			pcre2: true,
			fixedStrings: true,
		});
		assert.ok(args.includes('-F'));
		assert.ok(!args.includes('-P'));
	});

	test('defaults to case-insensitive and 2 context lines', () => {
		const args = buildRipgrepArgs('foo');
		assert.ok(args.includes('-i'));
		assert.ok(args.includes('-C'));
		assert.strictEqual(args[args.indexOf('-C') + 1], '2');
		assert.ok(args.includes('--max-columns'));
		assert.ok(args.includes('-m'));
	});

	test('scopes to a path after --', () => {
		const args = buildRipgrepArgs('Game::new', { path: 'src' });
		assert.strictEqual(args[args.indexOf('--') + 1], 'src');
	});

	test('supports files_with_matches, excludes, multiline, and PCRE2', () => {
		const args = buildRipgrepArgs('TODO', {
			outputMode: 'files_with_matches',
			excludeGlob: 'dist/**',
			multiline: true,
			hidden: true,
			pcre2: true,
			fixedStrings: false,
		});
		assert.ok(args.includes('-l'));
		assert.ok(!args.includes('--heading'));
		assert.ok(args.includes('--glob'));
		assert.ok(args.includes('!dist/**'));
		assert.ok(args.includes('-U'));
		assert.ok(args.includes('--hidden'));
		assert.ok(args.includes('-P'));
		assert.ok(!args.includes('-F'));
	});

	test('uses -B/-A when split context is set', () => {
		const args = buildRipgrepArgs('foo', { beforeContext: 1, afterContext: 4 });
		assert.ok(args.includes('-B'));
		assert.strictEqual(args[args.indexOf('-B') + 1], '1');
		assert.ok(args.includes('-A'));
		assert.strictEqual(args[args.indexOf('-A') + 1], '4');
		assert.ok(!args.includes('-C'));
	});

	test('maps unknown file types to a glob and aliases rs/tsx', () => {
		assert.deepStrictEqual(fileTypeToRipgrepFlags('foo'), ['--glob', '*.foo']);
		assert.deepStrictEqual(fileTypeToRipgrepFlags('vue'), ['--type', 'vue']);
		assert.deepStrictEqual(fileTypeToRipgrepFlags('ts'), ['--type', 'ts']);
		assert.deepStrictEqual(fileTypeToRipgrepFlags('rs'), ['--type', 'rust']);
		assert.deepStrictEqual(fileTypeToRipgrepFlags('tsx'), ['--type', 'ts']);
		assert.deepStrictEqual(fileTypeToRipgrepFlags('yml'), ['--type', 'yaml']);
		assert.deepStrictEqual(fileTypeToRipgrepFlags('s'), ['--type', 'asm']);
	});
});

suite('summarizeSearchOutput / mergeWorkspaceSearchResults', () => {
	const sample = [
		'./core/tools/callTool.ts',
		'13-import { applyPatchImpl } from "./implementations/applyPatch";',
		'14:import { exactSearchImpl } from "./implementations/exactSearch";',
		'15-import { globImpl } from "./implementations/glob";',
		'',
		'./core/tools/implementations/exactSearch.ts',
		'14:export const exactSearchImpl: ToolImpl = async (args, extras) => {',
	].join('\n');

	test('counts files and match lines from --heading output', () => {
		assert.deepStrictEqual(summarizeSearchOutput(sample), {
			fileCount: 2,
			matchCount: 2,
		});
	});

	test('summarizes files_with_matches and count modes', () => {
		assert.deepStrictEqual(
			summarizeSearchOutput('./a.ts\n./b.ts', 'files_with_matches'),
			{ fileCount: 2, matchCount: 2 },
		);
		assert.deepStrictEqual(summarizeSearchOutput('./a.ts:3\n./b.ts:1', 'count'), {
			fileCount: 2,
			matchCount: 4,
		});
	});

	test('drops empty-root No matches found when another root hit', () => {
		const merged = mergeWorkspaceSearchResults(
			[sample, 'No matches found'],
			50,
		);
		assert.ok(merged.includes('./core/tools/callTool.ts'));
		assert.ok(!merged.includes('No matches found'));
	});

	test('enforces a total match cap (rg -m is per-file)', () => {
		const merged = mergeWorkspaceSearchResults([sample], 1);
		assert.ok(merged.includes('truncated; pass maxResults/path/fileType'));
		assert.ok(merged.includes('./core/tools/callTool.ts'));
		assert.ok(!merged.includes('exactSearch.ts'));
	});

	test('applies offset before the cap', () => {
		const merged = mergeWorkspaceSearchResults([sample], 1, { offset: 1 });
		assert.ok(merged.includes('exactSearch.ts'));
		assert.ok(!merged.includes('callTool.ts'));
	});

	test('uses 200 as the systems default maxResults', () => {
		assert.strictEqual(resolveSearchMaxResults(undefined, false), 50);
		assert.strictEqual(resolveSearchMaxResults(undefined, true), SYSTEMS_SEARCH_MAX_RESULTS);
		assert.strictEqual(resolveSearchMaxResults(12, true), 12);
	});
});

suite('resolveSearchRoots', () => {
	test('strips a workspace folder prefix', () => {
		const prefixed = `${path.basename(knoxRoot)}/core/tools/ripgrep.ts`;
		const roots = resolveSearchRoots([knoxRoot], prefixed);
		assert.ok(!('error' in roots));
		if ('error' in roots) {
			return;
		}
		assert.strictEqual(
			roots[0]?.searchPath.replace(/\\/g, '/'),
			'core/tools/ripgrep.ts',
		);
	});

	test('returns a path-not-found error', () => {
		const roots = resolveSearchRoots([knoxRoot], 'no/such/dir/here');
		assert.deepStrictEqual(roots, {
			error: 'Search error: path not found: no/such/dir/here',
		});
	});
});

suite('bundled ripgrep', () => {
	const rg = bundledRg && existsSync(bundledRg) ? bundledRg : null;

	test('is ripgrep with PCRE2', function (this: Mocha.Context) {
		if (!rg) {
			this.skip();
		}
		const result = spawnSync(rg, ['--version'], { encoding: 'utf8' });
		assert.strictEqual(result.status, 0);
		assert.match(result.stdout, /ripgrep \d/);
		assert.match(result.stdout, /\+pcre2/);
	});

	test('prints file headings when run with our argv', function (this: Mocha.Context) {
		if (!rg) {
			this.skip();
		}
		const args = buildRipgrepArgs('exactSearchImpl', {
			contextLines: 0,
			fileGlob: 'core/tools/**/*.ts',
		});
		const result = spawnSync(rg, args, {
			cwd: knoxRoot,
			encoding: 'utf8',
			timeout: 15_000,
		});
		assert.strictEqual(result.status, 0, result.stderr);
		assert.match(result.stdout, /^\.\/core\/tools\//m);
		assert.match(result.stdout, /^\d+:/m);
		assert.ok(summarizeSearchOutput(result.stdout).fileCount > 0);
		assert.ok(summarizeSearchOutput(result.stdout).matchCount > 0);
	});

	test('finds a literal snippet that would be an invalid regex', function (this: Mocha.Context) {
		if (!rg) {
			this.skip();
		}
		const snippet = 'export function buildRipgrepArgs(';
		const regexArgs = buildRipgrepArgs(snippet, {
			contextLines: 0,
			fileGlob: 'core/tools/ripgrep.ts',
			fixedStrings: false,
		});
		const regexResult = spawnSync(rg, regexArgs, {
			cwd: knoxRoot,
			encoding: 'utf8',
			timeout: 15_000,
		});
		assert.strictEqual(regexResult.status, 2);
		assert.match(regexResult.stderr, /regex parse error|unclosed group/i);

		const literalArgs = buildRipgrepArgs(snippet, {
			contextLines: 0,
			fileGlob: 'core/tools/ripgrep.ts',
		});
		assert.ok(literalArgs.includes('-F'));
		const literalResult = spawnSync(rg, literalArgs, {
			cwd: knoxRoot,
			encoding: 'utf8',
			timeout: 15_000,
		});
		assert.strictEqual(literalResult.status, 0, literalResult.stderr);
		assert.ok(literalResult.stdout.includes(snippet));
	});

	test('returns exit 1 with no matches', function (this: Mocha.Context) {
		if (!rg) {
			this.skip();
		}
		const args = buildRipgrepArgs('zzz_knox_no_such_token_xyz', {
			contextLines: 0,
			fileGlob: 'core/tools/builtIn.ts',
		});
		const result = spawnSync(rg, args, {
			cwd: knoxRoot,
			encoding: 'utf8',
			timeout: 15_000,
		});
		assert.strictEqual(result.status, 1);
	});

	test('accepts --type rust for .rs files (not --type rs)', function (this: Mocha.Context) {
		if (!rg) {
			this.skip();
		}
		const rustType = spawnSync(rg, ['--type-list'], { encoding: 'utf8' });
		assert.match(rustType.stdout, /^rust:/m);
		assert.doesNotMatch(rustType.stdout, /^rs:/m);
		const bad = spawnSync(rg, ['--type', 'rs', '-e', 'fn', '--', '.'], {
			cwd: knoxRoot,
			encoding: 'utf8',
			timeout: 10_000,
		});
		assert.strictEqual(bad.status, 2);
	});
});
