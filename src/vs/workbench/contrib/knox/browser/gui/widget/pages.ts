/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../knoxGuiWidget.js';
import { t } from './t.js';
import * as DOM from '../../../../../../base/browser/dom.js';
import { URI } from '../../../../../../base/common/uri.js';
import { appendKnoxGuiSvg } from '../knoxGuiIcons.js';
import {
	ADD_MODEL_PROVIDERS,
	addModelBrowseGroups,
	addModelProviderById,
	addModelRequiredSatisfied,
	batchDiffTotals,
	knoxGuiOAuthErrorI18nKey,
	knoxGuiOAuthPane,
	filterKnoxChatModels,
	formatModelPricingPerMillion,
	groupKnoxChatModels,
	knoxGuiProviderLogoUri,
	MODEL_ROLE_LABEL_KEY,
	sortConfigErrors,
	splitFilePath,
	type IKnoxGuiAddModelPackage,
	type IKnoxGuiAddModelProvider,
} from '../../../common/knoxGuiOverlays.js';
import { KnoxGuiRoute } from '../../../common/knoxGuiProtocol.js';
import { IKnoxGuiState } from '../../../common/knoxGuiState.js';
import { formatTokenCount } from '../../../common/knoxGuiTranscript.js';

export function renderConfigError(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	widget.back(body, state, undefined, 'knox-gui-page-header-plain knox-gui-page-header-sm');
	body.classList.add('knox-gui-page');
	DOM.append(body, DOM.$('h3.knox-gui-config-error-title', undefined, t(state, 'configErrors')));
	DOM.append(body, DOM.$('p', undefined, t(state, 'pleaseResolveConfigErrors')));
	const errors = sortConfigErrors(state.configError);
	if (!errors.length) {
		const ok = DOM.append(body, DOM.$('.knox-gui-empty.knox-gui-ok'));
		ok.setAttribute('data-testid', 'knox-gui-config-ok');
		ok.textContent = t(state, 'noConfigErrorsFound');
		return;
	}
	for (const error of errors) {
		const row = DOM.append(body, DOM.$(error.fatal ? '.knox-gui-error-card' : '.knox-gui-warn-card'));
		const icon = DOM.append(row, DOM.$('span.knox-gui-error-icon'));
		appendKnoxGuiSvg(icon, error.fatal ? 'alert-circle' : 'alert-triangle', 20);
		const text = DOM.append(row, DOM.$('p'));
		DOM.append(text, DOM.$('strong', undefined, error.fatal ? t(state, 'fatalError') : t(state, 'warning')));
		text.append(` ${error.message}`);
	}
}

export function renderStats(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	widget.back(body, state, t(state, 'tokenUsageDashboard'), 'knox-gui-page-header-plain knox-gui-page-header-sm knox-gui-page-header-lg-arrow');
	body.classList.add('knox-gui-page');
	body.setAttribute('data-testid', 'knox-gui-stats');
	const box = DOM.append(body, DOM.$('.knox-gui-stats-billing'));
	DOM.append(box, DOM.$('p', undefined, t(state, 'tokenUsageKnoxChatBilling')));
}

