/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Share tab: bundle export/import and the audit log. */

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { appendKnoxGuiSvg } from '../../knoxGuiIcons.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { cpBadge, cpButton, cpEmptyCard, cpLoading, cpTabs } from './cpKit.js';

/** `CollaborativePanel.tsx` action colors and outcome badges. */
export function checkpointAuditActionClass(action: string): string {
	if (action.includes('create') || action.includes('share')) {
		return 'is-green';
	}
	if (action.includes('delete') || action.includes('remove')) {
		return 'is-red';
	}
	if (action.includes('restore') || action.includes('rollback')) {
		return 'is-orange';
	}
	return 'is-blue';
}

export function checkpointAuditOutcome(outcome: string): 'OK' | 'FAIL' | 'PARTIAL' {
	if (outcome === 'success' || outcome.includes('Success')) {
		return 'OK';
	}
	if (outcome === 'failure' || outcome.includes('Failure')) {
		return 'FAIL';
	}
	return 'PARTIAL';
}

export function renderCheckpointShare(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	body.classList.add('knox-gui-cp-view');
	if (state.checkpointShareLoading) {
		cpLoading(body, t(state, 'checkpointShare.loading'), 'checkpoint-share-loading');
		return;
	}
	body.classList.add('is-fill');
	const root = DOM.append(body, DOM.$('.knox-gui-cp-fill-root'));
	const header = DOM.append(root, DOM.$('.knox-gui-checkpoint-analysis-header'));
	const title = DOM.append(header, DOM.$('h2.knox-gui-cp-title'));
	appendKnoxGuiSvg(title, 'share-2', 16);
	DOM.append(title, DOM.$('span', undefined, t(state, 'checkpointShare.title')));
	DOM.append(header, DOM.$('p.knox-gui-cp-subtitle', undefined, t(state, 'checkpointShare.subtitle')));
	const tabbed = DOM.append(root, DOM.$('.knox-gui-cp-tabbed'));
	const counts = [state.checkpointShareBundles.length, state.checkpointShareAudit.length];
	cpTabs(widget, tabbed, 'knox-gui-checkpoint-share-tabs', [
		{ id: 'shared', svg: 'share-2', label: t(state, 'checkpointShare.shared'), selected: state.checkpointShareTab !== 'audit', testId: 'checkpoint-share-tab-shared', onClick: () => widget.controller.store.patch({ checkpointShareTab: 'shared' }) },
		{ id: 'audit', svg: 'shield', label: t(state, 'checkpointShare.audit'), selected: state.checkpointShareTab === 'audit', testId: 'checkpoint-share-tab-audit', onClick: () => widget.controller.store.patch({ checkpointShareTab: 'audit' }) },
	]).forEach((button, index) => {
		if (counts[index] > 0) {
			cpBadge(button, 'secondary', String(counts[index]), 'knox-gui-checkpoint-share-count');
		}
	});
	const content = DOM.append(tabbed, DOM.$('.knox-gui-cp-tab-content', { role: 'tabpanel' }));
	if (state.checkpointShareTab === 'audit') {
		content.classList.add('is-fill');
		renderCheckpointShareAudit(widget, content, state);
		return;
	}
	const section = DOM.append(content, DOM.$('.knox-gui-cp-section'));
	const head = DOM.append(section, DOM.$('.knox-gui-checkpoint-share-head'));
	const h3 = DOM.append(head, DOM.$('h3.knox-gui-cp-heading.is-strong'));
	appendKnoxGuiSvg(h3, 'share-2', 16);
	DOM.append(h3, DOM.$('span', undefined, t(state, 'checkpointShare.sharedBundles')));
	cpButton(widget, head, { variant: 'default', small: true, label: t(state, 'checkpointShare.shareNew'), testId: 'checkpoint-share-new', onClick: () => void widget.controller.shareCheckpoints() });
	if (!state.checkpointShareBundles.length) {
		cpEmptyCard(section, 'share-2', t(state, 'checkpointShare.noBundles'), t(state, 'checkpointShare.shareHint'), 'checkpoint-share-empty');
		return;
	}
	const bundles = DOM.append(section, DOM.$('.knox-gui-checkpoint-bundles'));
	for (const bundle of state.checkpointShareBundles) {
		const card = DOM.append(bundles, DOM.$('.knox-gui-cp-card.knox-gui-checkpoint-bundle', { 'data-testid': 'checkpoint-share-bundle' }));
		const top = DOM.append(card, DOM.$('.knox-gui-checkpoint-bundle-top'));
		const info = DOM.append(top, DOM.$('.knox-gui-checkpoint-bundle-info'));
		DOM.append(info, DOM.$('p.knox-gui-checkpoint-bundle-title', undefined, bundle.description || t(state, 'checkpointShare.untitled')));
		const meta = DOM.append(info, DOM.$('.knox-gui-checkpoint-bundle-meta'));
		const machine = DOM.append(meta, DOM.$('span'));
		appendKnoxGuiSvg(machine, 'monitor', 12);
		DOM.append(machine, DOM.$('span', undefined, `${t(state, 'checkpointShare.thisMachine')}${bundle.machineId && bundle.machineId !== 'unknown' ? ` · ${bundle.machineId.slice(0, 8)}` : ''}`));
		const when = DOM.append(meta, DOM.$('span'));
		appendKnoxGuiSvg(when, 'clock', 12);
		DOM.append(when, DOM.$('span', undefined, bundle.sharedAt ? new Date(bundle.sharedAt).toLocaleDateString() : ''));
		if (bundle.filePath) {
			const path = DOM.append(info, DOM.$('.knox-gui-checkpoint-bundle-path'));
			path.title = bundle.filePath;
			appendKnoxGuiSvg(path, 'file-text', 12);
			DOM.append(path, DOM.$('span.knox-gui-ellipsis', undefined, bundle.filePath));
		}
		const badges = DOM.append(top, DOM.$('.knox-gui-checkpoint-bundle-badges'));
		cpBadge(badges, 'secondary', `${bundle.checkpointCount} ${t(state, 'checkpointShare.checkpointsLabel')}`);
		if (!bundle.exists) {
			cpBadge(badges, 'destructive', t(state, 'checkpointShare.missingFile')).setAttribute('data-testid', 'checkpoint-share-missing');
			continue;
		}
		const actions = DOM.append(card, DOM.$('.knox-gui-checkpoint-bundle-actions'));
		cpButton(widget, actions, { variant: 'outline', small: true, svg: 'download', label: t(state, 'checkpointShare.import'), onClick: () => void widget.controller.importShareBundle(bundle.filePath) });
		cpButton(widget, actions, { variant: 'outline', small: true, svg: 'folder-open', label: t(state, 'checkpointShare.reveal'), onClick: () => void widget.controller.revealShareBundle(bundle.filePath) });
	}
}

