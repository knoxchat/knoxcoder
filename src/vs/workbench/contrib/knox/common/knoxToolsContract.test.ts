/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

function repoFile(...parts: string[]): string {
	return readFileSync(join(process.cwd(), ...parts), 'utf8');
}

function coreSources(): string {
	const dir = join(process.cwd(), 'extensions/knox/src/core/core');
	const files: string[] = [];
	const walk = (current: string) => {
		for (const name of readdirSync(current).sort()) {
			const path = join(current, name);
			if (statSync(path).isDirectory()) {
				walk(path);
			} else if (name.endsWith('.ts')) {
				files.push(readFileSync(path, 'utf8'));
			}
		}
	};
	walk(dir);
	return files.join('\n');
}

const BUILTIN_CASES = [
	'ReadFile', 'ReadCurrentlyOpenFile', 'ViewSubdirectory', 'Glob',
	'CreateNewFile', 'WriteFile', 'EditFile', 'ApplyPatch',
	'ViewDiff', 'ViewRepoMap', 'ExactSearch', 'SearchWeb',
	'EnhancedSearch', 'IntelligentChain',
	'RunTerminalCommand', 'AwaitShell', 'PtyStart', 'PtySend', 'PtyRead', 'Build',
	'GitStatus', 'GitDiff', 'GitLog', 'GitBlame', 'GitCommit', 'GitBisect',
	'Skill', 'Lsp', 'Task', 'AskUser', 'Plan', 'GenerateTests', 'WorkspaceCheckpoint',
	'Memory', 'MemoryGraph', 'MemorySessions', 'MemoryManage', 'MemoryLearn',
	'Qemu', 'Kconfig', 'Maintainers', 'Debug',
] as const;

suite('Knox tools honesty contract (KN-270–297)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const router = repoFile('extensions/knox/src/core/tools/callTool.ts');
	const aliases = repoFile('extensions/knox/src/core/tools/builtIn.ts');
	const composites = repoFile('extensions/knox/src/core/tools/implementations/composite/index.ts');

	test('KN-270–294: every builtin has a callTool router case', () => {
		const missing = BUILTIN_CASES.filter(name => !router.includes(`case BuiltInToolNames.${name}:`));
		assert.deepStrictEqual(missing, [], `callTool missing: ${missing.join(', ')}`);
	});

	test('KN-274: short-name aliases map onto catalog tools', () => {
		assert.ok(aliases.includes('read_file: BuiltInToolNames.ReadFile'));
		assert.ok(aliases.includes('grep: BuiltInToolNames.ExactSearch'));
		assert.ok(aliases.includes('bash: BuiltInToolNames.RunTerminalCommand'));
		assert.ok(aliases.includes('str_replace: BuiltInToolNames.EditFile'));
	});

	test('KN-295: seven composite implementations are registered', () => {
		for (const name of [
			'composite_smart_edit',
			'composite_implement_feature',
			'composite_investigate_bug',
			'composite_code_review',
			'composite_migrate',
			'composite_health_check',
			'composite_learn_codebase',
		]) {
			assert.ok(composites.includes(`${name}:`), name);
		}
	});

	test('KN-296–297: worktree handler + honesty-gate test stay in tree', () => {
		assert.ok(coreSources().includes('on("agent/worktree"'));
		const honesty = repoFile('extensions/knox/src/core/eval/honestyGate.test.ts');
		assert.ok(honesty.includes('hasToolImplementation'));
		assert.ok(honesty.includes('unimplementedAdvancedTools'));
		assert.ok(honesty.includes('SmartToolRouter'));
	});
});
