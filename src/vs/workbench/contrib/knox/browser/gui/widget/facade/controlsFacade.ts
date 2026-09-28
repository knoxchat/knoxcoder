/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { KnoxGuiChromeFacade } from './chromeFacade.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { KnoxGuiSvgIcon } from '../../knoxGuiIcons.js';
import * as knoxGuiControls from '../controls.js';

/** Small reusable controls: buttons, toggles, fields, hover (`widget/controls.ts`). */
export abstract class KnoxGuiControlsFacade extends KnoxGuiChromeFacade {
	back(this: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, title?: string, extraClass?: string): void {
		knoxGuiControls.back(this, body, state, title, extraClass);
	}

	section(this: KnoxGuiWidget, body: HTMLElement, title: string, text: string): void {
		knoxGuiControls.section(this, body, title, text);
	}

	toggle(this: KnoxGuiWidget, body: HTMLElement, label: string, value: boolean, onChange: (value: boolean) => void): void {
		knoxGuiControls.toggle(this, body, label, value, onChange);
	}

	customSwitch(this: KnoxGuiWidget, parent: HTMLElement, isOn: boolean, onToggle: () => void, size = 12): HTMLElement {
		return knoxGuiControls.customSwitch(this, parent, isOn, onToggle, size);
	}

	numberField(this: KnoxGuiWidget, body: HTMLElement, label: string, value: number, min: number, max: number, onChange: (value: number) => void, step?: number, suffix?: string): void {
		knoxGuiControls.numberField(this, body, label, value, min, max, onChange, step, suffix);
	}

	hintedNumber(this: KnoxGuiWidget, body: HTMLElement, label: string, hint: string, value: number, min: number, max: number, onChange: (value: number) => void): void {
		knoxGuiControls.hintedNumber(this, body, label, hint, value, min, max, onChange);
	}

	labeledInput(this: KnoxGuiWidget, body: HTMLElement, label: string, value: string, placeholder: string): HTMLInputElement {
		return knoxGuiControls.labeledInput(this, body, label, value, placeholder);
	}

	selectField(this: KnoxGuiWidget, parent: HTMLElement, values: string[], current: string, allLabel: string, onChange: (value: string) => void): HTMLSelectElement {
		return knoxGuiControls.selectField(this, parent, values, current, allLabel, onChange);
	}

	textAreaSetting(this: KnoxGuiWidget, body: HTMLElement, label: string, value: string, onChange: (value: string) => void): void {
		knoxGuiControls.textAreaSetting(this, body, label, value, onChange);
	}

	iconButton(this: KnoxGuiWidget, parent: HTMLElement, label: string, onClick: () => void, icon?: string): HTMLElement {
		return knoxGuiControls.iconButton(this, parent, label, onClick, icon);
	}

	chromeButton(this: KnoxGuiWidget, parent: HTMLElement, options: {
		label?: string;
		icon?: string;
		svg?: KnoxGuiSvgIcon;
		svgSize?: number;
		svgAfter?: boolean;
		title?: string;
		selected?: boolean;
		disabled?: boolean;
		expandLabel?: boolean;
		extraClass?: string;
		testId?: string;
		menuTrigger?: boolean;
		onClick: (button: HTMLElement, event?: MouseEvent) => void;
	}): HTMLButtonElement {
		return knoxGuiControls.chromeButton(this, parent, options);
	}

	collapseChevron(this: KnoxGuiWidget, parent: HTMLElement, options: {
		expanded: boolean;
		title: string;
		disabled?: boolean;
		testId?: string;
		onClick: () => void;
	}): HTMLElement {
		return knoxGuiControls.collapseChevron(this, parent, options);
	}

	appendSpinner(parent: HTMLElement, size = 16): HTMLElement {
		return knoxGuiControls.appendSpinner(parent, size);
	}

	hover(this: KnoxGuiWidget, target: HTMLElement, content: string): void {
		knoxGuiControls.hover(this, target, content);
	}
}
