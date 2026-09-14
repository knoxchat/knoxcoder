/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, getActiveWindow } from '../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IKnoxGuiBridge, knoxUnwrapProtocol } from '../../common/knoxGuiProtocol.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { KnoxModelRole } from '../../common/knoxChatTypes.js';
import { knoxNls } from '../../common/knoxI18n.js';
import {
	IKnoxAddModelDialogOptions,
	IKnoxCatalogModel,
	KNOX_CHAT_API_KEY_URL,
	KNOX_CHAT_FALLBACK_MODELS,
	KNOX_CHAT_PROVIDER_TITLE,
	knoxBuildKnoxChatAddModelPayload,
	knoxCatalogModelId,
	knoxConnectDisabled,
	knoxDisplayModalities,
	knoxFilterCatalogBySearch,
	knoxFormatContextBadge,
	knoxFormatModelPricingPerMillion,
	knoxFormatTokenCount,
	knoxGroupModelPackages,
	knoxMergeKnoxChatCatalog,
	knoxModelRoleToExperimentalRole,
	knoxParseListedChatModels,
} from '../../common/knoxAddModel.js';
import { appendKnoxGuiIcon } from '../knoxGuiIcons.js';

/**
 * KnoxChat-only Add Model modal. Matches `knox/gui` AddModelForm + KnoxChatModelList:
 * popup over chat, fetch `knoxchat/listModels`, Connect writes `config/addModel`.
 */
export class KnoxAddModelDialog extends Disposable {

	readonly element: HTMLElement;

	private readonly _card: HTMLElement;
	private readonly _close: HTMLButtonElement;
	private readonly _title: HTMLElement;
	private readonly _keyLabel: HTMLElement;
	private readonly _apiKey: HTMLInputElement;
	private readonly _keyHelp: HTMLElement;
	private readonly _status: HTMLElement;
	private readonly _modelLabel: HTMLElement;
	private readonly _searchInput: HTMLInputElement;
	private readonly _list: HTMLElement;
	private readonly _connect: HTMLButtonElement;
	private readonly _subtext: HTMLElement;
	private readonly _chromeStore = this._register(new DisposableStore());
	private readonly _listStore = this._register(new DisposableStore());
	private readonly _escapeStore = this._register(new DisposableStore());

	private _options: IKnoxAddModelDialogOptions = {};
	private _models: IKnoxCatalogModel[] = [];
	private _selected: IKnoxCatalogModel | undefined;
	private _search = '';
	private _loading = false;
	private _loadToken = 0;
	private _language: 'en' | 'zh' = 'en';

	private readonly _onDidAddModel = this._register(new Emitter<void>());
	readonly onDidAddModel = this._onDidAddModel.event;

