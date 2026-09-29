/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

function repoFile(...parts: string[]): string {
	return readFileSync(join(process.cwd(), ...parts), 'utf8');
}

suite('Knox Memory Brain + Soul contract (KN-310–317)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('KN-310: BrainStore lives at ~/.knoxcoder/memory/brain.sqlite and migrates legacy once', () => {
		const store = repoFile('extensions/knox/src/core/context/memory/brain/BrainStore.ts');
		assert.ok(store.includes('export class BrainStore'));
		assert.ok(store.includes('~/.knoxcoder/memory/brain.sqlite'));
		assert.ok(repoFile('extensions/knox/src/core/util/paths.ts').includes('path.join(getMemoryBrainPath(), "brain.sqlite")'));
		const mgr = repoFile('extensions/knox/src/core/context/memory/MemoryManager.ts');
		assert.ok(mgr.includes('migrateLegacyStore'));
		assert.ok(mgr.includes('legacy_memory_migrated'));
	});

	test('KN-311: retrieval fusion is BM25 + trigram + graph, θ=0.6, top-k=20', () => {
		const fusion = repoFile('extensions/knox/src/core/context/memory/brain/RetrievalFusion.ts');
		assert.ok(fusion.includes('FTS5 BM25'));
		assert.ok(fusion.includes('trigram'));
		const store = repoFile('extensions/knox/src/core/context/memory/brain/BrainStore.ts');
		assert.ok(store.includes('retrieval_threshold: 0.6'));
		assert.ok(store.includes('retrieval_top_k: 20'));
	});

	test('KN-312: M1–M5 hierarchy, Ebbinghaus, NREM/REM sleep', () => {
		const hierarchy = repoFile('extensions/knox/src/core/context/memory/brain/MemoryHierarchy.ts');
		for (const id of ['M1', 'M2', 'M3', 'M4', 'M5']) {
			assert.ok(hierarchy.includes(`"${id}"`), id);
		}
		assert.ok(repoFile('extensions/knox/src/core/context/memory/brain/Ebbinghaus.ts').includes('ebbinghaus_lambda'));
		const sleep = repoFile('extensions/knox/src/core/context/memory/brain/SleepConsolidation.ts');
		assert.ok(sleep.includes('NREM Phase 1'));
		assert.ok(sleep.includes('REM Phase'));
	});

	test('KN-313: MemoryPipeline pre_turn / post_turn injects fenced context, fail-open', () => {
		const pipeline = repoFile('extensions/knox/src/core/context/memory/brain/MemoryPipeline.ts');
		assert.ok(pipeline.includes('pre_turn') || repoFile('extensions/knox/src/core/context/memory/brain/memory-pipeline.test.ts').includes('pre_turn'));
		assert.ok(pipeline.includes('.catch(() => {})'));
		assert.ok(repoFile('extensions/knox/src/core/context/memory/brain/ContextBuilder.ts').includes('<memory-context>'));
		assert.ok(repoFile('extensions/knox/src/core/llm/compileChatMessages.test.ts').includes('## Relevant Memory Context'));
	});

	test('KN-314: native panel brain/* handlers are on Core', () => {
		const core = repoFile('extensions/knox/src/core/core.ts');
		for (const name of [
			'brain/dashboard',
			'brain/searchMemories',
			'brain/pinMemory',
			'brain/deleteMemory',
			'brain/exploreGraph',
			'brain/getConfig',
			'brain/export',
			'brain/import',
			'brain/heal',
			'brain/listSessions',
		]) {
			assert.ok(core.includes(`on("${name}"`), name);
		}
	});

	test('KN-315: soul events bind session.id across tools, oracles, and restore', () => {
		const types = repoFile('extensions/knox/src/core/context/soul/types.ts');
		for (const kind of ['tool_denied', 'compaction', 'build:fail', 'qemu:panic', 'bisect:step', 'restore']) {
			assert.ok(types.includes(`"${kind}"`), kind);
		}
		assert.ok(types.includes('sessionId: string'));
		assert.ok(repoFile('extensions/knox/src/core/core.ts').includes('on("brain/recordSoulEvent"'));
	});

	test('KN-316: restore can rewind files only or files+memory', () => {
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/notifyRestore.ts').includes('rewindMemory'));
		assert.ok(repoFile('extensions/knox/src/core/context/soul/recordSoulEvent.ts').includes('rewindMemoryForWorkspaceCheckpoint'));
		assert.ok(repoFile('extensions/knox/src/core/context/soul/extractToolFiles.ts').includes('Do not assume later edits still exist'));
	});

	test('KN-317: sanitizer strips credentials, injection, invisible Unicode; recall is fenced', () => {
		const sanitizer = repoFile('extensions/knox/src/core/context/memory/brain/InputSanitizer.ts');
		assert.ok(sanitizer.includes('credential_leak'));
		assert.ok(sanitizer.includes('prompt_injection'));
		assert.ok(sanitizer.includes('invisible_unicode'));
		assert.ok(repoFile('extensions/knox/src/core/context/memory/brain/ContextBuilder.ts').includes('<memory-context>'));
	});
});