export function renderAddModel(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	body.classList.add('knox-gui-page');
	body.setAttribute('data-testid', 'knox-gui-add-model');
	if (state.route === KnoxGuiRoute.AddModelProvider && state.providerName) {
		widget.renderConfigureProvider(body, state);
		return;
	}
	const sticky = DOM.append(body, DOM.$('.knox-gui-page-header.knox-gui-page-header-plain.knox-gui-page-header-lg.knox-gui-page-header-lg-arrow'));
	widget.chromeButton(sticky, {
		svg: 'arrow-left',
		svgSize: 16,
		title: t(state, 'backToChat'),
		extraClass: 'knox-gui-page-back',
		onClick: () => widget.controller.store.navigate('/'),
	});
	DOM.append(sticky, DOM.$('span.knox-gui-page-title', undefined, t(state, 'addNewModel')));
	const box = DOM.append(body, DOM.$('.knox-gui-card.knox-gui-add-model-help'));
	DOM.append(box, DOM.$('p', undefined, t(state, 'addModelInstructions')));
	const options = DOM.append(box, DOM.$('ul.knox-gui-add-model-options'));
	DOM.append(options, DOM.$('li', undefined, t(state, 'addModelOption1')));
	DOM.append(options, DOM.$('li', undefined, t(state, 'addModelOption2')));
	const docs = widget.chromeButton(box, { label: t(state, 'visitSetupDocs'), extraClass: 'knox-gui-ghost', onClick: () => void widget.openerService.open(URI.parse('https://docs.knox.chat/model-setup/overview')) });
	docs.insertAdjacentText('afterend', ` ${t(state, 'toLearnMore')}`);
	const toggle = DOM.append(body, DOM.$('.knox-gui-add-model-toggle'));
	toggle.setAttribute('data-testid', 'knox-gui-add-model-toggle');
	widget.chromeButton(toggle, {
		label: t(state, 'startWithProvider'),
		selected: widget.addModelBrowseMode === 'provider',
		testId: 'knox-gui-add-model-by-provider',
		extraClass: 'knox-gui-add-model-mode',
		onClick: () => {
			widget.addModelBrowseMode = 'provider';
			widget.render();
		},
	});
	widget.chromeButton(toggle, {
		label: t(state, 'selectSpecificModel'),
		selected: widget.addModelBrowseMode === 'model',
		testId: 'knox-gui-add-model-by-model',
		extraClass: 'knox-gui-add-model-mode',
		onClick: () => {
			widget.addModelBrowseMode = 'model';
			widget.render();
		},
	});
	if (widget.addModelBrowseMode === 'model') {
		const intro = DOM.append(body, DOM.$('.knox-gui-page-intro'));
		DOM.append(intro, DOM.$('h2', undefined, t(state, 'models')));
		DOM.append(intro, DOM.$('p', undefined, t(state, 'selectModelBelow')));
		for (const group of addModelBrowseGroups()) {
			const section = DOM.append(body, DOM.$('.knox-gui-add-model-group'));
			DOM.append(section, DOM.$('h3', undefined, group.title));
			DOM.append(section, DOM.$('hr.knox-gui-rule'));
			const grid = DOM.append(section, DOM.$('.knox-gui-provider-grid'));
			for (const pack of group.packages) {
				renderModelCard(widget, grid, state, {
					title: pack.title,
					description: pack.description ?? pack.title,
					icon: group.icon ?? pack.icon,
					tags: pack.tags,
					providerOptions: pack.providerOptions,
					dimensions: pack.dimensions,
					testId: `knox-gui-model-pack-${group.providerId}-${pack.params.model}`,
					onClick: (dimensionChoices, selectedProvider) => {
						void widget.controller.addConfiguredModel(selectedProvider ?? group.providerId, pack, { dimensionChoices, selectedProvider });
					},
				});
			}
		}
		return;
	}
	const intro = DOM.append(body, DOM.$('.knox-gui-page-intro'));
	DOM.append(intro, DOM.$('h2', undefined, t(state, 'provider')));
	DOM.append(intro, DOM.$('p', undefined, t(state, 'selectProviderBelow')));
	const grid = DOM.append(body, DOM.$('.knox-gui-provider-grid'));
	for (const provider of ADD_MODEL_PROVIDERS) {
		renderProviderCard(widget, grid, state, provider, () => widget.controller.store.navigate(`/addModel/provider/${provider.id}`));
	}
}

function renderProviderCard(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, provider: IKnoxGuiAddModelProvider, onClick: () => void): void {
	renderModelCard(widget, parent, state, {
		title: provider.title,
		description: t(state, provider.descriptionKey),
		icon: provider.icon,
		tags: provider.tags,
		refPage: provider.refPage || provider.provider,
		testId: `knox-gui-provider-${provider.id}`,
		onClick,
	});
}

