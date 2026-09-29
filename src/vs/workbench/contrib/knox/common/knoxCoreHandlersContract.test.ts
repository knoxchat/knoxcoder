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

suite('Knox Core/host handler contract (KN-232–240)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const core = repoFile('extensions/knox/src/core/core.ts');
	const messenger = repoFile('extensions/knox/src/host/extension/VsCodeMessenger.ts');
	const paths = repoFile('extensions/knox/src/core/util/paths.ts');
	const history = repoFile('extensions/knox/src/core/util/history.ts');
	const service = repoFile('src/vs/workbench/contrib/knox/common/knoxService.ts');

	test('KN-232: history list/load/save/delete persist under ~/.knox/sessions', () => {
		for (const name of ['history/list', 'history/load', 'history/save', 'history/delete']) {
			assert.ok(core.includes(`on("${name}"`), name);
		}
		assert.ok(history.includes('getSessionFilePath'));
		assert.ok(history.includes('getSessionsListPath'));
		assert.ok(paths.includes('path.join(getKnoxGlobalPath(), "sessions")'));
		assert.ok(paths.includes('path.join(os.homedir(), ".knox")'));
	});

	test('KN-233: config handlers write config.yaml / sharedConfig.json', () => {
		for (const name of [
			'config/getSerializedProfileInfo',
			'config/updateSharedConfig',
			'config/updateSelectedModel',
			'config/addModel',
			'config/deleteModel',
			'config/addPrompt',
			'config/listProfiles',
			'config/refreshProfiles',
			'config/reload',
		]) {
			assert.ok(core.includes(`on("${name}"`), name);
		}
		assert.ok(paths.includes('sharedConfig.json'));
		assert.ok(paths.includes('config.yaml'));
	});

	test('KN-234: context handlers resolve @ mentions', () => {
		for (const name of [
			'context/getContextItems',
			'context/loadSubmenuItems',
			'context/searchFiles',
			'context/getSymbolsForFiles',
			'context/getAutoContext',
		]) {
			assert.ok(core.includes(`on("${name}"`), name);
		}
	});

	test('KN-235: LLM handlers stream chat, complete, list models, and diffs', () => {
		for (const name of ['llm/streamChat', 'llm/complete', 'llm/listModels', 'streamDiffLines', 'chatDescriber/describe']) {
			assert.ok(core.includes(`on("${name}"`) || core.includes(`on("${name}",`), name);
		}
		assert.ok(core.includes('llmStreamChat'));
		assert.ok(core.includes('streamDiffLines'));
	});

	test('KN-236: tools/call, cancel, and partial output stay on Core', () => {
		assert.ok(core.includes('on(\n      "tools/call"') || core.includes('on("tools/call"'));
		assert.ok(core.includes('on("tools/cancel"'));
		assert.ok(repoFile('extensions/knox/src/core/protocol/passThrough.ts').includes('"tools/partialOutput"'));
		assert.ok(core.includes('callTool'));
	});

	test('KN-237: agent worktree and jobs are Core handlers', () => {
		assert.ok(core.includes('on("agent/worktree"'));
		assert.ok(core.includes('on("agent/jobs"'));
		assert.ok(repoFile('extensions/knox/src/core/protocol/passThrough.ts').includes('"agent/jobUpdate"'));
	});

	test('KN-238: stats, terminal suggestions, clipboard cache, file-change notes', () => {
		assert.ok(core.includes('on("stats/getTokensPerDay"'));
		assert.ok(core.includes('on("stats/getTokensPerModel"'));
		assert.ok(core.includes('on("terminal/getSuggestions"'));
		assert.ok(core.includes('on("terminal/applySuggestion"'));
		assert.ok(core.includes('on("clipboardCache/add"'));
		assert.ok(core.includes('on("didChangeActiveTextEditor"'));
	});

	test('KN-239: IDE-only GUI messages have host functions', () => {
		for (const name of [
			'applyToFile',
			'overwriteFile',
			'acceptDiff',
			'rejectDiff',
			'edit/sendPrompt',
			'edit/exit',
			'setGuiLanguage',
			'setActiveChatSession',
			'setAgentMode',
			'showFile',
			'insertAtCursor',
			'knoxchat/oauth/status',
			'knoxchat/oauth/start',
			'knoxchat/oauth/cancel',
			'knoxchat/oauth/signOut',
		]) {
			assert.ok(messenger.includes(`"${name}"`), name);
		}
		assert.ok(messenger.includes('openUrl'));
		assert.ok(repoFile('extensions/knox/src/host/checkpoints/graphMessages.ts').includes("protocol.on('copyText'"));
	});

	test('KN-240: IKnoxService stays a thin GUI pipe', () => {
		assert.ok(service.includes('guiPost(message: IKnoxGuiMessage)'));
		assert.ok(!service.includes('executeToolCall'));
		assert.ok(service.includes('Memory sqlite, tools, and LLM streaming stay in the extension host'));
	});
});
