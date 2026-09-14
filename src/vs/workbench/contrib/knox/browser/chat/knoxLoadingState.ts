/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { IntervalTimer } from '../../../../../base/common/async.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import {
	formatKnoxElapsed,
	KnoxLoadingVariant,
} from '../../common/knoxAgentActivity.js';

const CHEVRON = Array.from({ length: 9 }, (_, i) => {
	const r = Math.floor(i / 3);
	const c = i % 3;
	return (c + Math.abs(r - 1)) * 90;
});

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const ORBIT = Array.from({ length: 9 }, (_, i) => {
	const k = ORBIT_ORDER.indexOf(i);
	return k === -1 ? null : k * 110;
});

const PATTERNS: Record<KnoxLoadingVariant, { delays: (number | null)[]; dur: number; round: boolean }> = {
	drive: { delays: CHEVRON, dur: 650, round: false },
	dots: { delays: CHEVRON, dur: 650, round: true },
	orbit: { delays: ORBIT, dur: 950, round: false },
};

export interface IKnoxLoadingStateOptions {
	label?: string;
	variant?: KnoxLoadingVariant;
	startedAt?: number;
}

export function renderKnoxLoadingState(
	container: HTMLElement,
	options: IKnoxLoadingStateOptions,
	store: DisposableStore,
): HTMLElement {
	const label = options.label ?? localize('knox.activity.loading', "Working");
	const variant = options.variant ?? 'drive';
	const { delays, dur, round } = PATTERNS[variant] ?? PATTERNS.drive;
	const origin = options.startedAt ?? Date.now();

	clearNode(container);
	const root = append(container, $('span.knox-loading-state'));
	root.setAttribute('role', 'status');
	root.setAttribute('aria-live', 'polite');

	const grid = append(root, $('span.knox-loading-grid'));
	grid.setAttribute('aria-hidden', 'true');
	grid.style.setProperty('--knox-pixel-dur', `${dur}ms`);
	for (const delay of delays) {
		const pixel = append(grid, $('span.knox-loading-pixel'));
		if (round) {
			pixel.classList.add('round');
		}
		if (delay === null) {
			pixel.style.opacity = '0.07';
		} else {
			pixel.style.opacity = '0.16';
			pixel.style.animation = `knox-pixel-on var(--knox-pixel-dur) ease-in-out ${delay}ms infinite`;
		}
	}

	append(root, $('span.knox-loading-label')).textContent = label;
	const elapsedEl = append(root, $('span.knox-loading-elapsed'));

	const tick = () => {
		const elapsed = formatKnoxElapsed(Math.max(0, (Date.now() - origin) / 1000));
		elapsedEl.textContent = elapsed;
		root.setAttribute('aria-label', `${label} ${elapsed}`);
	};
	tick();

	const timer = store.add(new IntervalTimer());
	timer.cancelAndSet(tick, 100);
	return root;
}

export class KnoxLoadingState extends Disposable {
	readonly element: HTMLElement;

	constructor(parent: HTMLElement, options: IKnoxLoadingStateOptions = {}) {
		super();
		this.element = append(parent, $('span.knox-loading-host'));
		renderKnoxLoadingState(this.element, options, this._store);
	}
}