function renderModelCard(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState, card: {
	title: string;
	description: string;
	icon?: string;
	tags?: string[];
	refPage?: string;
	providerOptions?: string[];
	dimensions?: IKnoxGuiAddModelPackage['dimensions'];
	testId?: string;
	disabled?: boolean;
	onClick: (dimensionChoices?: string[], selectedProvider?: string) => void;
}): void {
	const el = DOM.append(parent, DOM.$('button.knox-gui-provider-card')) as HTMLButtonElement;
	el.type = 'button';
	el.disabled = Boolean(card.disabled);
	if (card.testId) {
		el.setAttribute('data-testid', card.testId);
	}
	const head = DOM.append(el, DOM.$('.knox-gui-provider-card-head'));
	const logoSrc = knoxGuiProviderLogoUri(card.icon);
	if (logoSrc) {
		const img = DOM.append(head, DOM.$('img.knox-gui-provider-icon')) as HTMLImageElement;
		img.src = logoSrc;
		img.alt = '';
		img.width = 24;
		img.height = 24;
		img.setAttribute('aria-hidden', 'true');
		img.title = (card.icon ?? '').replace(/\.png$/i, '');
	} else if (card.icon) {
		const icon = DOM.append(head, DOM.$('span.knox-gui-provider-icon', undefined, card.title.slice(0, 1)));
		icon.setAttribute('aria-hidden', 'true');
		icon.title = card.icon.replace(/\.png$/i, '');
	}
	DOM.append(head, DOM.$('h3', undefined, card.title));
	if (card.tags?.length) {
		const tags = DOM.append(el, DOM.$('.knox-gui-provider-tags'));
		for (const tag of card.tags) {
			DOM.append(tags, DOM.$(`span.knox-gui-model-provider-tag${tag === 'tagApiKeyRequired' ? '.is-tagApiKeyRequired' : ''}`, undefined, t(state, tag)));
		}
	}
	DOM.append(el, DOM.$('p', undefined, card.description));
	if (card.refPage) {
		widget.chromeButton(el, {
			svg: 'folder-open',
			svgSize: 16,
			title: t(state, 'viewDocs'),
			extraClass: 'knox-gui-provider-docs',
			onClick: (_btn, event) => {
				event?.stopPropagation();
				void widget.openerService.open(URI.parse(`https://docs.knox.chat/reference/Model%20Providers/${card.refPage}`));
			},
		});
	}
	const dimensionChoices = (card.dimensions ?? []).map(dimension => Object.keys(dimension.options)[0] ?? '');
	let selectedProvider = card.providerOptions?.[0];
	if (card.dimensions?.length || card.providerOptions?.length) {
		const dims = DOM.append(el, DOM.$('.knox-gui-model-dims'));
		(card.dimensions ?? []).forEach((dimension, dimIndex) => {
			const row = DOM.append(dims, DOM.$('.knox-gui-model-dim-row'));
			const label = DOM.append(row, DOM.$('span.knox-gui-muted', undefined, dimension.name));
			label.title = dimension.description;
			const options = DOM.append(row, DOM.$('.knox-gui-model-dim-options'));
			const keys = Object.keys(dimension.options);
			for (const key of keys) {
				const opt = DOM.append(options, DOM.$(key === dimensionChoices[dimIndex] ? 'span.knox-gui-dim-option.selected' : 'span.knox-gui-dim-option', undefined, key));
				opt.setAttribute('data-testid', `knox-gui-dim-${dimension.name}-${key}`);
				widget.renderStore.add(DOM.addDisposableListener(opt, 'click', event => {
					event.stopPropagation();
					dimensionChoices[dimIndex] = key;
					options.querySelectorAll('.knox-gui-dim-option').forEach(node => node.classList.toggle('selected', node === opt));
				}));
			}
		});
		if (card.providerOptions?.length) {
			const row = DOM.append(dims, DOM.$('.knox-gui-model-dim-row.knox-gui-model-providers'));
			for (const option of card.providerOptions) {
				const info = addModelProviderById(option);
				if (!info) {
					continue;
				}
				const chip = DOM.append(row, DOM.$(option === selectedProvider ? 'span.knox-gui-provider-chip.selected' : 'span.knox-gui-provider-chip'));
				chip.title = t(state, 'chooseProviderForModel');
				chip.setAttribute('data-testid', `knox-gui-provider-chip-${option}`);
				const chipLogo = knoxGuiProviderLogoUri(info.icon);
				if (chipLogo) {
					const img = DOM.append(chip, DOM.$('img')) as HTMLImageElement;
					img.src = chipLogo;
					img.alt = info.title;
					img.width = 24;
					img.height = 24;
				} else {
					chip.textContent = info.title.slice(0, 1);
				}
				widget.renderStore.add(DOM.addDisposableListener(chip, 'click', event => {
					event.stopPropagation();
					selectedProvider = option;
					row.querySelectorAll('.knox-gui-provider-chip').forEach(node => node.classList.toggle('selected', node === chip));
				}));
			}
		}
	}
	widget.renderStore.add(DOM.addDisposableListener(el, 'click', () => {
		if (card.disabled) {
			return;
		}
		card.onClick(dimensionChoices.length ? dimensionChoices : undefined, selectedProvider);
	}));
}

