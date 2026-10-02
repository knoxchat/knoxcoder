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

suite('Knox agent loop contract (KN-260–267)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('KN-260: runAgentLoop stop reasons stay product-stable', () => {
		const loop = repoFile('extensions/knox/src/core/agent/loop.ts');
		assert.ok(loop.includes('export async function runAgentLoop'));
		for (const reason of ['max_steps', 'doom_loop']) {
			assert.ok(loop.includes(`"${reason}"`) || loop.includes(`'${reason}'`) || loop.includes(reason), reason);
		}
	});

	test('KN-261: consecutive readonly tools run in parallel', () => {
		const loop = repoFile('extensions/knox/src/core/agent/loop.ts');
		assert.ok(loop.includes('parallelReadonly'));
		assert.ok(loop.includes('canRunToolInParallel'));
		assert.ok(loop.includes('Promise.all'));
	});

	test('KN-262: doom-loop defaults 3 / systems 5 / rust 4', () => {
		const profile = repoFile('extensions/knox/src/core/config/agentProfile.ts');
		assert.ok(profile.includes('DEFAULT_DOOM_LOOP_THRESHOLD = 3'));
		assert.ok(profile.includes('RUST_DOOM_LOOP_THRESHOLD = 4'));
		assert.ok(profile.includes('SYSTEMS_DOOM_LOOP_THRESHOLD = 5'));
		assert.ok(repoFile('extensions/knox/src/core/agent/doomLoop.ts').includes('fail_streak'));
	});

	test('KN-263: permission modes default | acceptEdits | fullAuto', () => {
		const policy = repoFile('extensions/knox/src/core/tools/toolPolicy.ts');
		assert.ok(policy.includes('permissionMode: "default" | "acceptEdits" | "fullAuto"'));
		assert.ok(policy.includes('allowedWithPermission') || policy.includes('fullAuto'));
	});

	test('KN-264: hard policy denies ssh, gnupg, rm -rf, mkfs', () => {
		const policy = repoFile('extensions/knox/src/core/tools/toolPolicy.ts');
		assert.ok(policy.includes('~/.ssh/**'));
		assert.ok(policy.includes('~/.gnupg/**'));
		assert.ok(policy.includes('rm -rf *'));
		assert.ok(policy.includes('mkfs'));
	});

	test('KN-265: compaction pipeline emits compaction/applied', () => {
		assert.ok(repoFile('extensions/knox/src/core/compaction/index.ts').includes('export'));
		assert.ok(repoFile('extensions/knox/src/core/llm/streamChat.ts').includes('compaction/applied'));
		assert.ok(repoFile('extensions/knox/src/core/protocol/passThrough.ts').includes('"compaction/applied"'));
	});

	test('KN-266: jev/gateTool always allows', () => {
		const gate = repoFile('extensions/knox/src/core/jev/toolGate.ts');
		assert.ok(gate.includes('Jev does not allow, deny, or rewrite tool calls'));
		assert.ok(gate.includes('action: "allow"'));
		assert.ok(coreSources().includes('on("jev/gateTool"'));
	});

	test('KN-267: native GUI owns /autonomous + stream adapters', () => {
		const stream = repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/stream.ts');
		assert.ok(stream.includes("slashCommandBareName(command.name) === 'autonomous'"));
		assert.ok(stream.includes("'brain/runAutonomousLoop'"));
		assert.ok(stream.includes("'brain/resolveAutonomousTool'"));
		assert.ok(repoFile('src/vs/workbench/contrib/knox/browser/gui/controller/inbound.ts').includes('autonomous:'));
		assert.ok(coreSources().includes('resolveAutonomousToolApproval'));
	});
});
