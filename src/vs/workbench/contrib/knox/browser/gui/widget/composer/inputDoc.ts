/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KnoxGuiWidget } from '../../knoxGuiWidget.js';
import { t } from '../t.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { knoxGuiRelativeFontSize } from '../../../../common/knoxGuiChrome.js';
import { appendKnoxGuiSvg, knoxGuiNamedIcon } from '../../knoxGuiIcons.js';
import {
	isFolderMentionNode,
	isPathMentionNode,
	mentionChipOpenUri,
	mentionChipTooltip,
	emptyInputDoc,
	IKnoxGuiInputBlock,
	IKnoxGuiInputCodeBlock,
	knoxGuiCodeBlockOpenAction,
	knoxGuiCodeBlockTitle,
	knoxGuiNewestCodeBlockIndex,
	KnoxGuiInlineNode,
	mentionChipLabel,
	removeCodeBlockAt,
	slashCommandTitle,
} from '../../../../common/knoxGuiInput.js';
import { displayLanguageForFile } from '../../../../common/knoxGuiTools.js';
import { makeKnoxGuiActivatable, setKnoxGuiExpanded } from '../a11y.js';

export function paintInputDoc(widget: KnoxGuiWidget, editor: HTMLElement, doc: IKnoxGuiInputBlock[], onChange?: (doc: IKnoxGuiInputBlock[]) => void): void {
	editor.replaceChildren();
	const blocks = doc.length ? doc : emptyInputDoc();
	const newest = knoxGuiNewestCodeBlockIndex(blocks);
	for (const block of blocks) {
		if (block.type === 'codeBlock') {
			paintCodeBlockChip(widget, editor, block, blocks.indexOf(block) === newest, onChange);
			continue;
		}
		const p = DOM.append(editor, DOM.$('p'));
		if (!block.content.length) {
			continue;
		}
		for (const node of block.content) {
			widget.appendInline(p, node);
		}
	}
}

const codeBlockNodes = new WeakMap<HTMLElement, IKnoxGuiInputCodeBlock>();

function codeBlockKey(block: IKnoxGuiInputCodeBlock): string {
	return `${block.itemName ?? block.filepath ?? ''}:${block.range?.start ?? ''}-${block.range?.end ?? ''}`;
}

/**
 * `CodeSnippetPreview.tsx`: a header with chevron, file icon and name (opens the
 * range, file or a virtual file) and a delete button; the body is highlighted and
 * capped at 100px. Only the newest block starts expanded; a toggle sticks per block.
 */