	private readonly _onDidClose = this._register(new Emitter<void>());
	readonly onDidClose = this._onDidClose.event;

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
		@IOpenerService private readonly _opener: IOpenerService,
	) {
		super();
		this.element = append(parent, $('.knox-add-model-dialog.hidden'));
		this.element.setAttribute('role', 'dialog');
		this.element.setAttribute('aria-modal', 'true');

		this._card = append(this.element, $('.knox-add-model-card'));
		this._close = append(this._card, $<HTMLButtonElement>('button.knox-add-model-close'));
		this._close.type = 'button';
		appendKnoxGuiIcon(this._close, 'x-mark');

		this._title = append(this._card, $('h4.knox-add-model-title'));
		this._title.id = 'knox-add-model-title';
		this.element.setAttribute('aria-labelledby', this._title.id);

		const keyField = append(this._card, $('label.knox-add-model-field'));
		this._keyLabel = append(keyField, $('span.knox-add-model-label'));
		this._apiKey = append(keyField, $<HTMLInputElement>('input.knox-add-model-input'));
		this._apiKey.type = 'text';
		this._apiKey.autocomplete = 'off';
		this._apiKey.spellcheck = false;

		const keyMeta = append(this._card, $('.knox-add-model-key-meta'));
		this._keyHelp = append(keyMeta, $('span.knox-add-model-key-help'));
		this._status = append(keyMeta, $('span.knox-add-model-status'));

		this._modelLabel = append(this._card, $('span.knox-add-model-label'));
		const searchWrap = append(this._card, $('.knox-add-model-search'));
		appendKnoxGuiIcon(searchWrap, 'magnifying-glass');
		this._searchInput = append(searchWrap, $<HTMLInputElement>('input.knox-add-model-search-input'));
		this._searchInput.type = 'search';
		this._list = append(this._card, $('.knox-add-model-list'));

		this._connect = append(this._card, $<HTMLButtonElement>('button.knox-add-model-connect'));
		this._connect.type = 'button';
		this._subtext = append(this._card, $('p.knox-add-model-subtext'));

		this._register(addDisposableListener(this.element, 'click', () => this.close()));
		this._register(addDisposableListener(this._card, 'click', e => e.stopPropagation()));
		this._register(addDisposableListener(this._close, 'click', () => this.close()));
		this._register(addDisposableListener(this._apiKey, 'input', () => this._syncConnect()));
		this._register(addDisposableListener(this._searchInput, 'input', () => {
			this._search = this._searchInput.value;
			this._renderList();
		}));
		this._register(addDisposableListener(this._connect, 'click', () => this._submit()));
		this._language = this._chatService.language;
		this._register(this._chatService.onDidChange(() => {
			if (!this.isOpen || this._language === this._chatService.language) {
				return;
			}
			this._language = this._chatService.language;
			this._applyCopy();
			this._renderList();
		}));
		this._applyCopy();
		this._syncConnect();
	}

	get isOpen(): boolean {
		return !this.element.classList.contains('hidden');
	}

	open(options?: IKnoxAddModelDialogOptions): void {
		this._options = { ...options };
		this._apiKey.value = '';
		this._search = '';
		this._searchInput.value = '';
		this._models = [];
		this._selected = undefined;
		this._loading = true;
		this._applyCopy();
		this._renderList();
		this._syncConnect();
		this.element.classList.remove('hidden');
		this._bindEscape();
		this._apiKey.focus();
		void this._loadModels();
	}

	close(): void {
		if (!this.isOpen) {
			return;
		}
		this._escapeStore.clear();
		this.element.classList.add('hidden');
		this._onDidClose.fire();
	}

	private _bindEscape(): void {
		this._escapeStore.clear();
		this._escapeStore.add(addDisposableListener(getActiveWindow(), 'keydown', e => {
			if (e.key === 'Escape' && this.isOpen) {
				e.preventDefault();
				e.stopPropagation();
				this.close();
			}
		}, true));
	}

	private _t(key: string, vars?: Record<string, string | number>): string {
		return knoxNls(key, vars, undefined, this._chatService.language);
	}

	private _applyCopy(): void {
		const role = this._options.modelRole;
		this._title.textContent = role
			? `${this._t('add')} ${roleDisplayName(role, key => this._t(key))} ${this._t('model')}`
			: this._t('addModel');
		this._close.title = this._t('close');
		this._close.setAttribute('aria-label', this._t('close'));
		this._keyLabel.textContent = this._t('apiKey');
		this._apiKey.placeholder = this._t('enterApiKey', { provider: KNOX_CHAT_PROVIDER_TITLE });
		this._apiKey.setAttribute('aria-label', this._t('apiKey'));
		this._renderKeyHelp();
		this._renderStatus();
		this._modelLabel.textContent = this._t('model');
		this._searchInput.placeholder = this._t('searchEllipsis');
		this._connect.textContent = this._t('connect');
		this._renderSubtext();
	}

	private _renderKeyHelp(): void {
		this._chromeStore.clear();
		clearNode(this._keyHelp);
		const link = append(this._keyHelp, $<HTMLButtonElement>('button.knox-add-model-inline-link'));
		link.type = 'button';
		link.textContent = this._t('clickHere');
		this._chromeStore.add(addDisposableListener(link, 'click', () => {
			void this._opener.open(URI.parse(KNOX_CHAT_API_KEY_URL));
		}));
		append(this._keyHelp, $('span')).textContent = ` ${this._t('toCreateApiKey', { provider: KNOX_CHAT_PROVIDER_TITLE })}`;
	}

	private _renderSubtext(): void {
		clearNode(this._subtext);
		this._subtext.append(this._t('thisSettingWillUpdate') + ' ');
		const configs = append(this._subtext, $<HTMLButtonElement>('button.knox-add-model-inline-link'));
		configs.type = 'button';
		configs.textContent = this._t('configs');
		this._chromeStore.add(addDisposableListener(configs, 'click', () => {
			void this._bridge.post('config/openProfile', { profileId: undefined }).catch(() => { });
		}));
	}

	private _renderStatus(): void {
		this._status.classList.remove('ok', 'error');
		if (this._loading) {
			this._status.textContent = this._t('loadingModels');
			return;
		}
		if (this._models.length > 0) {
			this._status.classList.add('ok');
			this._status.textContent = `${this._models.length} ${this._t('modelsLoaded')}`;
			return;
		}
		this._status.classList.add('error');
		this._status.textContent = this._t('failedToLoadModels');
	}

	private async _loadModels(): Promise<void> {
		const token = ++this._loadToken;
		this._loading = true;
		this._renderStatus();
		this._renderList();
		try {
			const result = knoxUnwrapProtocol(await this._bridge.request('knoxchat/listModels', undefined));
			if (token !== this._loadToken) {
				return;
			}
			if (result.status === 'error') {
				throw new Error(result.error || 'failed');
			}
			this._models = knoxMergeKnoxChatCatalog(knoxParseListedChatModels(result.content));
		} catch {
			if (token !== this._loadToken) {
				return;
			}
			this._models = [...KNOX_CHAT_FALLBACK_MODELS];
		} finally {
			if (token === this._loadToken) {
				this._loading = false;
				this._selected = this._models[0];
				this._renderStatus();
				this._renderList();
			}
		}
	}

	private _renderList(): void {
		this._listStore.clear();
		clearNode(this._list);
		if (this._loading) {
			append(this._list, $('div.knox-add-model-empty')).textContent = this._t('loading');
			return;
		}
		if (!this._models.length) {
			append(this._list, $('div.knox-add-model-empty')).textContent = this._t('cannotLoadModels');
			return;
		}
		const filtered = knoxFilterCatalogBySearch(this._models, this._search);
		const groups = knoxGroupModelPackages(filtered);
		if (!groups.length) {
			append(this._list, $('div.knox-add-model-empty')).textContent = this._t('noMatchingModelIds');
			return;
		}
		for (const group of groups) {
			const section = append(this._list, $('.knox-add-model-group'));
			const heading = append(section, $('h3.knox-add-model-group-title'));
			heading.textContent = group.title === 'Other' || group.title === 'Other Models'
				? this._t('otherModels')
				: group.title;
			for (const model of group.packages as IKnoxCatalogModel[]) {
				this._renderModel(section, model);
			}
		}
	}

	private _renderModel(parent: HTMLElement, model: IKnoxCatalogModel): void {
		const item = append(parent, $<HTMLButtonElement>('button.knox-add-model-item'));
		item.type = 'button';
		item.classList.toggle('selected', !!this._selected && knoxCatalogModelId(model) === knoxCatalogModelId(this._selected));
		const row = append(item, $('.knox-add-model-item-row'));
		append(row, $('span.knox-add-model-item-title')).textContent = model.title;
		const meta = append(row, $('.knox-add-model-item-meta'));
		const context = append(meta, $('span.knox-add-model-badge'));
		const contextLength = model.params.contextLength;
		context.textContent = knoxFormatContextBadge(contextLength);
		if (Number.isFinite(contextLength)) {
			context.title = contextLength.toLocaleString();
		}
		if (model.maxTokens != null) {
			const max = append(meta, $('span.knox-add-model-badge'));
			max.textContent = `↑${knoxFormatTokenCount(model.maxTokens)}`;
			max.title = `Max completion tokens: ${model.maxTokens.toLocaleString()}`;
		}
		append(item, $('div.knox-add-model-item-id')).textContent = this._t('idPrefix', { id: knoxCatalogModelId(model) });
		const chips = append(item, $('.knox-add-model-chips'));
		if (model.supportsTools) {
			append(chips, $('span.knox-add-model-badge')).textContent = 'tools';
		}
		if (model.supportsReasoning) {
			append(chips, $('span.knox-add-model-badge')).textContent = 'reasoning';
		}
		if (model.supportsWebSearch) {
			append(chips, $('span.knox-add-model-badge')).textContent = 'web';
		}
		if (model.supportsImageOutput) {
			append(chips, $('span.knox-add-model-badge')).textContent = 'img-out';
		}
		if (model.pricing) {
			const pricing = knoxFormatModelPricingPerMillion(model.pricing);
			const badge = append(chips, $('span.knox-add-model-badge'));
			badge.textContent = pricing.badge;
			badge.title = pricing.title;
		}
		for (const modality of knoxDisplayModalities(model.modalities)) {
			append(chips, $('span.knox-add-model-badge')).textContent = modality;
		}
		this._listStore.add(addDisposableListener(item, 'click', () => {
			this._selected = model;
			this._renderList();
		}));
	}

	private _syncConnect(): void {
		this._connect.disabled = knoxConnectDisabled(this._apiKey.value);
	}

	private _submit(): void {
		if (knoxConnectDisabled(this._apiKey.value) || !this._selected) {
			return;
		}
		const payload = knoxBuildKnoxChatAddModelPayload(this._selected, this._apiKey.value, this._options);
		this._chatService.addModel(payload, knoxModelRoleToExperimentalRole(this._options.modelRole));
		if (this._options.modelRole && this._options.modelRole !== 'chat') {
			this._chatService.setSelectedModelByRole(this._options.modelRole, payload.title);
		}
		this._onDidAddModel.fire();
		this.close();
	}
}

function roleDisplayName(role: KnoxModelRole, t: (key: string) => string): string {
	switch (role) {
		case 'chat': return t('chatRole');
		case 'edit': return t('editRole');
		case 'apply': return t('applyRole');
		case 'summarize': return t('summarizeRole');
		case 'viewRead': return t('viewReadRole');
		case 'realTimeSearch': return t('realTimeSearchRole');
	}
}
