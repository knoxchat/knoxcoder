/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Compact language switch for the Checkpoint Graph and Memory editors (`i18n.ts` LANGUAGE_TOGGLE_TEXT / toggleLanguage). */

import type { KnoxGuiWidget } from '../knoxGuiWidget.js';
import { t } from './t.js';
import { IKnoxGuiState, KnoxGuiLanguage } from '../../../common/knoxGuiState.js';

/** Shows the language a click switches to: "中" while English, "EN" while Chinese. */
export const KNOX_GUI_LANGUAGE_TOGGLE_TEXT: Record<KnoxGuiLanguage, string> = {
	en: '中',
	zh: 'EN',
};

export function knoxGuiNextLanguage(language: KnoxGuiLanguage): KnoxGuiLanguage {
	return language === 'zh' ? 'en' : 'zh';
}

export function renderLanguageToggle(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): HTMLButtonElement {
	const next = knoxGuiNextLanguage(state.language);
	const title = `${t(state, 'language')}: ${t(state, next === 'zh' ? 'chinese' : 'english')}`;
	return widget.chromeButton(parent, {
		svg: 'globe',
		svgSize: 14,
		label: KNOX_GUI_LANGUAGE_TOGGLE_TEXT[state.language],
		title,
		testId: 'knox-gui-language-toggle',
		extraClass: 'knox-gui-language-toggle',
		onClick: () => void widget.controller.setLanguage(next),
	});
}
