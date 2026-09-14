/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { appendKnoxGuiIcon, KnoxGuiIconName, knoxGuiIconClass } from '../knoxGuiIcons.js';

/**
 * Collapsible cyan-bordered strip stacked above the chat input (git-diff,
 * compaction, task plan, memories, jobs).
 */
export class KnoxAttachedPanel extends Disposable {

	readonly element: HTMLElement;
	readonly toggle: HTMLButtonElement;
	readonly chevron: HTMLElement;
	readonly iconHost: HTMLElement;
	readonly title: HTMLElement;
	readonly meta: HTMLElement;
	readonly extra: HTMLElement;
	readonly progress: HTMLElement;
	readonly progressFill: HTMLElement;
	readonly body: HTMLElement;

	private _open: boolean;
	private _visible = false;

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	constructor(parent: HTMLElement, testId: string, initiallyOpen = false) {
		super();
		this._open = initiallyOpen;
		this.element = append(parent, $('.knox-attached-panel.hidden'));
		this.element.setAttribute('data-testid', testId);

		this.toggle = append(this.element, $<HTMLButtonElement>('button.knox-attached-toggle'));
		this.toggle.type = 'button';
		this.toggle.setAttribute('data-testid', `${testId}-toggle`);
		this.chevron = append(this.toggle, $('span.knox-attached-chevron'));
		this.iconHost = append(this.toggle, $('span.knox-attached-icon'));
		this.title = append(this.toggle, $('span.knox-attached-title'));
		this.meta = append(this.toggle, $('span.knox-attached-meta'));
		this.extra = append(this.toggle, $('span.knox-attached-extra'));

		this.progress = append(this.element, $('div.knox-progress.knox-attached-progress.hidden'));
		this.progress.setAttribute('role', 'progressbar');
		this.progressFill = append(this.progress, $('div.knox-progress-fill'));

		this.body = append(this.element, $('.knox-attached-body.hidden'));

		this._register(addDisposableListener(this.toggle, 'click', () => this.setOpen(!this._open)));
		this._syncOpen();
	}

	get open(): boolean {
		return this._open;
	}

	get visible(): boolean {
		return this._visible;
	}

	setVisible(visible: boolean): void {
		if (this._visible === visible) {
			return;
		}
		this._visible = visible;
		this.element.classList.toggle('hidden', !visible);
		this._onDidChangeHeight.fire();
	}

	setOpen(open: boolean): void {
		if (this._open === open) {
			return;
		}
		this._open = open;
		this._syncOpen();
		this._onDidChangeHeight.fire();
	}

	setProgress(percent: number | undefined): void {
		if (percent === undefined) {
			this.progress.classList.add('hidden');
			return;
		}
		this.progress.classList.remove('hidden');
		const clamped = Math.max(0, Math.min(100, percent));
		this.progressFill.style.width = `${clamped}%`;
		this.progress.setAttribute('aria-valuenow', String(Math.round(clamped)));
		this.progress.setAttribute('aria-valuemin', '0');
		this.progress.setAttribute('aria-valuemax', '100');
	}

	setIcon(icon: KnoxGuiIconName | undefined): void {
		clearNode(this.iconHost);
		if (!icon) {
			this.iconHost.classList.add('hidden');
			return;
		}
		this.iconHost.classList.remove('hidden');
		appendKnoxGuiIcon(this.iconHost, icon);
	}

	private _syncOpen(): void {
		this.toggle.setAttribute('aria-expanded', String(this._open));
		this.chevron.className = `knox-attached-chevron ${knoxGuiIconClass(this._open ? 'lucide-chevron-down' : 'lucide-chevron-right')}`;
		this.body.classList.toggle('hidden', !this._open);
	}
}