export function renderConfigureProvider(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	const provider = addModelProviderById(state.providerName);
	const sticky = DOM.append(body, DOM.$('.knox-gui-page-header.knox-gui-page-header-plain.knox-gui-page-header-lg.knox-gui-page-header-lg-arrow'));
	widget.chromeButton(sticky, { svg: 'arrow-left', svgSize: 16, title: t(state, 'backToChat'), extraClass: 'knox-gui-page-back', onClick: () => widget.controller.store.navigate('/addModel') });
	DOM.append(sticky, DOM.$('span.knox-gui-page-title', undefined, t(state, 'configureProvider')));
	if (!provider) {
		DOM.append(body, DOM.$('.knox-gui-empty', undefined, state.providerName ?? ''));
		return;
	}
	const titleRow = DOM.append(body, DOM.$('.knox-gui-configure-provider-title'));
	const logoSrc = knoxGuiProviderLogoUri(provider.icon);
	if (logoSrc) {
		const img = DOM.append(titleRow, DOM.$('img')) as HTMLImageElement;
		img.src = logoSrc;
		img.alt = '';
		img.height = 24;
	}
	DOM.append(titleRow, DOM.$('h2', undefined, provider.title));
	for (const tag of provider.tags ?? []) {
		DOM.append(body, DOM.$(`span.knox-gui-model-provider-tag.is-${tag}`, undefined, t(state, tag)));
	}
	const description = DOM.append(body, DOM.$('.knox-gui-configure-provider-description'));
	widget.appendMarkdown(description, t(state, provider.longDescriptionKey ?? provider.descriptionKey));
	if (provider.id === 'knoxchat') {
		widget.renderOAuthRow(body, state);
	}
	const required = provider.collectInputFor.filter(input => input.required);
	const optional = provider.collectInputFor.filter(input => !input.required);
	if (required.length) {
		DOM.append(body, DOM.$('h4', undefined, t(state, 'enterRequiredParams')));
		for (const input of required) {
			widget.renderAddModelInput(body, state, input);
		}
	}
	if (optional.length) {
		const details = DOM.append(body, DOM.$('details.knox-gui-card'));
		const summary = DOM.append(details, DOM.$('summary'));
		DOM.append(summary, DOM.$('strong', undefined, t(state, 'advancedOptional')));
		for (const input of optional) {
			widget.renderAddModelInput(details, state, input);
		}
	}
	if (provider.apiKeyUrl) {
		widget.chromeButton(body, { icon: 'codicon-link-external', label: t(state, 'apiKeyLabel'), extraClass: 'knox-gui-ghost', onClick: () => {
			widget.controller.messenger.post('openUrl', provider.apiKeyUrl);
			void widget.openerService.open(URI.parse(provider.apiKeyUrl!));
		} });
	}
	const ready = addModelRequiredSatisfied(provider, state.addModelDraft, state.oauthConnected);
	DOM.append(body, DOM.$('h4', undefined, t(state, 'selectModelPreset')));
	if (provider.id === 'knoxchat') {
		widget.renderKnoxChatModelList(body, state, ready, { selectOnly: true });
		const selected = state.knoxChatModels.find(model => model.model === state.addModelSelectedModel) ?? state.knoxChatModels[0];
		formButton(widget, body, {
			label: t(state, 'connect'),
			disabled: !ready || !selected,
			onClick: () => {
				if (!selected || !ready) {
					return;
				}
				void widget.controller.addConfiguredModel('knoxchat', knoxChatPack(selected));
			},
		});
		return;
	}
	const grid = DOM.append(body, DOM.$('.knox-gui-provider-grid'));
	for (const pack of provider.packages) {
		renderModelCard(widget, grid, state, {
			title: pack.title,
			description: pack.description ?? '',
			icon: pack.icon || provider.icon,
			tags: pack.tags,
			dimensions: pack.dimensions,
			testId: `knox-gui-add-pack-${pack.title}`,
			disabled: !ready,
			onClick: (dimensionChoices) => {
				if (!ready) {
					return;
				}
				void widget.controller.addConfiguredModel(provider.id, pack, { dimensionChoices, selectedProvider: provider.id });
			},
		});
	}
}

