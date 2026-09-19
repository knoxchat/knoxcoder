/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IKnoxChatService } from '../../common/knoxChatService.js';
import { knoxNls, KNOX_LANGUAGE_NAMES, KNOX_UI_LANGUAGES, KnoxUiLanguage } from '../../common/knoxI18n.js';
import {
	KNOX_AGENT_PROFILE_SETTINGS,
	KNOX_MAX_FONT_SIZE,
	KNOX_MAX_VIEW_SUBDIRECTORY_MAX_FILES,
	KNOX_MIN_FONT_SIZE,
	KNOX_MIN_VIEW_SUBDIRECTORY_MAX_FILES,
	KnoxAgentProfileSetting,
	knoxReadAgentMaxSteps,
	knoxReadDoomLoopThreshold,
	knoxReadFontSize,
	knoxReadPromptPath,
	knoxReadUiBoolean,
	knoxReadViewSubdirectoryMaxFiles,
	knoxResolveAgentProfileSetting,
	knoxSharedConfigForAgentProfile,
	IKnoxSharedConfig,
} from '../../common/knoxSharedConfig.js';

/**
 * Native UserSettingsForm (T9.1): language, interface, font size, agent profile.
 */
export class KnoxConfigPanel extends Disposable {

	readonly element: HTMLElement;
	private readonly _viewStore = this._register(new DisposableStore());

	constructor(
		parent: HTMLElement,
		@IKnoxChatService private readonly _chatService: IKnoxChatService,
	) {
		super();
		this.element = append(parent, $('.knox-config'));
		this.element.setAttribute('role', 'region');
		this.element.setAttribute('aria-label', knoxNls('settings'));
		this._register(this._chatService.onDidChange(() => this.refresh()));
		this.refresh();
	}

	refresh(): void {
		this._viewStore.clear();
		clearNode(this.element);
		const lang = this._chatService.language;
		const t = (key: string) => knoxNls(key, undefined, undefined, lang);
		const config = this._chatService.config;

		if (this._chatService.availableProfiles.length > 1) {
			this._card(t('assistantProfile'));
			this._selectRow(
				t('profile'),
				this._chatService.availableProfiles.map(profile => ({
					value: profile.id,
					label: profile.title || profile.id,
				})),
				this._chatService.profileId ?? '',
				value => this._chatService.selectProfile(value),
			);
		}

		this._card(t('language'));
		this._selectRow(
			t('language'),
			KNOX_UI_LANGUAGES.map(id => ({ value: id, label: KNOX_LANGUAGE_NAMES[id] })),
			lang,
			value => this._chatService.setLanguage(value as KnoxUiLanguage),
		);

		this._card(t('interfaceSettings'));
		this._toggle(t('showSessionTabs'), knoxReadUiBoolean(config, 'showSessionTabs'), () => {
			this._update({ showSessionTabs: !knoxReadUiBoolean(config, 'showSessionTabs') });
		});
		this._toggle(t('codeBlockAutoWrap'), knoxReadUiBoolean(config, 'codeWrap'), () => {
			this._update({ codeWrap: !knoxReadUiBoolean(config, 'codeWrap') });
		});
		this._toggle(t('showChatScrollbar'), knoxReadUiBoolean(config, 'showChatScrollbar'), () => {
			this._update({ showChatScrollbar: !knoxReadUiBoolean(config, 'showChatScrollbar') });
		});
		this._toggle(t('autoNameSessionTitles'), !knoxReadUiBoolean(config, 'disableSessionTitles'), () => {
			this._update({ disableSessionTitles: knoxReadUiBoolean(config, 'disableSessionTitles') ? false : true });
		});
		this._toggle(t('markdownFormatting'), !knoxReadUiBoolean(config, 'displayRawMarkdown'), () => {
			this._update({ displayRawMarkdown: knoxReadUiBoolean(config, 'displayRawMarkdown') ? false : true });
		});

		this._card(t('accessibilityDisplay'));
		this._number(
			t('fontSize'),
			knoxReadFontSize(config),
			KNOX_MIN_FONT_SIZE,
			KNOX_MAX_FONT_SIZE,
			value => this._update({ fontSize: value }),
		);

		this._card(knoxNls('workspacePrompts', undefined, 'Workspace prompts', lang));
		this._text(
			knoxNls('promptPath', undefined, 'Prompt path', lang),
			knoxReadPromptPath(config),
			value => this._update({ promptPath: value }),
			knoxNls('promptPathHint', undefined, 'Directory of workspace prompt files, relative to the workspace.', lang),
		);

		this._card(t('agentSettings'));
		const profile = knoxResolveAgentProfileSetting(config?.experimental?.agentProfile);
		this._selectRow(
			t('agentProfile'),
			KNOX_AGENT_PROFILE_SETTINGS.map(id => ({ value: id, label: agentProfileLabel(id, lang) })),
			profile,
			value => this._update(knoxSharedConfigForAgentProfile(value as KnoxAgentProfileSetting)),
			t('agentProfileHint'),
		);
		this._number(
			t('agentMaxSteps'),
			knoxReadAgentMaxSteps(config),
			0,
			1000,
			value => this._update({ agentMaxSteps: value }),
			t('agentMaxStepsHint'),
		);
		this._number(
			t('agentDoomLoopThreshold'),
			knoxReadDoomLoopThreshold(config),
			0,
			20,
			value => this._update({ agentDoomLoopThreshold: value }),
			t('agentDoomLoopThresholdHint'),
		);
		this._number(
			t('agentViewSubdirectoryMaxFiles'),
			knoxReadViewSubdirectoryMaxFiles(config),
			KNOX_MIN_VIEW_SUBDIRECTORY_MAX_FILES,
			KNOX_MAX_VIEW_SUBDIRECTORY_MAX_FILES,
			value => this._update({ agentViewSubdirectoryMaxFiles: value }),
			t('agentViewSubdirectoryMaxFilesHint'),
		);
		append(this.element, $('p.knox-muted')).textContent = t('agentPolicyHint');
	}

