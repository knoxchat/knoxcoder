/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { DisposableMap, DisposableStore, IDisposable } from '../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { ExtHostContext, ExtHostLanguageModelsShape, ITextModelApiAssistMessageDto, ITextModelApiAssistRequestOptionsDto, ITextModelApiChatInformationDto, ITextModelApiChatSelectorDto, ITextModelApiResponsePartDto, MainContext, MainThreadLanguageModelsShape } from '../common/extHost.protocol.js';
import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';

export const ILanguageModelsService = createDecorator<ILanguageModelsService>('languageModelsService');

export interface ILanguageModelsService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	registerProvider(vendor: string, provider: {
		provideChatInformation(silent: boolean, token: CancellationToken): Promise<ITextModelApiChatInformationDto[]>;
		provideChatResponse(modelId: string, messages: ITextModelApiAssistMessageDto[], requestId: number, token: CancellationToken, options?: ITextModelApiAssistRequestOptionsDto): Promise<void>;
		provideTokenCount(modelId: string, text: string, token: CancellationToken): Promise<number>;
	}): IDisposable;
	selectChatModels(selector: ITextModelApiChatSelectorDto | undefined): Promise<ITextModelApiChatInformationDto[]>;
	sendChatRequest(vendor: string, modelId: string, messages: ITextModelApiAssistMessageDto[], requestId: number, token: CancellationToken, owner: ExtHostLanguageModelsShape, options?: ITextModelApiAssistRequestOptionsDto): Promise<void>;
	countTokens(vendor: string, modelId: string, text: string, token: CancellationToken): Promise<number>;
	reportResponsePart(requestId: number, part: ITextModelApiResponsePartDto): void;
	reportResponseDone(requestId: number, errorMessage?: string): void;
}

interface IRegisteredProvider {
	vendor: string;
	provideChatInformation(silent: boolean, token: CancellationToken): Promise<ITextModelApiChatInformationDto[]>;
	provideChatResponse(modelId: string, messages: ITextModelApiAssistMessageDto[], requestId: number, token: CancellationToken, options?: ITextModelApiAssistRequestOptionsDto): Promise<void>;
	provideTokenCount(modelId: string, text: string, token: CancellationToken): Promise<number>;
}

class LanguageModelsService implements ILanguageModelsService {
	declare readonly _serviceBrand: undefined;

	private readonly _providers = new Map<string, IRegisteredProvider>();
	private readonly _requestOwners = new Map<number, ExtHostLanguageModelsShape>();
	private readonly _onDidChange = new Emitter<void>();
	readonly onDidChange: Event<void> = this._onDidChange.event;

	registerProvider(vendor: string, provider: IRegisteredProvider): IDisposable {
		this._providers.set(vendor, { ...provider, vendor });
		this._onDidChange.fire();
		return {
			dispose: () => {
				this._providers.delete(vendor);
				this._onDidChange.fire();
			}
		};
	}

	async selectChatModels(selector: ITextModelApiChatSelectorDto | undefined): Promise<ITextModelApiChatInformationDto[]> {
		const vendors = selector?.vendor
			? [this._providers.get(selector.vendor)].filter((provider): provider is IRegisteredProvider => Boolean(provider))
			: Array.from(this._providers.values());
		const lists = await Promise.all(vendors.map(provider => provider.provideChatInformation(true, CancellationToken.None)));
		const models = lists.flat();
		return models.filter(model => {
			if (selector?.id && model.id !== selector.id) {
				return false;
			}
			if (selector?.family && model.family !== selector.family) {
				return false;
			}
			if (selector?.version && model.version !== selector.version) {
				return false;
			}
			return true;
		});
	}

	async sendChatRequest(vendor: string, modelId: string, messages: ITextModelApiAssistMessageDto[], requestId: number, token: CancellationToken, owner: ExtHostLanguageModelsShape, options?: ITextModelApiAssistRequestOptionsDto): Promise<void> {
		const provider = this._providers.get(vendor);
		if (!provider) {
			throw new Error(`No assist provider registered for vendor: ${vendor}`);
		}
		this._requestOwners.set(requestId, owner);
		try {
			await provider.provideChatResponse(modelId, messages, requestId, token, options);
			this.reportResponseDone(requestId);
		} catch (error) {
			this.reportResponseDone(requestId, error instanceof Error ? error.message : String(error));
		} finally {
			this._requestOwners.delete(requestId);
		}
	}

	countTokens(vendor: string, modelId: string, text: string, token: CancellationToken): Promise<number> {
		const provider = this._providers.get(vendor);
		if (!provider) {
			return Promise.resolve(Math.ceil(text.length / 4));
		}
		return provider.provideTokenCount(modelId, text, token);
	}

	reportResponsePart(requestId: number, part: ITextModelApiResponsePartDto): void {
		this._requestOwners.get(requestId)?.$acceptResponsePart(requestId, part);
	}

	reportResponseDone(requestId: number, errorMessage?: string): void {
		this._requestOwners.get(requestId)?.$acceptResponseDone(requestId, errorMessage);
	}
}

registerSingleton(ILanguageModelsService, LanguageModelsService, InstantiationType.Delayed);

@extHostNamedCustomer(MainContext.MainThreadLanguageModels)
export class MainThreadLanguageModels implements MainThreadLanguageModelsShape {

	private readonly _store = new DisposableStore();
	private readonly _registrations = this._store.add(new DisposableMap<number, IDisposable>());
	private readonly _proxy: ExtHostLanguageModelsShape;

	constructor(
		context: IExtHostContext,
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
	) {
		this._proxy = context.getProxy(ExtHostContext.ExtHostLanguageModels);
		this._store.add(languageModelsService.onDidChange(() => {
			this._proxy.$acceptChatModelsChanged();
		}));
	}

	dispose(): void {
		this._store.dispose();
	}

	$registerProvider(handle: number, vendor: string): void {
		const registration = this.languageModelsService.registerProvider(vendor, {
			provideChatInformation: (silent, token) => this._proxy.$provideChatInformation(handle, silent, token),
			provideChatResponse: (modelId, messages, requestId, token, options) => this._proxy.$provideChatResponse(handle, modelId, messages, requestId, token, options),
			provideTokenCount: (modelId, text, token) => this._proxy.$provideTokenCount(handle, modelId, text, token),
		});
		this._registrations.set(handle, registration);
	}

	$unregisterProvider(handle: number): void {
		this._registrations.deleteAndDispose(handle);
	}

	$selectChatModels(selector: ITextModelApiChatSelectorDto | undefined): Promise<ITextModelApiChatInformationDto[]> {
		return this.languageModelsService.selectChatModels(selector);
	}

	$sendChatRequest(vendor: string, modelId: string, messages: ITextModelApiAssistMessageDto[], requestId: number, token: CancellationToken, options?: ITextModelApiAssistRequestOptionsDto): Promise<void> {
		return this.languageModelsService.sendChatRequest(vendor, modelId, messages, requestId, token, this._proxy, options);
	}

	$countTokens(vendor: string, modelId: string, text: string, token: CancellationToken): Promise<number> {
		return this.languageModelsService.countTokens(vendor, modelId, text, token);
	}

	$reportResponsePart(requestId: number, part: ITextModelApiResponsePartDto): void {
		this.languageModelsService.reportResponsePart(requestId, part);
	}

	$reportResponseDone(requestId: number, errorMessage?: string): void {
		this.languageModelsService.reportResponseDone(requestId, errorMessage);
	}
}