export function renderKnoxChatModelList(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, ready: boolean, options?: { selectOnly?: boolean }): void {
	if (state.knoxChatModelsLoading) {
		const loading = DOM.append(body, DOM.$('.knox-gui-knoxchat-empty'));
		DOM.append(loading, DOM.$('span.knox-gui-muted', undefined, t(state, 'loading')));
		return;
	}
	if (!state.knoxChatModels.length) {
		const empty = DOM.append(body, DOM.$('.knox-gui-knoxchat-empty'));
		DOM.append(empty, DOM.$('span.knox-gui-muted', undefined, t(state, 'cannotLoadModels')));
		return;
	}
	const searchWrap = DOM.append(body, DOM.$('.knox-gui-knoxchat-search'));
	appendKnoxGuiSvg(searchWrap, 'search', 16).classList.add('knox-gui-knoxchat-search-icon');
	const search = DOM.append(searchWrap, DOM.$('input.knox-gui-knoxchat-search-input')) as HTMLInputElement;
	search.type = 'search';
	search.placeholder = t(state, 'searchEllipsis');
	search.value = widget.knoxChatModelQuery;
	widget.renderStore.add(DOM.addDisposableListener(search, 'input', () => {
		widget.knoxChatModelQuery = search.value;
		widget.controller.store.patch({});
	}));
	const filtered = filterKnoxChatModels(state.knoxChatModels, widget.knoxChatModelQuery);
	const list = DOM.append(body, DOM.$('.knox-gui-knoxchat-list'));
	if (!filtered.length) {
		DOM.append(list, DOM.$('.knox-gui-knoxchat-empty', undefined, t(state, 'noMatchingModelIds')));
		return;
	}
	const selectedId = state.addModelSelectedModel ?? filtered[0]?.model;
	for (const group of groupKnoxChatModels(filtered)) {
		const section = DOM.append(list, DOM.$('.knox-gui-knoxchat-group'));
		DOM.append(section, DOM.$('h3.knox-gui-knoxchat-category', undefined, group.category === 'Other Models' ? t(state, 'otherModels') : group.category));
		for (const model of group.models) {
			const selected = model.model === selectedId;
			const row = DOM.append(section, DOM.$(selected ? '.knox-gui-knoxchat-item.is-selected' : '.knox-gui-knoxchat-item'));
			row.setAttribute('data-testid', `knox-gui-add-pack-${model.title}`);
			const top = DOM.append(row, DOM.$('.knox-gui-knoxchat-item-top'));
			DOM.append(top, DOM.$('div.knox-gui-knoxchat-title', undefined, model.title));
			const badges = DOM.append(top, DOM.$('.knox-gui-knoxchat-meta'));
			const ctx = DOM.append(badges, DOM.$('span.knox-gui-knoxchat-badge'));
			ctx.textContent = Number.isFinite(model.contextLength) ? formatTokenCount(model.contextLength) : '∞';
			if (Number.isFinite(model.contextLength)) {
				ctx.title = model.contextLength.toLocaleString();
			}
			if (model.maxTokens !== undefined) {
				const max = DOM.append(badges, DOM.$('span.knox-gui-knoxchat-badge', undefined, `↑${formatTokenCount(model.maxTokens)}`));
				max.title = `Max completion tokens: ${model.maxTokens.toLocaleString()}`;
			}
			DOM.append(row, DOM.$('div.knox-gui-knoxchat-id', undefined, t(state, 'idPrefix', { id: model.model })));
			const caps = DOM.append(row, DOM.$('.knox-gui-knoxchat-caps'));
			if (model.supportsTools) {
				DOM.append(caps, DOM.$('span.knox-gui-knoxchat-badge', undefined, 'tools'));
			}
			if (model.supportsReasoning) {
				DOM.append(caps, DOM.$('span.knox-gui-knoxchat-badge', undefined, 'reasoning'));
			}
			if (model.supportsWebSearch) {
				DOM.append(caps, DOM.$('span.knox-gui-knoxchat-badge', undefined, 'web'));
			}
			if (model.supportsImageOutput) {
				DOM.append(caps, DOM.$('span.knox-gui-knoxchat-badge', undefined, 'img-out'));
			}
			if (model.pricing) {
				const label = formatModelPricingPerMillion(model.pricing);
				const price = DOM.append(caps, DOM.$('span.knox-gui-knoxchat-badge', undefined, label.badge));
				price.title = label.title;
			}
			for (const modality of (model.modalities ?? []).filter(m => m !== 'text')) {
				DOM.append(caps, DOM.$('span.knox-gui-knoxchat-badge', undefined, modality));
			}
			widget.renderStore.add(DOM.addDisposableListener(row, 'click', () => {
				widget.controller.store.patch({ addModelSelectedModel: model.model });
			}));
			if (!options?.selectOnly && ready) {
				widget.renderStore.add(DOM.addDisposableListener(row, 'dblclick', () => {
					void widget.controller.addConfiguredModel('knoxchat', knoxChatPack(model));
				}));
			}
		}
	}
}

