/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, DisposableMap, DisposableStore, IDisposable } from '../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { ExtHostContext, ExtHostLanguageModelToolsShape, ITextModelApiToolDto, ITextModelApiToolResultDto, MainContext, MainThreadLanguageModelToolsShape } from '../common/extHost.protocol.js';
import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';

export const ILanguageModelToolsService = createDecorator<ILanguageModelToolsService>('languageModelToolsService');

export interface ILanguageModelToolsService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	registerTool(name: string, invoke: (input: unknown, token: CancellationToken) => Promise<ITextModelApiToolResultDto>, dto?: ITextModelApiToolDto): IDisposable;
	getTools(): ITextModelApiToolDto[];
	invokeTool(name: string, input: unknown, token: CancellationToken): Promise<ITextModelApiToolResultDto>;
}

export class LanguageModelToolsService extends Disposable implements ILanguageModelToolsService {
	declare readonly _serviceBrand: undefined;

	private readonly _tools = new Map<string, { dto: ITextModelApiToolDto; invoke: (input: unknown, token: CancellationToken) => Promise<ITextModelApiToolResultDto> }>();
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	registerTool(name: string, invoke: (input: unknown, token: CancellationToken) => Promise<ITextModelApiToolResultDto>, dto?: ITextModelApiToolDto): IDisposable {
		this._tools.set(name, {
			dto: dto ?? { name, modelDescription: name },
			invoke,
		});
		this._onDidChange.fire();
		return {
			dispose: () => {
				this._tools.delete(name);
				this._onDidChange.fire();
			}
		};
	}

	getTools(): ITextModelApiToolDto[] {
		return Array.from(this._tools.values(), entry => entry.dto);
	}

	invokeTool(name: string, input: unknown, token: CancellationToken): Promise<ITextModelApiToolResultDto> {
		const entry = this._tools.get(name);
		if (!entry) {
			return Promise.reject(new Error(`No language model tool registered with name: ${name}`));
		}
		return entry.invoke(input, token);
	}
}

registerSingleton(ILanguageModelToolsService, LanguageModelToolsService, InstantiationType.Delayed);

@extHostNamedCustomer(MainContext.MainThreadLanguageModelTools)
export class MainThreadLanguageModelTools implements MainThreadLanguageModelToolsShape {

	private readonly _store = new DisposableStore();
	private readonly _registrations = this._store.add(new DisposableMap<number, IDisposable>());
	private readonly _proxy: ExtHostLanguageModelToolsShape;

	constructor(
		context: IExtHostContext,
		@ILanguageModelToolsService private readonly toolsService: ILanguageModelToolsService,
	) {
		this._proxy = context.getProxy(ExtHostContext.ExtHostLanguageModelTools);
		this._store.add(toolsService.onDidChange(() => {
			this._proxy.$acceptToolList(this.toolsService.getTools());
		}));
	}

	dispose(): void {
		this._store.dispose();
	}

	$registerTool(handle: number, tool: ITextModelApiToolDto): void {
		const registration = this.toolsService.registerTool(tool.name, (input, token) => {
			return this._proxy.$invokeTool(handle, input, token);
		}, tool);
		this._registrations.set(handle, registration);
	}

	$unregisterTool(handle: number): void {
		this._registrations.deleteAndDispose(handle);
	}

	$getTools(): Promise<ITextModelApiToolDto[]> {
		return Promise.resolve(this.toolsService.getTools());
	}

	$invokeTool(name: string, input: unknown, token: CancellationToken): Promise<ITextModelApiToolResultDto> {
		return this.toolsService.invokeTool(name, input, token);
	}
}
