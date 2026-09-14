/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { IKnoxContextItem } from '../../common/knoxChatTypes.js';
import type { IKnoxMentionChip } from '../../common/knoxMentions.js';
import {
	IKnoxGetContextItemsRequest,
	knoxFullInputForContext,
	knoxHasSlashCommandOrContextProvider,
	knoxParseDefaultContextProviders,
	knoxPrefixSlashCommand,
	knoxResolveInput,
	knoxUserMessageWithContext,
	mentionContextProviderName,
} from '../../common/knoxResolveInput.js';

function mention(partial: Partial<IKnoxMentionChip> & Pick<IKnoxMentionChip, 'id' | 'label' | 'itemType'>): IKnoxMentionChip {
	return {
		query: partial.query ?? partial.id,
		...partial,
	};
}

function mockRequest(content: IKnoxContextItem[] = []) {
	const calls: IKnoxGetContextItemsRequest[] = [];
	const requestContextItems = async (data: IKnoxGetContextItemsRequest) => {
		calls.push(data);
		return content;
	};
	return { calls, requestContextItems };
}

suite('knox resolveInput (T4.6)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('mentionContextProviderName maps file/folder to file and providers by id', () => {
		assert.strictEqual(mentionContextProviderName({ id: 'file:///ws/a.ts', itemType: 'file' }), 'file');
		assert.strictEqual(mentionContextProviderName({ id: 'file:///ws/gui', itemType: 'folder' }), 'file');
		assert.strictEqual(mentionContextProviderName({ id: 'diff', itemType: 'contextProvider' }), 'diff');
		assert.strictEqual(mentionContextProviderName({ id: 'problems' }), 'problems');
		assert.strictEqual(mentionContextProviderName({ id: 'x', itemType: 'query' }), 'query');
	});

	test('knoxParseDefaultContextProviders skips activeFile strings', () => {
		assert.deepStrictEqual(knoxParseDefaultContextProviders(undefined), []);
		assert.deepStrictEqual(
			knoxParseDefaultContextProviders(['activeFile', { name: 'diff' }, { provider: 'terminal', query: '' }]),
			[{ name: 'diff', query: '' }, { name: 'terminal', query: '' }],
		);
	});

	test('requests the file provider with the URI for a file mention', async () => {
		const { calls, requestContextItems } = mockRequest();
		await knoxResolveInput({
			content: '@package.json',
			editorState: {
				mentions: [mention({
					id: 'file:///ws/package.json',
					label: 'package.json',
					query: 'file:///ws/package.json',
					itemType: 'file',
				})],
			},
			defaultContextProviders: [],
			selectedModelTitle: 'gpt',
			requestContextItems,
		});

		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].name, 'file');
		assert.strictEqual(calls[0].query, 'file:///ws/package.json');
	});

	test('attaches two mentions as two context requests', async () => {
		const { calls, requestContextItems } = mockRequest();
		await knoxResolveInput({
			content: '@package.json @gui',
			editorState: {
				mentions: [
					mention({
						id: 'file:///ws/package.json',
						label: 'package.json',
						query: 'file:///ws/package.json',
						itemType: 'file',
					}),
					mention({
						id: 'file:///ws/gui',
						label: 'gui',
						query: 'file:///ws/gui',
						itemType: 'file',
					}),
				],
			},
			defaultContextProviders: [],
			selectedModelTitle: 'gpt',
			requestContextItems,
		});

		assert.strictEqual(calls.length, 2);
		assert.strictEqual(calls[0].query, 'file:///ws/package.json');
		assert.strictEqual(calls[1].query, 'file:///ws/gui');
		assert.strictEqual(calls[0].name, 'file');
		assert.strictEqual(calls[1].name, 'file');
	});

	test('resolves a folder mention through the file provider', async () => {
		const { calls, requestContextItems } = mockRequest();
		await knoxResolveInput({
			content: '@gui',
			editorState: {
				mentions: [mention({
					id: 'file:///ws/gui',
					label: 'gui',
					query: 'file:///ws/gui',
					itemType: 'folder',
				})],
			},
			defaultContextProviders: [],
			selectedModelTitle: 'gpt',
			requestContextItems,
		});

		assert.strictEqual(calls[0].name, 'file');
		assert.strictEqual(calls[0].query, 'file:///ws/gui');
	});

	test('resolves provider mentions by id (diff / problems)', async () => {
		const { calls, requestContextItems } = mockRequest();
		await knoxResolveInput({
			content: '@Git Diff',
			editorState: {
				mentions: [mention({
					id: 'diff',
					label: 'Git Diff',
					query: '',
					itemType: 'contextProvider',
				})],
			},
			defaultContextProviders: [],
			selectedModelTitle: 'gpt',
			requestContextItems,
		});

		assert.strictEqual(calls[0].name, 'diff');
		assert.strictEqual(calls[0].query, '');
	});

	test('prefixes the message with /name from the chip id so send can dispatch it', async () => {
		const { requestContextItems } = mockRequest();
		const result = await knoxResolveInput({
			content: 'conventional',
			editorState: {
				slashCommands: [{ id: '/commit', label: '/commit' }],
			},
			defaultContextProviders: [],
			selectedModelTitle: 'gpt',
			requestContextItems,
		});

		assert.deepStrictEqual(result.contextItems, []);
		assert.deepStrictEqual(result.selectedCode, []);
		assert.strictEqual(result.content, '/commit conventional');
		assert.strictEqual(result.slashCommandId, '/commit');
	});

	test('does not double-prefix slash already present in native input text', async () => {
		const { calls, requestContextItems } = mockRequest();
		const result = await knoxResolveInput({
			content: '/commit conventional',
			editorState: {
				slashCommands: [{ id: '/commit', label: '/commit' }],
			},
			defaultContextProviders: [],
			selectedModelTitle: 'gpt',
			requestContextItems,
		});

		assert.strictEqual(result.content, '/commit conventional');
		assert.strictEqual(knoxFullInputForContext('/commit conventional', '/commit'), 'conventional');
		assert.strictEqual(calls.length, 0);
	});

	test('fetches default context providers in parallel after mentions', async () => {
		const { calls, requestContextItems } = mockRequest();
		await knoxResolveInput({
			content: 'hello',
			editorState: {
				mentions: [mention({
					id: 'file:///ws/a.ts',
					label: 'a.ts',
					query: 'file:///ws/a.ts',
					itemType: 'file',
				})],
			},
			defaultContextProviders: [{ name: 'diff' }, { name: 'problems', query: '' }],
			selectedModelTitle: 'gpt',
			requestContextItems,
		});

		assert.strictEqual(calls.length, 3);
		assert.strictEqual(calls[0].name, 'file');
		assert.deepStrictEqual(calls.slice(1).map(call => call.name).sort(), ['diff', 'problems']);
	});

	test('knoxPrefixSlashCommand leaves image parts and appends slash text', () => {
		const prefixed = knoxPrefixSlashCommand(
			[{ type: 'imageUrl', imageUrl: { url: 'data:image/png;base64,aa' } }],
			'/commit',
		);
		assert.deepStrictEqual(prefixed, [
			{ type: 'imageUrl', imageUrl: { url: 'data:image/png;base64,aa' } },
			{ type: 'text', text: '/commit ' },
		]);
	});

	test('knoxUserMessageWithContext prepends context item text parts', () => {
		assert.deepStrictEqual(
			knoxUserMessageWithContext('what is this', [{ name: 'a.ts', description: 'a.ts', content: 'export const x = 1;' }]),
			[
				{ type: 'text', text: 'export const x = 1;\n' },
				{ type: 'text', text: 'what is this' },
			],
		);
		assert.strictEqual(knoxUserMessageWithContext('hi', []), 'hi');
	});

	test('knoxHasSlashCommandOrContextProvider matches GUI helper', () => {
		assert.strictEqual(knoxHasSlashCommandOrContextProvider({ slashCommands: [{ id: '/commit', label: '/commit' }] }), true);
		assert.strictEqual(knoxHasSlashCommandOrContextProvider({
			mentions: [mention({ id: 'diff', label: 'Git Diff', itemType: 'contextProvider' })],
		}), true);
		assert.strictEqual(knoxHasSlashCommandOrContextProvider({
			mentions: [mention({ id: 'file:///ws/a.ts', label: 'a.ts', itemType: 'file' })],
		}), false);
	});
});
