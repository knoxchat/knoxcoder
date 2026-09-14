/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IKnoxGuiBridge, knoxUnwrapProtocol } from '../../common/knoxGuiProtocol.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { knoxNls } from '../../common/knoxI18n.js';
import {
	IKnoxModelPackage,
	IKnoxProviderInfo,
	KNOX_CHAT_FALLBACK_MODELS,
	KNOX_PROVIDERS,
	knoxBuildAddModelPayload,
	knoxGroupModelPackages,
	knoxListedModelToPackage,
	knoxParseListedChatModels,
	knoxProviderRequiredMissing,
} from '../../common/knoxAddModel.js';

/**
 * Configure provider form (T9.4): API key / params, then pick a model package.
 */
export class KnoxConfigureProviderPanel extends Disposable {

	readonly element: HTMLElement;
	private readonly _viewStore = this._register(new DisposableStore());
	private _providerId: string | undefined;
	private _form: Record<string, string> = {};
	private _packages: IKnoxModelPackage[] = [];
	private _loading = false;

	private readonly _onDidAddModel = this._register(new Emitter<void>());
	readonly onDidAddModel = this._onDidAddModel.event;

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
		@IOpenerService private readonly _opener: IOpenerService,
	) {
		super();
		this.element = append(parent, $('.knox-configure-provider'));
		this.element.setAttribute('role', 'region');
		this.element.setAttribute('aria-label', knoxNls('configureProvider'));
	}

	setProvider(providerId: string): void {
		if (this._providerId === providerId && this._packages.length) {
			this._render();
			return;
		}
		this._providerId = providerId;
		this._form = {};
		const provider = KNOX_PROVIDERS[providerId];
		for (const field of provider?.collectInputFor ?? []) {
			if (field.defaultValue !== undefined) {
				this._form[field.key] = String(field.defaultValue);
			}
		}
		this._packages = [...(provider?.packages ?? [])];
		if (providerId === 'knoxchat') {
			void this._loadKnoxChatModels();
		} else {
			this._render();
		}
	}

	refresh(): void {
		this._render();
	}

	private async _loadKnoxChatModels(): Promise<void> {
		this._loading = true;
		this._render();
		try {
			const result = knoxUnwrapProtocol(await this._bridge.request('knoxchat/listModels', undefined));
			const listed = knoxParseListedChatModels(result.content);
			this._packages = listed.length
				? listed.map(knoxListedModelToPackage)
				: [...KNOX_CHAT_FALLBACK_MODELS];
		} catch {
			this._packages = [...KNOX_CHAT_FALLBACK_MODELS];
		} finally {
			this._loading = false;
			this._render();
		}
	}

	private _render(): void {
		this._viewStore.clear();
		clearNode(this.element);
		const provider = this._providerId ? KNOX_PROVIDERS[this._providerId] : undefined;
		const t = (key: string) => knoxNls(key, undefined, undefined, this._chatService.language);
		if (!provider) {
			append(this.element, $('p.knox-muted')).textContent = t('selectProviderToConfigure');
			return;
		}
		append(this.element, $('h3')).textContent = provider.title;
		if (provider.longDescription || provider.description) {
			append(this.element, $('p.knox-muted')).textContent = provider.longDescription || provider.description;
		}
		if (provider.apiKeyUrl) {
			const link = append(this.element, $<HTMLButtonElement>('button.knox-link'));
			link.type = 'button';
			link.textContent = t('clickHereToCreateApiKey');
			this._viewStore.add(addDisposableListener(link, 'click', () => {
				void this._opener.open(URI.parse(provider.apiKeyUrl!));
			}));
		}

		const required = provider.collectInputFor.filter(field => field.required);
		const optional = provider.collectInputFor.filter(field => !field.required);
		if (required.length) {
			append(this.element, $('h4')).textContent = t('enterRequiredParams');
			for (const field of required) {
				this._field(field.label, field.key, field.inputType, field.placeholder);
			}
		}
		if (optional.length) {
			append(this.element, $('h4')).textContent = t('advancedOptional');
			for (const field of optional) {
				this._field(field.label, field.key, field.inputType, field.placeholder);
			}
		}

		append(this.element, $('h4')).textContent = t('selectModelPreset');
		if (this._loading) {
			append(this.element, $('p.knox-muted')).textContent = t('loadingModels');
			return;
		}
		const disabled = knoxProviderRequiredMissing(provider, this._form);
		if (this._providerId === 'knoxchat') {
			for (const group of knoxGroupModelPackages(this._packages)) {
				append(this.element, $('h4')).textContent = group.title;
				this._packageGrid(group.packages, provider, disabled);
			}
			return;
		}
		this._packageGrid(this._packages, provider, disabled);
	}

	private _packageGrid(packages: readonly IKnoxModelPackage[], provider: IKnoxProviderInfo, disabled: boolean): void {
		const grid = append(this.element, $('.knox-model-grid'));
		for (const pkg of packages) {
			const card = append(grid, $<HTMLButtonElement>('button.knox-model-card'));
			card.type = 'button';
			card.disabled = disabled;
			append(card, $('strong')).textContent = pkg.title;
			append(card, $('span.knox-muted')).textContent = pkg.description;
			this._viewStore.add(addDisposableListener(card, 'click', () => {
				if (disabled) {
					return;
				}
				this._chatService.addModel(knoxBuildAddModelPayload(pkg, provider, this._form));
				this._onDidAddModel.fire();
			}));
		}
	}

	private _field(label: string, key: string, type: string, placeholder?: string): void {
		const wrap = append(this.element, $('label.knox-checkpoint-field'));
		append(wrap, $('span')).textContent = label;
		const input = append(wrap, $<HTMLInputElement>('input'));
		input.type = type === 'password' ? 'password' : type;
		input.placeholder = placeholder ?? label;
		input.value = this._form[key] ?? '';
		this._viewStore.add(addDisposableListener(input, 'input', () => {
			this._form[key] = input.value;
		}));
	}
}