function paintCodeBlockChip(widget: KnoxGuiWidget, editor: HTMLElement, block: IKnoxGuiInputCodeBlock, newest: boolean, onChange?: (doc: IKnoxGuiInputBlock[]) => void): void {
	const state = widget.controller.store.state;
	const chip = DOM.append(editor, DOM.$('div.knox-gui-input-code-chip'));
	chip.contentEditable = 'false';
	chip.spellcheck = false;
	chip.setAttribute('data-testid', 'knox-gui-input-code-block');
	codeBlockNodes.set(chip, block);
	const key = codeBlockKey(block);
	const expanded = () => widget.codeBlockExpanded.get(key) ?? newest;
	const head = DOM.append(chip, DOM.$('.knox-gui-input-code-head'));
	head.style.fontSize = `${knoxGuiRelativeFontSize(state.fontSize, -3)}px`;
	const titleWrap = DOM.append(head, DOM.$('.knox-gui-input-code-title-wrap'));
	const chevron = DOM.append(titleWrap, DOM.$('span.knox-gui-input-code-chevron'));
	const title = DOM.append(titleWrap, DOM.$('span.knox-gui-input-code-title'));
	title.setAttribute('data-testid', 'knox-gui-input-code-open');
	const name = knoxGuiCodeBlockTitle(block);
	widget.appendFileIcon(title, block.filepath ?? name, 16);
	DOM.append(title, DOM.$('span', undefined, name));
	const body = DOM.append(chip, DOM.$('.knox-gui-input-code-body'));
	const pre = DOM.append(body, DOM.$('pre.knox-gui-input-code'));
	const language = block.language || displayLanguageForFile(block.filepath ?? name);
	widget.paintHighlightedCode(pre, language === 'markdown' ? 'text' : language, block.code, block.filepath);
	const sync = () => {
		const open = expanded();
		chevron.replaceChildren();
		appendKnoxGuiSvg(chevron, open ? 'chevron-down' : 'chevron-right', 12);
		body.hidden = !open;
		head.classList.toggle('expanded', open);
	};
	sync();
	makeKnoxGuiActivatable(widget, head, { expanded: expanded() });
	widget.renderStore.add(DOM.addDisposableListener(head, 'mousedown', e => e.preventDefault()));
	widget.renderStore.add(DOM.addDisposableListener(head, 'click', () => {
		widget.codeBlockExpanded.set(key, !expanded());
		setKnoxGuiExpanded(head, expanded());
		sync();
	}));
	widget.renderStore.add(DOM.addDisposableListener(title, 'click', e => {
		e.stopPropagation();
		const action = knoxGuiCodeBlockOpenAction(block);
		if (action.type === 'showLines') {
			widget.controller.messenger.post('showLines', { filepath: action.filepath, startLine: action.startLine, endLine: action.endLine });
		} else if (action.type === 'showFile') {
			widget.controller.messenger.post('showFile', { filepath: action.filepath });
		} else {
			widget.controller.messenger.post('showVirtualFile', { name: action.name, content: action.content });
		}
	}));
	widget.chromeButton(head, {
		svg: 'x',
		svgSize: 12,
		title: t(state, 'delete'),
		extraClass: 'knox-gui-input-code-remove',
		onClick: (_button, event) => {
			event?.stopPropagation();
			const index = Array.from(editor.querySelectorAll('.knox-gui-input-code-chip')).indexOf(chip);
			const next = removeCodeBlockAt(widget.readInputDoc(editor), index);
			if (onChange) {
				onChange(next);
				widget.paintInputDoc(editor, next, onChange);
			} else {
				widget.controller.store.setInputDoc(next);
			}
		},
	});
}

export function appendInline(widget: KnoxGuiWidget, parent: HTMLElement, node: KnoxGuiInlineNode): void {
	if (node.type === 'text') {
		parent.append(node.text);
		return;
	}
	const chip = DOM.append(parent, DOM.$('span.knox-gui-inline-chip'));
	chip.contentEditable = 'false';
	chip.dataset.chip = node.type;
	chip.dataset.id = node.id;
	chip.dataset.label = node.label;
	chip.setAttribute('data-testid', node.type === 'mention' ? 'knox-gui-mention-chip' : 'knox-gui-slash-chip');
	const state = widget.controller.store.state;
	let tooltip: string | undefined;
	if (node.type === 'mention') {
		chip.classList.add('knox-gui-mention-chip');
		if (node.itemType) {
			chip.dataset.itemType = node.itemType;
		}
		if (node.query) {
			chip.dataset.query = node.query;
		}
		if (node.renderInlineAs) {
			chip.dataset.renderInlineAs = node.renderInlineAs;
		}
		if (node.description) {
			chip.dataset.description = node.description;
		}
		if (node.icon) {
			chip.dataset.icon = node.icon;
		}
		if (isPathMentionNode(node)) {
			const icon = DOM.append(chip, DOM.$('span.knox-gui-chip-icon'));
			const folder = isFolderMentionNode(node);
			icon.setAttribute('data-testid', folder ? 'mention-chip-folder-icon' : 'mention-chip-file-icon');
			widget.appendFileIcon(icon, node.query || node.id || node.label, 12, folder);
		}
		DOM.append(chip, DOM.$('span.knox-gui-chip-label', undefined, mentionChipLabel(node)));
		tooltip = mentionChipTooltip(node);
		const uri = mentionChipOpenUri(node);
		if (uri) {
			chip.classList.add('is-openable');
			chip.setAttribute('aria-label', `${t(state, 'mentionOpenFile')}: ${tooltip ?? mentionChipLabel(node)}`);
			widget.listenerStore.add(DOM.addDisposableListener(chip, 'click', e => {
				e.preventDefault();
				e.stopPropagation();
				widget.controller.showFile(uri);
			}));
		}
	} else {
		chip.classList.add('knox-gui-slash-chip');
		if (node.description) {
			chip.dataset.description = node.description;
		}
		const label = slashCommandTitle(node.id || node.label);
		const named = knoxGuiNamedIcon(node.id || node.label);
		if (named) {
			const icon = DOM.append(chip, DOM.$('span.knox-gui-chip-icon'));
			icon.setAttribute('data-testid', 'slash-command-chip-icon');
			appendKnoxGuiSvg(icon, named, 12);
		}
		DOM.append(chip, DOM.$('span.knox-gui-chip-label', undefined, label));
		tooltip = node.description?.trim() || label;
	}
	if (tooltip) {
		widget.hover(chip, tooltip);
	}
	const dismiss = DOM.append(chip, DOM.$('button.knox-gui-chip-dismiss', undefined, '×')) as HTMLButtonElement;
	dismiss.type = 'button';
	dismiss.tabIndex = -1;
	const dismissLabel = t(state, node.type === 'mention' ? 'mentionRemove' : 'slashRemove');
	dismiss.setAttribute('aria-label', dismissLabel);
	dismiss.setAttribute('data-testid', node.type === 'mention' ? 'mention-chip-dismiss' : 'slash-command-chip-dismiss');
	dismiss.title = dismissLabel;
	widget.listenerStore.add(DOM.addDisposableListener(dismiss, 'mousedown', e => {
		e.preventDefault();
		e.stopPropagation();
	}));
	widget.listenerStore.add(DOM.addDisposableListener(dismiss, 'click', e => {
		e.preventDefault();
		e.stopPropagation();
		const editor = chip.closest<HTMLElement>('[contenteditable="true"]');
		chip.remove();
		editor?.dispatchEvent(new Event('input', { bubbles: true }));
	}));
}