	private _update(shared: IKnoxSharedConfig): void {
		this._chatService.updateSharedConfig(shared);
	}

	private _card(title: string): HTMLElement {
		const card = append(this.element, $('.knox-checkpoint-card'));
		append(card, $('h3')).textContent = title;
		return card;
	}

	private _toggle(label: string, checked: boolean, onChange: () => void): void {
		const wrap = append(this.element.lastElementChild as HTMLElement, $('label.knox-config-row'));
		append(wrap, $('span')).textContent = label;
		const input = append(wrap, $<HTMLInputElement>('input'));
		input.type = 'checkbox';
		input.checked = checked;
		this._viewStore.add(addDisposableListener(input, 'change', onChange));
	}

	private _selectRow(
		label: string,
		options: { value: string; label: string }[],
		value: string,
		onChange: (value: string) => void,
		hint?: string,
	): void {
		const wrap = append(this.element.lastElementChild as HTMLElement, $('label.knox-config-row'));
		const text = append(wrap, $('div.knox-config-copy'));
		append(text, $('span')).textContent = label;
		if (hint) {
			append(text, $('span.knox-muted')).textContent = hint;
		}
		const select = append(wrap, $<HTMLSelectElement>('select.knox-memory-select'));
		for (const option of options) {
			const node = append(select, $<HTMLOptionElement>('option'));
			node.value = option.value;
			node.textContent = option.label;
		}
		select.value = value;
		this._viewStore.add(addDisposableListener(select, 'change', () => onChange(select.value)));
	}

	private _number(label: string, value: number, min: number, max: number, onChange: (value: number) => void, hint?: string): void {
		const wrap = append(this.element.lastElementChild as HTMLElement, $('label.knox-config-row'));
		const text = append(wrap, $('div.knox-config-copy'));
		append(text, $('span')).textContent = label;
		if (hint) {
			append(text, $('span.knox-muted')).textContent = hint;
		}
		const input = append(wrap, $<HTMLInputElement>('input'));
		input.type = 'number';
		input.min = String(min);
		input.max = String(max);
		input.value = String(value);
		this._viewStore.add(addDisposableListener(input, 'change', () => {
			const next = Number(input.value);
			if (!Number.isFinite(next)) {
				return;
			}
			onChange(next);
		}));
	}

	private _text(label: string, value: string, onChange: (value: string) => void, hint?: string): void {
		const wrap = append(this.element.lastElementChild as HTMLElement, $('label.knox-config-row'));
		const text = append(wrap, $('div.knox-config-copy'));
		append(text, $('span')).textContent = label;
		if (hint) {
			append(text, $('span.knox-muted')).textContent = hint;
		}
		const input = append(wrap, $<HTMLInputElement>('input'));
		input.type = 'text';
		input.value = value;
		this._viewStore.add(addDisposableListener(input, 'change', () => onChange(input.value.trim())));
	}
}

function agentProfileLabel(id: KnoxAgentProfileSetting, language: KnoxUiLanguage): string {
	switch (id) {
		case 'default': return knoxNls('agentProfileDefault', undefined, undefined, language);
		case 'rust': return knoxNls('agentProfileRust', undefined, undefined, language);
		case 'systems': return knoxNls('agentProfileSystems', undefined, undefined, language);
		case 'auto': return knoxNls('agentProfileAuto', undefined, undefined, language);
	}
}
