/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Analysis tab: risk/impact analysis and suggested groups. */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import type { KnoxGuiSvgIcon } from '../../knoxGuiIcons.js';
import { appendKnoxGuiSvg } from '../../knoxGuiIcons.js';
import { checkpointImpactChipClass, checkpointRiskChipClass, checkpointScopeChipClass } from '../../../../common/knoxGuiCheckpoints.js';
import { IKnoxGuiCheckpointAnalysis, IKnoxGuiCheckpointAnalysisGroup, IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { cpBadge, cpLoading, cpSelect } from './cpKit.js';
import { checkpointRiskIcon } from './primitives.js';

export function renderCheckpointAnalysis(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void { // KN-375
	body.setAttribute('data-testid', 'knox-gui-checkpoint-analysis');
	body.classList.add('knox-gui-cp-view');
	if (state.checkpointAnalysisCatalogLoading) {
		cpLoading(body, t(state, 'checkpointAnalysis.loading'));
		return;
	}
	const root = DOM.append(body, DOM.$('.knox-gui-cp-analysis'));
	const header = DOM.append(root, DOM.$('.knox-gui-checkpoint-analysis-header'));
	DOM.append(header, DOM.$('h2.knox-gui-cp-title', undefined, t(state, 'checkpointAnalysis.title')));
	DOM.append(header, DOM.$('p.knox-gui-cp-subtitle', undefined, t(state, 'checkpointAnalysis.subtitle')));
	const catalog = state.checkpointAnalysisCatalog.length
		? state.checkpointAnalysisCatalog
		: state.checkpoints.map(node => ({ id: node.id, description: node.description }));
	const selectedId = state.checkpointAnalysisId ?? catalog[0]?.id;
	if (!catalog.length) {
		DOM.append(root, DOM.$('p.knox-gui-cp-note', undefined, t(state, 'checkpointAnalysis.empty')));
	} else {
		const field = DOM.append(root, DOM.$('.knox-gui-checkpoint-analysis-field'));
		DOM.append(field, DOM.$('label', { for: 'checkpoint-analysis-select' }, t(state, 'checkpointAnalysis.selectCheckpoint')));
		const select = cpSelect(field, 'checkpoint-analysis-select');
		select.setAttribute('data-testid', 'checkpoint-analysis-select');
		for (const item of catalog) {
			const option = DOM.append(select, DOM.$('option')) as HTMLOptionElement;
			option.value = item.id;
			option.textContent = item.description || item.id.slice(0, 8);
			option.selected = item.id === selectedId;
		}
		widget.renderStore.add(DOM.addDisposableListener(select, 'change', () => {
			widget.checkpointAnalysisExpandedGroup = null;
			void widget.controller.loadCheckpointAnalysis(select.value);
		}));
	}
	const expandedKey = widget.checkpointAnalysisExpandedGroup;
	const analysis = state.checkpointAnalysis;
	if (!expandedKey) {
		if (!analysis) {
			if (selectedId) {
				const text = state.checkpointAnalysisPending ? t(state, 'checkpointAnalysis.loading') : t(state, 'checkpointAnalysis.unavailable');
				DOM.append(root, DOM.$('p.knox-gui-cp-note', { 'data-testid': 'checkpoint-analysis-unavailable' }, text));
			}
		} else {
			const card = DOM.append(root, DOM.$('.knox-gui-cp-card.knox-gui-analysis-card', { 'data-testid': 'knox-gui-checkpoint-analysis-card' }));
			renderAnalysisBody(card, state, analysis, true);
		}
	}
	renderAnalysisGroups(widget, root, state, catalog);
	maybeRevealAnalysisGroup(widget, expandedKey, state.checkpointAnalysisPending ? 'pending' : (analysis?.checkpointId ?? 'none'));
}

/** `GroupingSuggestionsList` in `CheckpointAnalysisPanel.tsx`. */
function renderAnalysisGroups(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState, catalog: Array<{ id: string }>): void {
	if (!state.checkpointAnalysisGroups.length) {
		return;
	}
	const groups = DOM.append(body, DOM.$('.knox-gui-analysis-groups'));
	DOM.append(groups, DOM.$('div.knox-gui-analysis-groups-head', undefined, t(state, 'checkpointAnalysis.suggestedGroups')));
	for (const group of state.checkpointAnalysisGroups) {
		const key = analysisGroupKey(group);
		const expanded = widget.checkpointAnalysisExpandedGroup === key;
		const card = DOM.append(groups, DOM.$(`.knox-gui-cp-card.knox-gui-analysis-group${expanded ? '.is-expanded' : ''}`));
		card.setAttribute('data-testid', 'knox-gui-checkpoint-analysis-group');
		card.setAttribute('data-group-key', key);
		const toggle = DOM.append(card, DOM.$('button.knox-gui-analysis-group-toggle')) as HTMLButtonElement;
		toggle.type = 'button';
		toggle.setAttribute('data-testid', 'knox-gui-checkpoint-analysis-group-toggle');
		toggle.setAttribute('aria-expanded', String(expanded));
		toggle.setAttribute('aria-label', `${group.groupName}, ${t(state, expanded ? 'collapse' : 'expand')}`);
		appendKnoxGuiSvg(toggle, expanded ? 'chevron-down' : 'chevron-right', 12).classList.add('knox-gui-analysis-group-chevron');
		const summary = DOM.append(toggle, DOM.$('.knox-gui-analysis-group-summary'));
		const top = DOM.append(summary, DOM.$('.knox-gui-analysis-group-top'));
		DOM.append(top, DOM.$('span.knox-gui-analysis-group-name', undefined, group.groupName));
		cpBadge(top, 'secondary', `${group.checkpointIds.length} ${t(state, 'checkpointAnalysis.checkpoints')}`, 'is-tiny');
		if (group.kind) {
			DOM.append(summary, DOM.$('div.knox-gui-cp-faint.knox-gui-analysis-group-kind', undefined, group.kind));
		}
		DOM.append(summary, DOM.$('p.knox-gui-cp-muted', undefined, group.rationale));
		DOM.append(summary, DOM.$('div.knox-gui-cp-faint.knox-gui-analysis-group-confidence', undefined, `${t(state, 'checkpointAnalysis.confidence')}: ${Math.round(group.confidence * 100)}%`));
		widget.renderStore.add(DOM.addDisposableListener(toggle, 'click', () => {
			if (widget.checkpointAnalysisExpandedGroup === key) {
				widget.checkpointAnalysisExpandedGroup = null;
				widget.render();
				revealAnalysisGroup(widget, key);
				return;
			}
			widget.checkpointAnalysisExpandedGroup = key;
			const nextId = analysisGroupCheckpointId(group, catalog);
			if (nextId && nextId !== state.checkpointAnalysisId) {
				void widget.controller.loadCheckpointAnalysis(nextId);
			} else {
				widget.render();
			}
		}));
		if (!expanded) {
			continue;
		}
		const detail = DOM.append(card, DOM.$('.knox-gui-analysis-group-detail', { 'data-testid': 'knox-gui-checkpoint-analysis-group-detail' }));
		const analysis = state.checkpointAnalysis;
		if (!analysis) {
			const text = state.checkpointAnalysisPending ? t(state, 'checkpointAnalysis.loading') : t(state, 'checkpointAnalysis.unavailable');
			DOM.append(detail, DOM.$('p.knox-gui-cp-note', { 'data-testid': 'checkpoint-analysis-unavailable' }, text));
			continue;
		}
		renderAnalysisBody(detail, state, analysis, false);
	}
}

function renderAnalysisBody(parent: HTMLElement, state: IKnoxGuiState, analysis: IKnoxGuiCheckpointAnalysis, includeGrouping: boolean): void {
	const summary = DOM.append(parent, DOM.$('.odp-callout.knox-gui-analysis-summary'));
	const summaryHead = DOM.append(summary, DOM.$('div.knox-gui-analysis-summary-head.odp-text-comment'));
	appendKnoxGuiSvg(summaryHead, 'file-text', 12);
	DOM.append(summaryHead, DOM.$('span', undefined, t(state, 'checkpointAnalysis.summary')));
	DOM.append(summary, DOM.$('p', undefined, analysis.generatedDescription || t(state, 'checkpointAnalysis.unavailable')));
	if (analysis.counts) {
		const counts = DOM.append(parent, DOM.$('.knox-gui-analysis-counts'));
		DOM.append(counts, DOM.$('span', undefined, `${t(state, 'checkpointAnalysis.changed')}: ${analysis.counts.changed}`));
		if (analysis.counts.tests != null) {
			DOM.append(counts, DOM.$('span', undefined, `${t(state, 'checkpointAnalysis.tests')}: ${analysis.counts.tests}`));
		}
		if (analysis.counts.config != null) {
			DOM.append(counts, DOM.$('span', undefined, `${t(state, 'checkpointAnalysis.config')}: ${analysis.counts.config}`));
		}
		if (analysis.counts.lockfile != null) {
			DOM.append(counts, DOM.$('span', undefined, `${t(state, 'checkpointAnalysis.lockfiles')}: ${analysis.counts.lockfile}`));
		}
		if (analysis.impactAnalysis.linesAdded != null) {
			DOM.append(counts, DOM.$('span', undefined, `+${analysis.impactAnalysis.linesAdded} / -${analysis.impactAnalysis.linesDeleted ?? 0} ${t(state, 'checkpointAnalysis.lines')}`));
		}
		if (analysis.impactAnalysis.uniqueDirectories != null) {
			DOM.append(counts, DOM.$('span', undefined, `${t(state, 'checkpointAnalysis.directories')}: ${analysis.impactAnalysis.uniqueDirectories}`));
		}
	}
	const risks = DOM.append(parent, DOM.$('.knox-gui-analysis-risks'));
	const chips = DOM.append(risks, DOM.$('.knox-gui-analysis-chips.is-badges'));
	const risk = analysisChip(chips, checkpointRiskChipClass(analysis.riskAssessment.level), t(state, `checkpointAnalysis.risk.${analysis.riskAssessment.level}`), checkpointRiskIcon(analysis.riskAssessment.level));
	risk.setAttribute('data-testid', 'checkpoint-risk-badge');
	DOM.append(risk, DOM.$('span.knox-gui-analysis-score', undefined, `(${analysis.riskAssessment.score.toFixed(1)})`));
	analysisChip(chips, checkpointScopeChipClass(analysis.impactAnalysis.scope), t(state, `checkpointAnalysis.scope.${analysis.impactAnalysis.scope}`), 'target');
	if (analysis.riskAssessment.factors.length) {
		const factors = DOM.append(risks, DOM.$('.knox-gui-analysis-factors'));
		for (const factor of analysis.riskAssessment.factors) {
			const row = DOM.append(factors, DOM.$('.knox-gui-analysis-factor'));
			appendKnoxGuiSvg(row, 'alert-triangle', 12).classList.add('odp-text-yellow');
			const text = DOM.append(row, DOM.$('div'));
			DOM.append(text, DOM.$('span.knox-gui-analysis-factor-category', undefined, factor.category));
			DOM.append(text, DOM.$('span.knox-gui-cp-muted', undefined, ` — ${factor.description}`));
			if (factor.affectedFiles.length) {
				DOM.append(text, DOM.$('span.knox-gui-cp-faint', undefined, ` (${factor.affectedFiles.length} ${t(state, 'checkpointAnalysis.files')})`));
			}
		}
	}
	if (analysis.riskAssessment.recommendations.length) {
		const recs = DOM.append(risks, DOM.$('.odp-callout-blue.knox-gui-analysis-recs', { role: 'alert' }));
		appendKnoxGuiSvg(recs, 'info', 14);
		DOM.append(recs, DOM.$('h5', undefined, t(state, 'checkpointAnalysis.recommendations')));
		const list = DOM.append(DOM.append(recs, DOM.$('div.knox-gui-analysis-recs-body')), DOM.$('ul'));
		for (const rec of analysis.riskAssessment.recommendations) {
			DOM.append(list, DOM.$('li', undefined, rec));
		}
	}
	if (analysis.impactAnalysis.affectedFeatures.length) {
		const areas = DOM.append(parent, DOM.$('.knox-gui-analysis-areas'));
		const areaHead = DOM.append(areas, DOM.$('div.knox-gui-analysis-areas-head'));
		appendKnoxGuiSvg(areaHead, 'layers', 12);
		DOM.append(areaHead, DOM.$('span', undefined, t(state, 'checkpointAnalysis.affectedAreas')));
		const wrap = DOM.append(areas, DOM.$('.knox-gui-analysis-chips'));
		for (const feature of analysis.impactAnalysis.affectedFeatures) {
			analysisChip(wrap, checkpointImpactChipClass(feature.impactLevel), `${feature.name} (${feature.changedFiles.length})`);
		}
	}
	if (analysis.impactAnalysis.affectedLayers.length) {
		const wrap = DOM.append(parent, DOM.$('.knox-gui-analysis-chips'));
		for (const layer of analysis.impactAnalysis.affectedLayers) {
			analysisChip(wrap, 'odp-chip-muted', layer);
		}
	}
	if (includeGrouping && analysis.groupingSuggestion) {
		const suggestion = analysis.groupingSuggestion;
		const group = DOM.append(parent, DOM.$('.odp-callout-purple.knox-gui-analysis-grouping'));
		const name = DOM.append(group, DOM.$('div.knox-gui-analysis-grouping-name', undefined, `${t(state, 'checkpointAnalysis.group')}: ${suggestion.groupName}`));
		if (suggestion.kind) {
			DOM.append(name, DOM.$('span.knox-gui-analysis-grouping-kind', undefined, `(${suggestion.kind})`));
		}
		DOM.append(group, DOM.$('div.knox-gui-cp-muted', undefined, suggestion.rationale));
		DOM.append(group, DOM.$('div.knox-gui-cp-faint', undefined, `${t(state, 'checkpointAnalysis.confidence')}: ${Math.round(suggestion.confidence * 100)}% · ${suggestion.checkpointIds.length} ${t(state, 'checkpointAnalysis.checkpoints')}`));
	}
}

function analysisGroupKey(group: IKnoxGuiCheckpointAnalysisGroup): string {
	return `${group.kind ?? ''}::${group.groupName}::${group.checkpointIds[0] ?? ''}`;
}

function maybeRevealAnalysisGroup(widget: KnoxGuiWidget, key: string | null, token: string): void {
	const revealKey = key ? `${key}:${token}` : undefined;
	if (revealKey === widget.checkpointAnalysisRevealKey) {
		return;
	}
	widget.checkpointAnalysisRevealKey = revealKey;
	revealAnalysisGroup(widget, key);
}

function revealAnalysisGroup(widget: KnoxGuiWidget, key: string | null): void {
	if (!key) {
		return;
	}
	queueMicrotask(() => {
		const el = [...widget.root.querySelectorAll<HTMLElement>('[data-group-key]')].find(node => node.getAttribute('data-group-key') === key);
		el?.scrollIntoView?.({ block: 'nearest' });
	});
}

function analysisGroupCheckpointId(group: IKnoxGuiCheckpointAnalysisGroup, catalog: Array<{ id: string }>): string | undefined {
	return group.checkpointIds.find(id => catalog.some(item => item.id === id)) ?? group.checkpointIds[0];
}

function analysisChip(parent: HTMLElement, chipClass: string, label: string, icon?: KnoxGuiSvgIcon): HTMLElement {
	const chip = DOM.append(parent, DOM.$(`span.odp-chip.${chipClass}`, undefined, ''));
	if (icon) {
		appendKnoxGuiSvg(chip, icon, 12);
	}
	chip.append(label);
	return chip;
}
