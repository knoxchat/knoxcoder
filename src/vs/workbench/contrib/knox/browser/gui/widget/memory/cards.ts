/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Section cards, stat/metric/trend cells and meters shared by the Overview and Graph pages. */

import { KnoxGuiSvgIcon } from '../../knoxGuiIcons.js';
import { MEMORY_TREND_COLORS } from '../../../../common/knoxGuiMemory.js';
import { mk, svg } from './kit.js';

/** `MemoryOverview.tsx` `SectionCard`: children go straight into the card after the `mb-2` title. */
export function sectionCard(parent: HTMLElement, title: string, icon: KnoxGuiSvgIcon): HTMLElement {
	const card = mk(parent, 'div', 'card');
	const heading = mk(card, 'h3', 'card-title mb-2');
	svg(heading, icon, 14);
	heading.append(title);
	return card;
}

export function statCard(parent: HTMLElement, icon: KnoxGuiSvgIcon, label: string, value: string | number): void {
	const cell = mk(parent, 'div', 'stat-card');
	svg(mk(cell, 'span', 'stat-icon'), icon, 20);
	mk(cell, 'span', 'lg fw-7 teal', typeof value === 'number' ? value.toLocaleString() : value);
	mk(cell, 'span', 'xs o-60', label);
}

export function metricCell(parent: HTMLElement, value: string, label: string): void {
	const el = mk(parent, 'div', '');
	mk(el, 'div', 'lg fw-7 teal', value);
	mk(el, 'div', 'o-60', label);
}

export function graphStat(parent: HTMLElement, value: string, label: string): void {
	const el = mk(parent, 'div', 'graph-stat');
	mk(el, 'div', 'lg fw-7 teal', value);
	mk(el, 'div', 'xs o-60', label);
}

export function trendCell(parent: HTMLElement, value: string | undefined, label: string, detail?: string): void {
	if (!value) {
		return;
	}
	const el = mk(parent, 'div', '');
	mk(el, 'div', 'lg fw-7 capitalize', value).style.color = MEMORY_TREND_COLORS[value] ?? '#6b7280';
	mk(el, 'div', 'o-60', label);
	if (detail) {
		mk(el, 'div', 'mt-0_5 o-50', detail);
	}
}

/** Meter caption row (`text-xs opacity-70`); returns the value span so callers can append an at-cap marker. */
export function meterHead(parent: HTMLElement, label: string, value: string): HTMLElement {
	const head = mk(parent, 'div', 'kv xs o-70');
	mk(head, 'span', '', label);
	return mk(head, 'span', '', value);
}

export function meterBar(parent: HTMLElement, pct: number, color: string): void {
	const track = mk(parent, 'div', 'meter');
	const fill = mk(track, 'div', 'meter-fill');
	fill.style.width = `${pct}%`;
	fill.style.backgroundColor = color;
}
