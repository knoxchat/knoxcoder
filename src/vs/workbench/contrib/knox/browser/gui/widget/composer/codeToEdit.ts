/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { appendKnoxGuiSvg } from '../../knoxGuiIcons.js';
import { lastRelativePathParts, knoxGuiCodeToEditTitle } from '../../../../common/knoxGuiInput.js';
import { IKnoxGuiState } from '../../../../common/knoxGuiState.js';
import { displayLanguageForFile } from '../../../../common/knoxGuiTools.js';

export function renderCodeToEditCard(widget: KnoxGuiWidget, parent: HTMLElement, state: IKnoxGuiState): void { // KN-374
	const card = DOM.append(parent, DOM.$('.knox-gui-code-edit'));
	card.setAttribute('data-testid', 'knox-gui-code-to-edit');
	const head = DOM.append(card, DOM.$('.knox-gui-code-edit-head'));
	const title = state.codeToEdit.length === 0
		? t(state, 'editCode')
		: t(state, 'editCodeItems', { count: state.codeToEdit.length });
	DOM.append(head, DOM.$('span', undefined, title));
	const openAddFile = () => {
		widget.addFileHits = [];
		widget.addFileQuery = '';
		widget.addFileSelected = 0;
		widget.addFileMenuOpen = false;
		widget.controller.store.patch({ addFileOpen: true });
		void widget.refreshAddFileHits('');
	};
	const split = DOM.append(head, DOM.$('.knox-gui-add-file-split'));
	widget.chromeButton(split, {
		svg: 'plus',
		svgSize: 12,
		label: t(state, 'addFile'),
		title: t(state, 'addFileToEdit'),
		testId: 'knox-gui-add-file-edit',
		extraClass: 'knox-gui-add-file-main',
		onClick: openAddFile,
	});
	widget.chromeButton(split, {
		svg: 'arrow-down',
		svgSize: 12,
		title: t(state, 'addAllOpenFiles'),
		testId: 'knox-gui-add-file-menu',
		extraClass: 'knox-gui-add-file-caret',
		menuTrigger: true,
		onClick: () => {
			widget.addFileMenuOpen = !widget.addFileMenuOpen;
			widget.controller.store.patch({});
		},
	});
	if (widget.addFileMenuOpen) {
		const menu = DOM.append(split, DOM.$('.knox-gui-popover.knox-gui-add-file-popover'));
		const all = DOM.append(menu, DOM.$('button.knox-gui-popover-item', undefined, t(state, 'addAllOpenFiles'))) as HTMLButtonElement;
		all.type = 'button';
		all.setAttribute('data-testid', 'knox-gui-add-all-open-files');
		widget.renderStore.add(DOM.addDisposableListener(all, 'click', e => {
			e.stopPropagation();
			widget.addFileMenuOpen = false;
			void widget.controller.addAllOpenFilesToEdit();
		}));
	}
	if (state.codeToEdit.length) {
		const list = DOM.append(card, DOM.$('ul.knox-gui-code-edit-list'));
		const dirs = widget.controller.workspaceDirectory ? [widget.controller.workspaceDirectory] : [];
		for (const [index, code] of state.codeToEdit.entries()) {
			const info = knoxGuiCodeToEditTitle(code);
			const expanded = info.kind !== 'insert' && widget.codeEditExpanded.has(index);
			const row = DOM.append(list, DOM.$('li.knox-gui-code-edit-item'));
			row.setAttribute('data-testid', 'knox-gui-code-to-edit-item');
			row.classList.toggle('expanded', expanded);
			const toggle = () => {
				if (widget.codeEditExpanded.has(index)) {
					widget.codeEditExpanded.delete(index);
				} else {
					widget.codeEditExpanded.add(index);
				}
				widget.controller.store.patch({});
			};
			const label = info.kind === 'insert'
				? `${info.name} - ${t(state, 'insertingAtLine', { line: info.start })}`
				: info.kind === 'range'
					? `${info.name} (${info.start} - ${info.end})`
					: info.name;
			const line = DOM.append(row, DOM.$('.knox-gui-code-edit-line'));
			if (info.kind !== 'insert') {
				widget.renderStore.add(DOM.addDisposableListener(line, 'click', toggle));
			}
			const main = DOM.append(line, DOM.$('.knox-gui-code-edit-main'));
			appendKnoxGuiSvg(main, 'file', 18);
			const fileBtn = DOM.append(main, DOM.$('button.knox-gui-code-edit-name', undefined, label)) as HTMLButtonElement;
			fileBtn.type = 'button';
			fileBtn.setAttribute('data-testid', 'knox-gui-code-to-edit-name');
			widget.renderStore.add(DOM.addDisposableListener(fileBtn, 'click', e => {
				e.stopPropagation();
				widget.controller.openCodeToEdit(code);
			}));
			DOM.append(main, DOM.$('span.knox-gui-code-edit-path', undefined, lastRelativePathParts(code.filepath, dirs, 2)));
			const actions = DOM.append(line, DOM.$('.knox-gui-code-edit-actions'));
			if (info.kind !== 'insert') {
				widget.chromeButton(actions, {
					svg: expanded ? 'chevron-down' : 'chevron-right',
					svgSize: 16,
					title: t(state, expanded ? 'hide' : 'show'),
					onClick: (_button, event) => {
						event?.stopPropagation();
						toggle();
					},
				});
			}
			widget.chromeButton(actions, {
				svg: 'x',
				svgSize: 16,
				title: t(state, 'delete'),
				extraClass: 'knox-gui-code-edit-remove',
				onClick: (_button, event) => {
					event?.stopPropagation();
					widget.codeEditExpanded.clear();
					widget.controller.removeCodeToEdit(index);
				},
			});
			if (expanded && code.contents !== undefined) {
				const snippet = DOM.append(row, DOM.$('pre.knox-gui-code-edit-snippet'));
				snippet.setAttribute('data-testid', 'knox-gui-code-to-edit-preview');
				widget.paintHighlightedCode(snippet, displayLanguageForFile(code.filepath), code.contents, code.filepath);
			}
		}
	} else if (!state.addFileOpen) {
		widget.chromeButton(card, {
			svg: 'plus',
			svgSize: 14,
			label: t(state, 'addFileToEdit'),
			extraClass: 'knox-gui-add-file',
			onClick: () => {
				widget.addFileHits = [];
				widget.addFileQuery = '';
				widget.controller.store.patch({ addFileOpen: true });
				void widget.refreshAddFileHits('');
			},
		});
	}
	if (state.addFileOpen) {
		const combobox = DOM.append(card, DOM.$('.knox-gui-add-file-combo'));
		const input = DOM.append(combobox, DOM.$('input.knox-gui-add-file-input')) as HTMLInputElement;
		input.placeholder = t(state, 'enterSearchFile');
		input.setAttribute('data-testid', 'knox-gui-add-file-input');
		input.value = widget.addFileQuery;
		widget.renderStore.add(DOM.addDisposableListener(input, 'input', () => {
			widget.addFileQuery = input.value;
			void widget.refreshAddFileHits(input.value);
		}));
		widget.renderStore.add(DOM.addDisposableListener(input, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'ArrowDown' && widget.addFileHits.length) {
				e.preventDefault();
				widget.addFileSelected = (widget.addFileSelected + 1) % widget.addFileHits.length;
				paintAddFileHits(widget);
			} else if (e.key === 'ArrowUp' && widget.addFileHits.length) {
				e.preventDefault();
				widget.addFileSelected = (widget.addFileSelected - 1 + widget.addFileHits.length) % widget.addFileHits.length;
				paintAddFileHits(widget);
			} else if (e.key === 'Enter' && !e.isComposing) {
				e.preventDefault();
				const hit = widget.addFileHits[widget.addFileSelected];
				const uri = hit?.query || hit?.id || input.value.trim();
				if (uri) {
					void pickAddFile(widget, uri);
				}
			} else if (e.key === 'Escape') {
				widget.addFileHits = [];
				widget.addFileQuery = '';
				widget.controller.store.patch({ addFileOpen: false });
			}
		}));
		widget.renderStore.add(DOM.addDisposableListener(combobox, 'click', e => {
			const option = (e.target as HTMLElement).closest('.knox-gui-add-file-option') as HTMLElement | null;
			const uri = option?.dataset.uri;
			if (uri) {
				void pickAddFile(widget, uri);
			}
		}));
		widget.chromeButton(combobox, {
			svg: 'x',
			svgSize: 14,
			title: t(state, 'close'),
			extraClass: 'knox-gui-add-file-close',
			onClick: () => {
				widget.addFileHits = [];
				widget.addFileQuery = '';
				widget.controller.store.patch({ addFileOpen: false });
			},
		});
		paintAddFileHits(widget);
		queueMicrotask(() => input.focus());
	}
}

