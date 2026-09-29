/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { KNOX_GUI_HOST_INBOUND, KNOX_GUI_HOST_OUTBOUND } from './knoxGuiProtocol.js';

function repoFile(...parts: string[]): string {
	return readFileSync(join(process.cwd(), ...parts), 'utf8');
}

function parseQuotedArray(src: string, constName: string): string[] {
	const start = src.indexOf(`export const ${constName}`);
	assert.ok(start >= 0, `${constName} missing`);
	const slice = src.slice(start);
	const end = slice.indexOf('];');
	assert.ok(end > 0, `${constName} terminator missing`);
	return [...slice.slice(0, end).matchAll(/"([^"]+)"/g)].map(m => m[1]);
}

/** Native chrome + Core both speak these. Adding one requires both catalogs. */
const SHARED_CORE_OUTBOUND = [
	'history/list',
	'history/load',
	'history/save',
	'history/delete',
	'config/getSerializedProfileInfo',
	'config/updateSharedConfig',
	'config/listProfiles',
	'config/addModel',
	'config/deleteModel',
	'config/updateSelectedModel',
	'config/newPromptFile',
	'config/addPrompt',
	'config/openProfile',
	'config/refreshProfiles',
	'context/getContextItems',
	'context/loadSubmenuItems',
	'context/searchFiles',
	'llm/streamChat',
	'abort',
	'tools/call',
	'tools/cancel',
	'chatDescriber/describe',
	'agent/worktree',
	'agent/jobs',
	'ui/getReasoningEffortPrefs',
	'ui/updateReasoningEffortPrefs',
	'brain/dashboard',
	'brain/dispatch',
] as const;

suite('Knox messenger contract (KN-230–231)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('KN-230: IMessenger + InProcessMessenger keep the webview envelope', () => {
		const messenger = repoFile('extensions/knox/src/core/protocol/messenger/index.ts');
		assert.ok(messenger.includes('export interface IMessenger'));
		assert.ok(messenger.includes('export class InProcessMessenger'));
		assert.ok(messenger.includes('messageType: string;'));
		assert.ok(messenger.includes('messageId: string;'));
		assert.ok(messenger.includes('data: T;'));
		const stream = repoFile('extensions/knox/src/core/protocol/util.ts');
		assert.ok(stream.includes('done: true'));
		assert.ok(stream.includes('status: "success"'));
		assert.ok(stream.includes('content: T'));
		assert.ok(stream.includes('done: false'));
	});

	test('KN-231: Core pass-through tables stay inside native GUI catalogs', () => {
		const pass = repoFile('extensions/knox/src/core/protocol/passThrough.ts');
		const toCore = parseQuotedArray(pass, 'WEBVIEW_TO_CORE_PASS_THROUGH');
		const toGui = parseQuotedArray(pass, 'CORE_TO_WEBVIEW_PASS_THROUGH');
		const outbound = new Set<string>(KNOX_GUI_HOST_OUTBOUND);
		const inbound = new Set<string>(KNOX_GUI_HOST_INBOUND);

		const missingInbound = toGui.filter(name => !inbound.has(name));
		assert.deepStrictEqual(missingInbound, [], `Core→GUI pass-through missing from KNOX_GUI_HOST_INBOUND: ${missingInbound.join(', ')}`);

		const missingShared = SHARED_CORE_OUTBOUND.filter(name => !toCore.includes(name) || !outbound.has(name));
		assert.deepStrictEqual(missingShared, [], `shared Core message missing from pass-through or GUI outbound: ${missingShared.join(', ')}`);
	});
});