function knoxChatPack(model: IKnoxGuiState['knoxChatModels'][number]): IKnoxGuiAddModelPackage {
	return {
		title: model.title,
		description: model.description,
		params: {
			model: model.model,
			contextLength: model.contextLength,
			title: model.title,
			supportedParameters: model.supportedParameters,
			capabilities: {
				...(model.supportsTools ? { tools: true } : {}),
				...(model.supportsReasoning ? { reasoning: true } : {}),
				...(model.supportsWebSearch ? { webSearch: true } : {}),
			},
		},
		category: model.category,
		supportsTools: model.supportsTools,
		supportsReasoning: model.supportsReasoning,
		supportsWebSearch: model.supportsWebSearch,
	};
}

export function renderAddModelForm(widget: KnoxGuiWidget, state: IKnoxGuiState): void {
	const overlay = DOM.append(widget.root, DOM.$('.knox-gui-text-dialog.knox-gui-add-model-dialog'));
	overlay.setAttribute('data-testid', 'knox-gui-add-model-modal');
	overlay.setAttribute('role', 'presentation');
	widget.renderStore.add(DOM.addDisposableListener(overlay, 'click', () => widget.controller.closeAddModelModal()));
	const panel = DOM.append(overlay, DOM.$('.knox-gui-text-dialog-panel'));
	widget.renderStore.add(DOM.addDisposableListener(panel, 'click', e => e.stopPropagation()));
	const box = DOM.append(panel, DOM.$('.knox-gui-text-dialog-body.knox-gui-add-model-form'));
	box.setAttribute('role', 'dialog');
	box.setAttribute('aria-modal', 'true');
	widget.chromeButton(box, {
		svg: 'x',
		svgSize: 20,
		title: t(state, 'close'),
		extraClass: 'knox-gui-text-dialog-close',
		onClick: () => widget.controller.closeAddModelModal(),
	});
	const roleLabel = state.addModelRole ? t(state, MODEL_ROLE_LABEL_KEY[state.addModelRole]) : undefined;
	DOM.append(box, DOM.$('h4.knox-gui-add-model-form-title', undefined, roleLabel ? `${t(state, 'add')} ${roleLabel} ${t(state, 'model')}` : t(state, 'addModel')));
	const form = DOM.append(box, DOM.$('.knox-gui-add-model-form-body'));
	widget.renderOAuthRow(form, state);
	const modelSection = DOM.append(form, DOM.$('.knox-gui-add-model-section'));
	DOM.append(modelSection, DOM.$('label.knox-gui-add-model-label', undefined, t(state, 'model')));
	widget.renderKnoxChatModelList(modelSection, state, state.oauthConnected, { selectOnly: true });
	const actions = DOM.append(box, DOM.$('.knox-gui-add-model-form-actions'));
	const selected = state.knoxChatModels.find(model => model.model === state.addModelSelectedModel) ?? state.knoxChatModels[0];
	formButton(widget, actions, {
		label: t(state, 'connect'),
		disabled: !state.oauthConnected || !selected,
		testId: 'knox-gui-add-model-connect',
		onClick: () => {
			if (!selected || !state.oauthConnected) {
				return;
			}
			void widget.controller.addConfiguredModel('knoxchat', knoxChatPack(selected));
		},
	});
	const sub = DOM.append(actions, DOM.$('span.knox-gui-add-model-subtext'));
	sub.append(t(state, 'thisSettingWillUpdate'));
	sub.append(' ');
	const configs = DOM.append(sub, DOM.$('span.knox-gui-link', undefined, t(state, 'configs')));
	widget.renderStore.add(DOM.addDisposableListener(configs, 'click', e => {
		e.stopPropagation();
		widget.controller.messenger.post('config/openProfile', { profileId: undefined });
	}));
}

