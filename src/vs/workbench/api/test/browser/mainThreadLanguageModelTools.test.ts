/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { LanguageModelToolsService, MainThreadLanguageModelTools } from '../../browser/mainThreadLanguageModelTools.js';
import { type ExtHostLanguageModelToolsShape, type ITextModelApiToolResultDto } from '../../common/extHost.protocol.js';
import { SingleProxyRPCProtocol } from '../common/testRPCProtocol.js';

suite('MainThreadLanguageModelTools (KN-170)', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('service invoke returns the registered result', async () => {
		const service = disposables.add(new LanguageModelToolsService());
		disposables.add(service.registerTool('builtin_read_file', async () => {
			return { content: [{ kind: 'text', value: 'hello' }] };
		}, { name: 'builtin_read_file', modelDescription: 'Read a file' }));

		const result = await service.invokeTool('builtin_read_file', { filepath: 'a.ts' }, CancellationToken.None);
		assert.strictEqual(result.content[0]?.value, 'hello');
		assert.strictEqual(service.getTools()[0]?.name, 'builtin_read_file');
	});

	test('register then invoke forwards to the extension host', async () => {
		let invokedHandle: number | undefined;
		let invokedInput: unknown;
		const proxy = new class extends mock<ExtHostLanguageModelToolsShape>() {
			override async $invokeTool(handle: number, input: unknown): Promise<ITextModelApiToolResultDto> {
				invokedHandle = handle;
				invokedInput = input;
				return { content: [{ kind: 'text', value: 'ok' }] };
			}
			override $acceptToolList(): void { }
		};

		const toolsService = disposables.add(new LanguageModelToolsService());
		const service = disposables.add(new MainThreadLanguageModelTools(
			SingleProxyRPCProtocol(proxy),
			toolsService,
		));

		service.$registerTool(3, {
			name: 'builtin_read_file',
			modelDescription: 'Read a file',
		});

		const result = await service.$invokeTool('builtin_read_file', { filepath: 'a.ts' }, CancellationToken.None);
		assert.strictEqual(invokedHandle, 3);
		assert.deepStrictEqual(invokedInput, { filepath: 'a.ts' });
		assert.strictEqual(result.content[0]?.value, 'ok');
	});
});