/** Multi-pick: the combobox stays open and already-added files drop out of the list. */
async function pickAddFile(widget: KnoxGuiWidget, uri: string): Promise<void> {
	widget.addFileQuery = '';
	widget.addFileHits = widget.addFileHits.filter(hit => (hit.query || hit.id) !== uri);
	widget.addFileSelected = 0;
	const input = widget.root.querySelector('.knox-gui-add-file-input') as HTMLInputElement | null;
	if (input) {
		input.value = '';
	}
	await widget.controller.addFilesToEdit([uri]);
	if (widget.controller.store.state.addFileOpen) {
		await widget.refreshAddFileHits('');
	}
}

export async function refreshAddFileHits(widget: KnoxGuiWidget, query: string): Promise<void> {
	const hits = await widget.controller.searchAddFiles(query);
	if (!widget.controller.store.state.addFileOpen || widget.addFileQuery !== query) {
		return;
	}
	widget.addFileHits = hits;
	widget.addFileSelected = 0;
	if (!paintAddFileHits(widget)) {
		widget.controller.store.patch({});
	}
}

function paintAddFileHits(widget: KnoxGuiWidget): boolean {
	const combobox = widget.root.querySelector('.knox-gui-add-file-combo') as HTMLElement | null;
	if (!combobox) {
		return false;
	}
	combobox.querySelectorAll('.knox-gui-add-file-options, .knox-gui-add-file-empty').forEach(node => node.remove());
	const state = widget.controller.store.state;
	if (widget.addFileHits.length) {
		const options = DOM.append(combobox, DOM.$('.knox-gui-add-file-options'));
		for (const [index, hit] of widget.addFileHits.entries()) {
			const option = DOM.append(options, DOM.$('button.knox-gui-add-file-option')) as HTMLButtonElement;
			option.type = 'button';
			option.dataset.uri = hit.query || hit.id;
			if (index === widget.addFileSelected) {
				option.classList.add('selected');
			}
			appendKnoxGuiSvg(option, 'file', 16);
			DOM.append(option, DOM.$('span', undefined, hit.label));
			if (hit.description) {
				DOM.append(option, DOM.$('span.knox-gui-muted', undefined, hit.description));
			}
		}
	} else if (widget.addFileQuery) {
		DOM.append(combobox, DOM.$('.knox-gui-add-file-empty', undefined, t(state, 'noResults')));
	}
	return true;
}