/** `components/index.tsx` `Button` (primary) and `SecondaryButton`. */
export function formButton(widget: KnoxGuiWidget, parent: HTMLElement, options: { label: string; secondary?: boolean; disabled?: boolean; testId?: string; onClick: () => void }): HTMLButtonElement {
	const button = DOM.append(parent, DOM.$(options.secondary ? 'button.knox-gui-form-button.knox-gui-form-button-secondary' : 'button.knox-gui-form-button.knox-gui-connect')) as HTMLButtonElement;
	button.type = 'button';
	button.textContent = options.label;
	button.disabled = Boolean(options.disabled);
	if (options.testId) {
		button.setAttribute('data-testid', options.testId);
	}
	widget.renderStore.add(DOM.addDisposableListener(button, 'click', e => {
		e.stopPropagation();
		options.onClick();
	}));
	return button;
}

export function renderOAuthRow(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	const pane = DOM.append(body, DOM.$('.knox-gui-oauth-pane'));
	DOM.append(pane, DOM.$('label.knox-gui-add-model-label', undefined, t(state, 'knoxChatAccount')));
	const view = knoxGuiOAuthPane(state.oauthStatus, state.oauthConnected);
	if (view === 'connected') {
		const row = DOM.append(pane, DOM.$('.knox-gui-oauth-row'));
		DOM.append(row, DOM.$('span', undefined, t(state, 'connectedAs', { handle: state.oauthHandle ?? '' })));
		DOM.append(row, DOM.$('.knox-gui-oauth-row-spacer'));
		formButton(widget, row, { label: t(state, 'signOutKnoxChat'), secondary: true, onClick: () => widget.controller.messenger.post('knoxchat/oauth/signOut', undefined) });
		return;
	}
	if (view === 'in_progress') {
		const row = DOM.append(pane, DOM.$('.knox-gui-oauth-row'));
		DOM.append(row, DOM.$('span', undefined, t(state, 'waitingForBrowser')));
		DOM.append(row, DOM.$('.knox-gui-oauth-row-spacer'));
		formButton(widget, row, { label: t(state, 'cancelSignIn'), secondary: true, onClick: () => widget.controller.messenger.post('knoxchat/oauth/cancel', undefined) });
		return;
	}
	const signedOut = DOM.append(pane, DOM.$('.knox-gui-oauth-signed-out'));
	const errorKey = knoxGuiOAuthErrorI18nKey(state.oauthStatus, state.oauthError);
	if (errorKey) {
		DOM.append(signedOut, DOM.$('p.knox-gui-oauth-error', undefined, t(state, errorKey)));
	} else {
		DOM.append(signedOut, DOM.$('p.knox-gui-oauth-hint', undefined, t(state, 'hintSignInKnoxChat')));
	}
	formButton(widget, signedOut, { label: t(state, 'signInKnoxStudio'), onClick: () => widget.controller.messenger.post('knoxchat/oauth/start', undefined) });
}

export function renderAddModelInput(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, input: { key: string; labelKey: string; placeholderKey?: string; inputType?: string; defaultValue?: string | number; min?: number; max?: number; step?: number }): void {
	const row = DOM.append(body, DOM.$('label.knox-gui-settings-stack'));
	DOM.append(row, DOM.$('span', undefined, t(state, input.labelKey)));
	const field = DOM.append(row, DOM.$('input')) as HTMLInputElement;
	field.type = input.inputType === 'password' ? 'password' : input.inputType === 'number' ? 'number' : 'text';
	field.value = state.addModelDraft[input.key] ?? (input.defaultValue != null ? String(input.defaultValue) : '');
	if (input.placeholderKey) {
		field.placeholder = t(state, input.placeholderKey, { provider: addModelProviderById(state.providerName)?.title ?? '' });
	}
	if (input.min != null) {
		field.min = String(input.min);
	}
	if (input.max != null) {
		field.max = String(input.max);
	}
	if (input.step != null) {
		field.step = String(input.step);
	}
	widget.renderStore.add(DOM.addDisposableListener(field, 'input', () => {
		widget.controller.store.patch({ addModelDraft: { ...widget.controller.store.state.addModelDraft, [input.key]: field.value } });
	}));
}

