/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { IExtensionDescription } from '../../../platform/extensions/common/extensions.js';
import { ExtHostLanguageModelToolsShape, IMainContext, ITextModelApiToolDto, ITextModelApiToolResultDto, MainContext, MainThreadLanguageModelToolsShape } from './extHost.protocol.js';
import { TextModelApiTextPart, TextModelApiToolResult } from './extHostTypes.js';
import type * as vscode from 'vscode';

export class ExtHostLanguageModelTools extends Disposable implements ExtHostLanguageModelToolsShape {

	private readonly _proxy: MainThreadLanguageModelToolsShape;
	private readonly _tools = new Map<number, { dto: ITextModelApiToolDto; tool: vscode.TextModelApiTool<object> }>();
	private _allTools: ITextModelApiToolDto[] = [];
	private _handlePool = 0;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(mainContext: IMainContext) {
		super();
		this._proxy = mainContext.getProxy(MainContext.MainThreadLanguageModelTools);
	}

	registerTool<T>(_extension: IExtensionDescription, name: string, tool: vscode.TextModelApiTool<T>, metadata?: Partial<ITextModelApiToolDto>): IDisposable {
		const handle = this._handlePool++;
		const dto: ITextModelApiToolDto = {
			name,
			displayName: metadata?.displayName ?? name,
			modelDescription: metadata?.modelDescription ?? name,
			userDescription: metadata?.userDescription,
			inputSchema: metadata?.inputSchema,
			tags: metadata?.tags,
		};
		this._tools.set(handle, { dto, tool: tool as vscode.TextModelApiTool<object> });
		this._proxy.$registerTool(handle, dto);

		return toDisposable(() => {
			this._tools.delete(handle);
			this._proxy.$unregisterTool(handle);
		});
	}

	get tools(): readonly vscode.TextModelApiToolInformation[] {
		return this._allTools.map(tool => ({
			name: tool.name,
			description: tool.modelDescription,
			inputSchema: tool.inputSchema,
			tags: tool.tags ?? [],
		}));
	}

	async invokeTool(name: string, options: vscode.TextModelApiToolInvocationOptions<object>, token?: CancellationToken): Promise<vscode.TextModelApiToolResult> {
		const result = await this._proxy.$invokeTool(name, options.input, token ?? CancellationToken.None);
		return new TextModelApiToolResult(
			result.content.map(part => new TextModelApiTextPart(part.value)),
		);
	}

	async $invokeTool(handle: number, input: unknown, token: CancellationToken): Promise<ITextModelApiToolResultDto> {
		const entry = this._tools.get(handle);
		if (!entry) {
			throw new Error(`Unknown language model tool handle ${handle}`);
		}

		const result = await Promise.resolve(entry.tool.invoke({
			input: (input ?? {}) as object,
			toolInvocationToken: undefined,
		}, token));

		if (!result) {
			return { content: [] };
		}

		const content: Array<{ kind: 'text'; value: string }> = [];
		for (const part of result.content) {
			if (part instanceof TextModelApiTextPart) {
				content.push({ kind: 'text', value: part.value });
			} else if (part && typeof part === 'object' && 'value' in part && typeof (part as { value: unknown }).value === 'string') {
				content.push({ kind: 'text', value: (part as { value: string }).value });
			} else if (typeof part === 'string') {
				content.push({ kind: 'text', value: part });
			}
		}
		return { content };
	}

	$acceptToolList(tools: ITextModelApiToolDto[]): void {
		this._allTools = tools;
		this._onDidChange.fire();
	}
}
