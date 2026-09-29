/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Dashboard tab: stat cards and bar charts with tooltips. */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import type { KnoxGuiSvgIcon } from '../../knoxGuiIcons.js';
import { appendKnoxGuiSvg } from '../../knoxGuiIcons.js';
import {
	checkpointChartTickInterval,
	checkpointChartYTicks,
	compactAxisNumber,
	fillDailyCarryForward,
	fillDailyCounts,
	formatCheckpointDuration,
	formatDashboardBytes,
} from '../../../../common/knoxGuiCheckpoints.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { cpBadge, cpLoading, cpTabs } from './cpKit.js';

const CHECKPOINT_CREATION_FILL = { dark: '#c4b5fd', light: '#7c3aed' } as const;

const CHECKPOINT_STORAGE_FILL = { dark: '#38bdf8', light: '#0284c7' } as const;

export function renderCheckpointDashboard(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void { // KN-375
	const data = state.checkpointDashboard;
	body.classList.add('knox-gui-cp-view');
	if (state.checkpointDashboardLoading) {
		const loading = DOM.append(body, DOM.$('.knox-gui-cp-dash-loading', { 'data-testid': 'checkpoint-dashboard-loading' }));
		DOM.append(loading, DOM.$('.knox-gui-cp-skeleton.is-title'));
		DOM.append(loading, DOM.$('.knox-gui-cp-skeleton.is-bar'));
		cpLoading(loading, t(state, 'checkpointDashboard.loading'));
		return;
	}
	if (!data) {
		DOM.append(body, DOM.$('p.knox-gui-cp-muted.knox-gui-checkpoint-dash-nodata', { 'data-testid': 'checkpoint-dashboard-nodata' }, t(state, 'checkpointDashboard.noData')));
		return;
	}
	body.classList.add('is-fill');
	body.setAttribute('data-testid', 'knox-gui-checkpoint-dashboard');
	const root = DOM.append(body, DOM.$('.knox-gui-cp-fill-root'));
	const title = DOM.append(root, DOM.$('h2.knox-gui-cp-title'));
	appendKnoxGuiSvg(title, 'bar-chart-3', 16);
	DOM.append(title, DOM.$('span', undefined, t(state, 'checkpointDashboard.title')));
	const tabbed = DOM.append(root, DOM.$('.knox-gui-cp-tabbed'));
	cpTabs(widget, tabbed, 'knox-gui-dash-tabs', (['overview', 'storage', 'activity', 'ai'] as const).map(tab => ({
		id: tab,
		label: t(state, `checkpointDashboard.${tab}`),
		selected: state.checkpointDashboardTab === tab,
		testId: `checkpoint-dashboard-tab-${tab}`,
		onClick: () => widget.controller.store.patch({ checkpointDashboardTab: tab }),
	})));
	const content = DOM.append(tabbed, DOM.$('.knox-gui-cp-tab-content', { role: 'tabpanel' }));
	const theme = widget.isLightTheme() ? 'light' : 'dark';
	const summary = data.summary;
	const storage = data.currentStorage ?? { totalBytes: 0, checkpointCount: 0 };
	const heading = (parent: HTMLElement, icon: KnoxGuiSvgIcon, key: string, strong: boolean) => {
		const h3 = DOM.append(parent, DOM.$(`h3.knox-gui-cp-heading${strong ? '.is-strong' : ''}`));
		appendKnoxGuiSvg(h3, icon, 16);
		DOM.append(h3, DOM.$('span', undefined, t(state, key)));
		return h3;
	};
	const daysChip = (parent: HTMLElement, count: number) => DOM.append(parent, DOM.$('span.odp-chip.knox-gui-cp-days', undefined, t(state, 'checkpointDashboard.lastDays', { count })));
	const emptyCard = (parent: HTMLElement, key: string) => DOM.append(parent, DOM.$('.knox-gui-cp-card.knox-gui-dash-empty', undefined, t(state, key)));
	if (state.checkpointDashboardTab === 'overview') {
		const cards = DOM.append(content, DOM.$('.knox-gui-dash-cards'));
		dashCard(widget, cards, t(state, 'checkpointDashboard.totalCheckpoints'), String(summary.totalCheckpointsCreated), 'database');
		dashCard(widget, cards, t(state, 'checkpointDashboard.restorationRate'), `${summary.restorationSuccessRate.toFixed(0)}%`, 'activity');
		dashCard(widget, cards, t(state, 'checkpointDashboard.avgCreateTime'), formatCheckpointDuration(summary.avgCreationTimeMs), 'clock');
		dashCard(widget, cards, t(state, 'checkpointDashboard.storageUsed'), formatDashboardBytes(storage.totalBytes), 'hard-drive');
		const rows = fillDailyCounts(data.creationFrequency);
		const section = DOM.append(content, DOM.$('.knox-gui-cp-section'));
		const head = DOM.append(section, DOM.$('.knox-gui-dash-heading'));
		heading(head, 'bar-chart-3', 'checkpointDashboard.creationFrequency', false);
		daysChip(head, rows.length);
		if (!data.creationFrequency.length) {
			emptyCard(section, 'checkpointDashboard.noData');
		} else {
			const card = DOM.append(section, DOM.$('.knox-gui-cp-card.knox-gui-chart-card'));
			renderBarChart(widget, card, t(state, 'checkpointDashboard.creationFrequency'), rows.map(row => ({ label: row.date, value: row.count })), compactAxisNumber, CHECKPOINT_CREATION_FILL[theme], 'Checkpoints', 32, true);
			DOM.append(card, DOM.$('p.knox-gui-cp-muted.knox-gui-chart-footer', undefined, t(state, 'checkpointDashboard.createdInRange', { count: rows.reduce((sum, row) => sum + row.count, 0) })));
		}
	} else if (state.checkpointDashboardTab === 'storage') {
		const section = DOM.append(content, DOM.$('.knox-gui-cp-section'));
		heading(DOM.append(section, DOM.$('.knox-gui-dash-heading')), 'hard-drive', 'checkpointDashboard.storageUsage', false);
		const cards = DOM.append(section, DOM.$('.knox-gui-dash-cards'));
		dashCard(widget, cards, t(state, 'checkpointDashboard.totalStorage'), formatDashboardBytes(storage.totalBytes), 'database');
		dashCard(widget, cards, t(state, 'checkpointDashboard.checkpoints'), String(storage.checkpointCount), 'hard-drive', `${storage.blobCount ?? 0} blobs`);
		if (data.storageHistory.length) {
			const rows = fillDailyCarryForward(data.storageHistory.map(row => ({ bucket: row.timestamp, value: row.totalBytes })));
			const card = DOM.append(section, DOM.$('.knox-gui-cp-card.knox-gui-chart-card.is-storage'));
			const head = DOM.append(card, DOM.$('.knox-gui-chart-head'));
			DOM.append(head, DOM.$('p', undefined, t(state, 'checkpointDashboard.storageTrend')));
			daysChip(head, rows.length);
			renderBarChart(widget, card, t(state, 'checkpointDashboard.storageTrend'), rows.map(row => ({ label: row.date, value: row.value })), formatDashboardBytes, CHECKPOINT_STORAGE_FILL[theme], 'Storage', 44, false);
		}
	} else if (state.checkpointDashboardTab === 'activity') {
		content.classList.add('is-fill');
		heading(content, 'activity', 'checkpointDashboard.restorations', true);
		const meta = DOM.append(content, DOM.$('.knox-gui-cp-dash-meta'));
		const rate = summary.restorationSuccessRate;
		const variant = rate >= 90 ? 'default' : rate >= 70 ? 'secondary' : 'destructive';
		cpBadge(meta, variant, `${rate.toFixed(0)}% ${t(state, 'checkpointDashboard.successRate')}`, rate >= 90 ? 'is-green' : rate >= 70 ? 'is-yellow' : 'is-red').setAttribute('data-testid', 'checkpoint-dashboard-rate');
		DOM.append(meta, DOM.$('span.knox-gui-cp-muted', undefined, `${data.restorationEvents.length} ${t(state, 'checkpointDashboard.totalEvents')}`));
		if (!data.restorationEvents.length) {
			emptyCard(content, 'checkpointDashboard.noRestorations');
		} else {
			const list = DOM.append(content, DOM.$('.knox-gui-dash-list'));
			for (const event of data.restorationEvents) {
				const row = DOM.append(list, DOM.$('.knox-gui-cp-card.knox-gui-dash-row', { 'data-testid': 'checkpoint-dashboard-restoration' }));
				appendKnoxGuiSvg(row, event.success ? 'circle-check-big' : 'circle-x', 16).classList.add(event.success ? 'odp-text-green' : 'odp-text-red');
				DOM.append(row, DOM.$('span.knox-gui-cp-mono.knox-gui-dash-grow', undefined, `${event.checkpointId.slice(0, 8)}...`));
				DOM.append(row, DOM.$('span.knox-gui-cp-muted', undefined, `${event.filesRestored} ${t(state, 'checkpointDashboard.files')}`));
				DOM.append(row, DOM.$('span.knox-gui-cp-muted', undefined, formatCheckpointDuration(event.durationMs)));
			}
		}
	} else {
		const section = DOM.append(content, DOM.$('.knox-gui-cp-section'));
		heading(section, 'bot', 'checkpointDashboard.aiSessions', true);
		const cards = DOM.append(section, DOM.$('.knox-gui-dash-cards.is-three'));
		dashCard(widget, cards, t(state, 'checkpointDashboard.totalSessions'), String(summary.totalAiSessions), 'bot');
		dashCard(widget, cards, t(state, 'checkpointDashboard.avgChanges'), summary.avgChangesPerSession.toFixed(1), 'trending-up');
		dashCard(widget, cards, t(state, 'checkpointDashboard.totalRollbacks'), String(summary.totalRollbacks), 'activity');
		const list = data.aiSessionMetrics.length ? DOM.append(section, DOM.$('.knox-gui-dash-list.is-capped')) : section;
		for (const session of data.aiSessionMetrics.slice(0, 5)) {
			const card = DOM.append(list, DOM.$('.knox-gui-cp-card.knox-gui-dash-session', { 'data-testid': 'checkpoint-dashboard-session' }));
			const top = DOM.append(card, DOM.$('.knox-gui-dash-session-top'));
			DOM.append(top, DOM.$('span.knox-gui-cp-mono', undefined, `${session.sessionId.slice(0, 8)}...`));
			DOM.append(top, DOM.$('span.knox-gui-cp-muted', undefined, formatCheckpointDuration(session.durationSeconds * 1000)));
			const stats = DOM.append(card, DOM.$('.knox-gui-dash-session-stats'));
			DOM.append(stats, DOM.$('span', undefined, `${session.filesChanged} ${t(state, 'checkpointDashboard.files')}`));
			if (typeof session.linesAdded === 'number') {
				DOM.append(stats, DOM.$('span.is-green', undefined, `+${session.linesAdded}`));
			}
			if (typeof session.linesDeleted === 'number') {
				DOM.append(stats, DOM.$('span.is-red', undefined, `-${session.linesDeleted}`));
			}
			DOM.append(stats, DOM.$('span', undefined, `${session.checkpointsCreated} ${t(state, 'checkpointDashboard.checkpoints')}`));
			if ((session.rollbacks ?? 0) > 0) {
				DOM.append(stats, DOM.$('span.is-orange', undefined, `${session.rollbacks} ${t(state, 'checkpointDashboard.rollbacks')}`));
			}
		}
	}
}

interface ICheckpointChartGeometry {
	left: number;
	right: number;
	top: number;
	bottom: number;
	band: number;
}

/**
 * Recharts `BarChart` geometry from `PerformanceDashboard.tsx`: margin `{ left: 4, right: 8, top: 10, bottom: 4 }`,
 * YAxis `width` / `tickMargin={4}` (tick size 6), XAxis `height={48}` / `tickMargin={10}` / `angle={-35}`,
 * `barCategoryGap="28%"`, `maxBarSize={18}`, drawn at the real pixel width.
 */
function renderBarChart(widget: KnoxGuiWidget, card: HTMLElement, title: string, points: Array<{ label: string; value: number }>, format: (value: number) => string, fill: string, seriesLabel: string, yAxisWidth: number, creation: boolean): void {
	const ns = 'http://www.w3.org/2000/svg';
	const height = 228;
	const ticks = checkpointChartYTicks(Math.max(0, ...points.map(point => point.value)));
	const max = ticks[ticks.length - 1] || 1;
	const interval = checkpointChartTickInterval(points.length);
	const wrap = DOM.append(card, DOM.$('.knox-gui-cp-chart'));
	const svg = document.createElementNS(ns, 'svg');
	svg.setAttribute('class', 'knox-gui-chart');
	svg.setAttribute('role', 'img');
	svg.setAttribute('aria-label', title);
	svg.setAttribute('height', String(height));
	wrap.appendChild(svg);
	const el = <K extends keyof SVGElementTagNameMap>(parent: SVGElement, tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] => {
		const node = document.createElementNS(ns, tag);
		for (const [key, value] of Object.entries(attrs)) {
			node.setAttribute(key, String(value));
		}
		parent.appendChild(node);
		return node;
	};
	let geometry: ICheckpointChartGeometry = { left: 0, right: 0, top: 0, bottom: 0, band: 0 };
	let cursor: SVGRectElement | undefined;
	const draw = (width: number) => {
		svg.replaceChildren();
		svg.setAttribute('width', String(width));
		svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
		const left = 4 + yAxisWidth;
		const right = Math.max(left + 1, width - 8);
		const top = 10;
		const bottom = height - 4 - 48;
		const plotH = bottom - top;
		const band = (right - left) / Math.max(1, points.length);
		geometry = { left, right, top, bottom, band };
		const grid = el(svg, 'g', { class: 'knox-gui-chart-grid-layer' });
		for (const tick of ticks) {
			const y = bottom - (tick / max) * plotH;
			el(grid, 'line', { class: 'knox-gui-chart-grid', x1: left, x2: right, y1: y, y2: y });
			el(svg, 'text', { class: 'knox-gui-chart-tick', x: left - 10, y, dy: '0.355em', 'text-anchor': 'end' }).textContent = format(tick);
		}
		cursor = el(svg, 'rect', { class: 'knox-gui-chart-cursor', x: left, y: top, width: band, height: plotH, visibility: 'hidden' });
		const barW = Math.min(18, band * 0.44);
		points.forEach((point, index) => {
			const h = (point.value / max) * plotH;
			if (h > 0) {
				el(svg, 'rect', { x: left + index * band + (band - barW) / 2, y: bottom - h, width: barW, height: h, fill });
			}
			if (index % (interval + 1) === 0) {
				const cx = left + index * band + band / 2;
				const cy = bottom + 16;
				el(svg, 'text', { class: 'knox-gui-chart-tick', x: cx, y: cy, dy: '0.71em', 'text-anchor': 'end', transform: `rotate(-35 ${cx} ${cy})` }).textContent = point.label;
			}
		});
	};
	draw(wrap.clientWidth || 320);
	if (typeof ResizeObserver !== 'undefined') {
		const observer = new ResizeObserver(() => {
			if (wrap.clientWidth > 0) {
				draw(wrap.clientWidth);
			}
		});
		observer.observe(wrap);
		widget.renderStore.add({ dispose: () => observer.disconnect() });
	}
	attachChartTooltip(widget, wrap, svg, {
		geometry: () => geometry,
		cursor: () => cursor,
		count: points.length,
		item: index => {
			const value = points[index].value;
			return { label: points[index].label, name: seriesLabel, value: creation ? (value ? value.toLocaleString() : undefined) : format(value), dot: creation ? fill : undefined };
		},
	});
}

/** shadcn `ChartTooltipContent` (`indicator="dot"`) placed like the Recharts tooltip: 10px right / below the active band, flipped inside the plot. */
function attachChartTooltip(widget: KnoxGuiWidget, wrap: HTMLElement, svg: SVGSVGElement, chart: { geometry: () => ICheckpointChartGeometry; cursor: () => SVGRectElement | undefined; count: number; item: (index: number) => { label: string; name: string; value?: string; dot?: string } }): void {
	const tip = DOM.append(wrap, DOM.$('.knox-gui-chart-tooltip'));
	tip.hidden = true;
	tip.setAttribute('data-testid', 'knox-gui-chart-tooltip');
	let active = -1;
	const hide = () => {
		active = -1;
		tip.hidden = true;
		tip.classList.remove('is-moving');
		chart.cursor()?.setAttribute('visibility', 'hidden');
	};
	const move = (event: PointerEvent) => {
		const g = chart.geometry();
		const bounds = svg.getBoundingClientRect();
		const x = event.clientX - bounds.left;
		const y = event.clientY - bounds.top;
		if (x < g.left || x > g.right || y < g.top || y > g.bottom || !chart.count) {
			hide();
			return;
		}
		const index = Math.min(chart.count - 1, Math.floor((x - g.left) / g.band));
		if (index !== active) {
			active = index;
			const item = chart.item(index);
			tip.replaceChildren();
			DOM.append(tip, DOM.$('div.knox-gui-chart-tooltip-label', undefined, item.label));
			const row = DOM.append(tip, DOM.$('div.knox-gui-chart-tooltip-row'));
			if (item.dot) {
				DOM.append(row, DOM.$('span.knox-gui-chart-tooltip-dot')).style.background = item.dot;
			}
			const line = DOM.append(row, DOM.$(`div.knox-gui-chart-tooltip-body${item.dot ? '' : '.is-plain'}`));
			DOM.append(line, DOM.$('span.knox-gui-cp-muted', undefined, item.name));
			if (item.value !== undefined) {
				DOM.append(line, DOM.$('span.knox-gui-chart-tooltip-value', undefined, item.value));
			}
			const cursor = chart.cursor();
			cursor?.setAttribute('x', String(g.left + index * g.band));
			cursor?.setAttribute('visibility', 'visible');
		}
		const wasHidden = tip.hidden;
		tip.hidden = false;
		const cx = g.left + index * g.band + g.band / 2;
		const tipX = cx + 10 + tip.offsetWidth > g.right ? Math.max(cx - tip.offsetWidth - 10, g.left) : Math.max(cx + 10, g.left);
		const tipY = y + 10 + tip.offsetHeight > g.bottom ? Math.max(y - tip.offsetHeight - 10, g.top) : Math.max(y + 10, g.top);
		tip.classList.toggle('is-moving', !wasHidden);
		tip.style.transform = `translate(${tipX}px, ${tipY}px)`;
	};
	widget.renderStore.add(DOM.addDisposableListener(svg, 'pointermove', e => move(e as PointerEvent)));
	widget.renderStore.add(DOM.addDisposableListener(svg, 'pointerleave', hide));
}

/** `StatCard` in `PerformanceDashboard.tsx`. */
export function dashCard(widget: KnoxGuiWidget, parent: HTMLElement, label: string, value: string, icon?: KnoxGuiSvgIcon, subtitle?: string): void {
	const card = DOM.append(parent, DOM.$('.knox-gui-cp-card.knox-gui-dash-card'));
	if (icon) {
		appendKnoxGuiSvg(DOM.append(card, DOM.$('.knox-gui-dash-card-icon')), icon, 16);
	}
	const text = DOM.append(card, DOM.$('.knox-gui-dash-card-text'));
	DOM.append(text, DOM.$('p.knox-gui-dash-card-label', { title: label }, label));
	DOM.append(text, DOM.$('p.knox-gui-dash-card-value', undefined, value));
	if (subtitle) {
		DOM.append(text, DOM.$('p.knox-gui-dash-card-sub', undefined, subtitle));
	}
}