export function readInputDoc(widget: KnoxGuiWidget, editor: HTMLElement): IKnoxGuiInputBlock[] {
	const blocks: IKnoxGuiInputBlock[] = [];
	const children = Array.from(editor.childNodes);
	if (!children.length) {
		return emptyInputDoc();
	}
	for (const child of children) {
		if (child instanceof HTMLElement && child.classList.contains('knox-gui-input-code-chip')) {
			const known = codeBlockNodes.get(child);
			if (known) {
				blocks.push({ ...known });
				continue;
			}
			const pre = child.querySelector('pre');
			blocks.push({
				type: 'codeBlock',
				language: child.dataset.language,
				filepath: child.dataset.filepath,
				itemName: child.dataset.itemName,
				code: pre?.textContent ?? child.textContent ?? '',
			});
			continue;
		}
		if (child instanceof HTMLPreElement) {
			blocks.push({
				type: 'codeBlock',
				language: child.dataset.language,
				filepath: child.dataset.filepath,
				itemName: child.dataset.itemName,
				code: child.textContent ?? '',
			});
			continue;
		}
		if (child.nodeType === Node.TEXT_NODE) {
			const text = child.textContent ?? '';
			if (text) {
				blocks.push({ type: 'paragraph', content: [{ type: 'text', text }] });
			}
			continue;
		}
		if (child instanceof HTMLBRElement) {
			blocks.push({ type: 'paragraph', content: [] });
			continue;
		}
		blocks.push({ type: 'paragraph', content: widget.readInlines(child) });
	}
	return blocks.length ? blocks : emptyInputDoc();
}

export function readInlines(widget: KnoxGuiWidget, node: Node): KnoxGuiInlineNode[] {
	const content: KnoxGuiInlineNode[] = [];
	const walk = (current: Node): void => {
		if (current.nodeType === Node.TEXT_NODE) {
			const text = current.textContent ?? '';
			if (text) {
				content.push({ type: 'text', text });
			}
			return;
		}
		if (current instanceof HTMLBRElement) {
			content.push({ type: 'text', text: '\n' });
			return;
		}
		if (current instanceof HTMLElement && current.dataset.chip) {
			if (current.dataset.chip === 'slash') {
				content.push({ type: 'slash', id: current.dataset.id ?? '', label: current.dataset.label ?? current.textContent ?? '' });
				return;
			}
			content.push({
				type: 'mention',
				id: current.dataset.id ?? '',
				label: current.dataset.label ?? current.textContent ?? '',
				itemType: current.dataset.itemType,
				query: current.dataset.query,
				renderInlineAs: current.dataset.renderInlineAs,
				description: current.dataset.description,
			});
			return;
		}
		current.childNodes.forEach(walk);
	};
	walk(node);
	return content;
}