/** `CollaborativePanel.tsx` `AuditTrailSection`: heading + empty card, or a scrolling list of expandable cards. */
function renderCheckpointShareAudit(widget: KnoxGuiWidget, body: HTMLElement, state: IKnoxGuiState): void {
	const root = DOM.append(body, DOM.$('.knox-gui-checkpoint-audit-root'));
	const h3 = DOM.append(root, DOM.$('h3.knox-gui-cp-heading.is-strong'));
	appendKnoxGuiSvg(h3, 'shield', 16);
	DOM.append(h3, DOM.$('span', undefined, t(state, 'checkpointShare.auditTrail')));
	if (!state.checkpointShareAudit.length) {
		cpEmptyCard(root, 'shield', t(state, 'checkpointShare.noAudit'), undefined, 'checkpoint-audit-empty');
		return;
	}
	const list = DOM.append(root, DOM.$('.knox-gui-checkpoint-audit-list'));
	for (const record of state.checkpointShareAudit) {
		const expanded = widget.checkpointShareAuditExpanded === record.id;
		const card = DOM.append(list, DOM.$('.knox-gui-cp-card.knox-gui-checkpoint-audit', { 'data-testid': 'checkpoint-audit-row' }));
		const toggle = DOM.append(card, DOM.$('button.knox-gui-checkpoint-audit-toggle')) as HTMLButtonElement;
		toggle.type = 'button';
		toggle.setAttribute('aria-expanded', String(expanded));
		appendKnoxGuiSvg(toggle, expanded ? 'chevron-down' : 'chevron-right', 12);
		DOM.append(toggle, DOM.$(`span.knox-gui-checkpoint-audit-action.${checkpointAuditActionClass(record.action)}`, undefined, record.action));
		DOM.append(toggle, DOM.$('span.knox-gui-checkpoint-audit-resource', undefined, `${record.resourceType}/${record.resourceId.slice(0, 8)}...`));
		const outcome = checkpointAuditOutcome(record.outcome);
		cpBadge(toggle, outcome === 'OK' ? 'default' : outcome === 'FAIL' ? 'destructive' : 'secondary', outcome).classList.add('knox-gui-checkpoint-audit-outcome');
		DOM.append(toggle, DOM.$('span.knox-gui-checkpoint-audit-time', undefined, record.timestamp ? new Date(record.timestamp).toLocaleTimeString() : ''));
		widget.renderStore.add(DOM.addDisposableListener(toggle, 'click', () => {
			widget.checkpointShareAuditExpanded = expanded ? null : record.id;
			widget.render();
		}));
		if (!expanded) {
			continue;
		}
		const detail = DOM.append(card, DOM.$('.knox-gui-checkpoint-audit-detail', { 'data-testid': 'checkpoint-audit-detail' }));
		const machine = DOM.append(detail, DOM.$('div.knox-gui-checkpoint-audit-machine'));
		const machineLine = DOM.append(machine, DOM.$('span'));
		DOM.append(machineLine, DOM.$('strong', undefined, `${t(state, 'checkpointShare.machine')}:`));
		DOM.append(machineLine, document.createTextNode(` ${record.machineId || record.userId}`));
		const resource = DOM.append(detail, DOM.$('div'));
		DOM.append(resource, DOM.$('strong', undefined, `${t(state, 'checkpointShare.resource')}:`));
		DOM.append(resource, document.createTextNode(` ${record.resourceType} / ${record.resourceId}`));
		if (record.details && record.details !== '{}') {
			const el = DOM.append(detail, DOM.$('div'));
			DOM.append(el, DOM.$('strong', undefined, `${t(state, 'checkpointShare.details')}:`));
			DOM.append(el, DOM.$('pre.knox-gui-checkpoint-audit-pre', undefined, record.details));
		}
		const result = DOM.append(detail, DOM.$('div'));
		DOM.append(result, DOM.$('strong', undefined, `${t(state, 'checkpointShare.outcome')}:`));
		DOM.append(result, document.createTextNode(` ${record.outcome}`));
	}
}