export function renderBatchDiff(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	body.classList.add('knox-gui-page');
	body.setAttribute('data-testid', 'knox-gui-batch-diff');
	const files = state.pendingFiles;
	if (!files.length) {
		DOM.append(body, DOM.$('.knox-gui-empty', undefined, t(state, 'noPendingDiffs')));
		return;
	}
	const totals = batchDiffTotals(files);
	const panel = DOM.append(body, DOM.$('.knox-gui-batch-panel'));
	const head = DOM.append(panel, DOM.$('.knox-gui-batch-head'));
	const title = DOM.append(head, DOM.$('strong.knox-gui-batch-title'));
	appendKnoxGuiSvg(title, 'package', 14);
	title.append(` ${t(state, 'batchDiff')}`);
	DOM.append(head, DOM.$('span.knox-gui-muted', undefined, `${files.length} ${t(state, 'files')}, ${totals.diffs} ${t(state, 'changes')}`));
	const actions = DOM.append(head, DOM.$('.knox-gui-row'));
	widget.chromeButton(actions, { label: t(state, 'selectAll'), testId: 'knox-gui-batch-select-all', onClick: () => widget.controller.store.patch({ pendingFiles: files.map(file => ({ ...file, selected: true })) }) });
	widget.chromeButton(actions, { label: t(state, 'deselectAll'), testId: 'knox-gui-batch-deselect-all', onClick: () => widget.controller.store.patch({ pendingFiles: files.map(file => ({ ...file, selected: false })) }) });
	const list = DOM.append(panel, DOM.$('.knox-gui-batch-list'));
	for (const file of files) {
		const { fileName, dirPath } = splitFilePath(file.filepath);
		const row = DOM.append(list, DOM.$(file.selected ? 'div.knox-gui-row.knox-gui-batch-row.selected' : 'div.knox-gui-row.knox-gui-batch-row'));
		const toggle = () => widget.controller.store.patch({ pendingFiles: files.map(item => item.filepath === file.filepath ? { ...item, selected: !item.selected } : item) });
		const box = DOM.append(row, DOM.$('input')) as HTMLInputElement;
		box.type = 'checkbox';
		box.checked = file.selected;
		widget.renderStore.add(DOM.addDisposableListener(box, 'click', e => e.stopPropagation()));
		widget.renderStore.add(DOM.addDisposableListener(box, 'change', toggle));
		widget.renderStore.add(DOM.addDisposableListener(row, 'click', toggle));
		const name = DOM.append(row, DOM.$('span.knox-gui-ellipsis'));
		name.title = file.filepath;
		name.append(fileName);
		if (dirPath) {
			DOM.append(name, DOM.$('span.knox-gui-muted', undefined, ` ${dirPath}`));
		}
		DOM.append(row, DOM.$('span.knox-gui-badge', undefined, String(file.numDiffs)));
	}
	const foot = DOM.append(panel, DOM.$('.knox-gui-row'));
	DOM.append(foot, DOM.$('span.knox-gui-muted', undefined, `${totals.selected}/${files.length} ${t(state, 'selected')}`));
	const selected = files.filter(file => file.selected);
	widget.chromeButton(foot, {
		label: selected.length ? t(state, 'rejectSelected') : t(state, 'rejectAll'),
		disabled: state.batchApplying,
		testId: 'knox-gui-batch-reject',
		extraClass: 'knox-gui-batch-reject',
		onClick: () => void widget.controller.applyBatchDiff(selected.length ? 'rejectSelected' : 'rejectAll', selected.length ? selected.map(file => file.filepath) : undefined),
	});
	widget.chromeButton(foot, {
		label: state.batchApplying ? t(state, 'applying') : (selected.length ? t(state, 'acceptSelected') : t(state, 'acceptAll')),
		disabled: state.batchApplying,
		testId: 'knox-gui-batch-accept',
		extraClass: 'knox-gui-batch-accept',
		onClick: () => void widget.controller.applyBatchDiff(selected.length ? 'acceptSelected' : 'acceptAll', selected.length ? selected.map(file => file.filepath) : undefined),
	});
}
