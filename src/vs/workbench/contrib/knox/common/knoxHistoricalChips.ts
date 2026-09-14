/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxMentionChip, mentionChipLabel } from './knoxMentions.js';
import { knoxParseNativeEditorState } from './knoxResolveInput.js';
import { IKnoxSlashChip, knoxSlashChipLabel } from './knoxSlash.js';

export type KnoxHistoricalChipKind = 'mention' | 'slash';

export interface IKnoxHistoricalChip {
	kind: KnoxHistoricalChipKind;
	label: string;
	id: string;
	itemType?: string;
	query?: string;
	description?: string;
	renderInlineAs?: string;
	icon?: string;
}

export type KnoxHistoricalSegment =
	| { kind: 'text'; text: string }
	| { kind: 'chip'; chip: IKnoxHistoricalChip };

export interface IKnoxHistoricalEditorChips {
	mentions: IKnoxMentionChip[];
	slashCommands: IKnoxSlashChip[];
	/** True when the stored editorState is TipTap JSON (loaded webview sessions). */
	fromTipTap: boolean;
	/** True when chips exist; historical UI must not mount a mention popup. */
	hasChips: boolean;
}

interface ITipTapNode {
	type?: string;
	text?: string;
	attrs?: Record<string, unknown>;
	content?: ITipTapNode[];
}

export function knoxIsTipTapEditorState(editorState: unknown): boolean {
	if (!editorState || typeof editorState !== 'object') {
		return false;
	}
	const record = editorState as ITipTapNode;
	return record.type === 'doc' && Array.isArray(record.content);
}

export function knoxExtractHistoricalChips(editorState: unknown): IKnoxHistoricalEditorChips {
	if (knoxIsTipTapEditorState(editorState)) {
		const segments = knoxWalkTipTapDocument(editorState as ITipTapNode);
		const mentions: IKnoxMentionChip[] = [];
		const slashCommands: IKnoxSlashChip[] = [];
		for (const segment of segments) {
			if (segment.kind !== 'chip') {
				continue;
			}
			if (segment.chip.kind === 'mention') {
				mentions.push(mentionFromHistorical(segment.chip));
			} else {
				slashCommands.push({ id: segment.chip.id, label: segment.chip.label.replace(/^\//, '') });
			}
		}
		return {
			mentions,
			slashCommands,
			fromTipTap: true,
			hasChips: mentions.length > 0 || slashCommands.length > 0,
		};
	}

	const parsed = knoxParseNativeEditorState(editorState);
	const mentions = parsed.mentions ? [...parsed.mentions] : [];
	const slashCommands = parsed.slashCommands ? [...parsed.slashCommands] : [];
	return {
		mentions,
		slashCommands,
		fromTipTap: false,
		hasChips: mentions.length > 0 || slashCommands.length > 0,
	};
}

export function knoxHistoricalSegments(
	editorState: unknown,
	fallbackText: string,
): KnoxHistoricalSegment[] {
	if (knoxIsTipTapEditorState(editorState)) {
		const segments = knoxWalkTipTapDocument(editorState as ITipTapNode);
		return segments.length ? segments : [{ kind: 'text', text: fallbackText }];
	}
	const chips = knoxExtractHistoricalChips(editorState);
	if (!chips.hasChips) {
		return fallbackText ? [{ kind: 'text', text: fallbackText }] : [];
	}
	return knoxHistoricalSegmentsFromText(fallbackText, chips.mentions, chips.slashCommands);
}

export function knoxHistoricalSegmentsFromText(
	text: string,
	mentions: readonly IKnoxMentionChip[],
	slashCommands: readonly IKnoxSlashChip[],
): KnoxHistoricalSegment[] {
	const labeled: { label: string; chip: IKnoxHistoricalChip; index: number }[] = [];
	for (const mention of mentions) {
		const label = mentionChipLabel(mention);
		const index = text.indexOf(label);
		if (index < 0) {
			continue;
		}
		labeled.push({
			label,
			index,
			chip: {
				kind: 'mention',
				label,
				id: mention.id,
				itemType: mention.itemType,
				query: mention.query,
				description: mention.description,
				renderInlineAs: mention.renderInlineAs,
				icon: mention.icon,
			},
		});
	}
	for (const slash of slashCommands) {
		const label = knoxSlashChipLabel(slash);
		const index = text.indexOf(label);
		if (index < 0) {
			continue;
		}
		labeled.push({
			label,
			index,
			chip: {
				kind: 'slash',
				label,
				id: slash.id,
				itemType: 'slashCommand',
			},
		});
	}
	labeled.sort((a, b) => a.index - b.index || b.label.length - a.label.length);

	const segments: KnoxHistoricalSegment[] = [];
	let cursor = 0;
	const used = new Set<number>();
	for (const item of labeled) {
		if (item.index < cursor) {
			continue;
		}
		const key = item.index;
		if (used.has(key)) {
			continue;
		}
		used.add(key);
		if (item.index > cursor) {
			segments.push({ kind: 'text', text: text.slice(cursor, item.index) });
		}
		segments.push({ kind: 'chip', chip: item.chip });
		cursor = item.index + item.label.length;
	}
	if (cursor < text.length) {
		segments.push({ kind: 'text', text: text.slice(cursor) });
	}
	if (!segments.length && text) {
		segments.push({ kind: 'text', text });
	}
	return segments;
}

export function knoxWalkTipTapDocument(node: ITipTapNode): KnoxHistoricalSegment[] {
	const segments: KnoxHistoricalSegment[] = [];
	walkTipTap(node, segments);
	return mergeAdjacentText(segments);
}

function walkTipTap(node: ITipTapNode, out: KnoxHistoricalSegment[]): void {
	if (node.type === 'text' && typeof node.text === 'string') {
		out.push({ kind: 'text', text: node.text });
		return;
	}
	if (node.type === 'hardBreak') {
		out.push({ kind: 'text', text: '\n' });
		return;
	}
	if (node.type === 'mention') {
		out.push({ kind: 'chip', chip: historicalMentionFromAttrs(node.attrs ?? {}) });
		return;
	}
	if (node.type === 'slashcommand') {
		out.push({ kind: 'chip', chip: historicalSlashFromAttrs(node.attrs ?? {}) });
		return;
	}
	const children = node.content ?? [];
	for (let i = 0; i < children.length; i++) {
		if (node.type === 'doc' && i > 0) {
			out.push({ kind: 'text', text: '\n' });
		}
		walkTipTap(children[i], out);
	}
}

function historicalMentionFromAttrs(attrs: Record<string, unknown>): IKnoxHistoricalChip {
	const id = stringAttr(attrs.id) ?? stringAttr(attrs.query) ?? '';
	const label = stringAttr(attrs.label);
	const renderInlineAs = stringAttr(attrs.renderInlineAs);
	const chipLabel = mentionChipLabel({
		label,
		id,
		renderInlineAs,
	});
	return {
		kind: 'mention',
		label: chipLabel,
		id,
		itemType: stringAttr(attrs.itemType),
		query: stringAttr(attrs.query) ?? id,
		description: stringAttr(attrs.description),
		renderInlineAs,
		icon: stringAttr(attrs.icon),
	};
}

function historicalSlashFromAttrs(attrs: Record<string, unknown>): IKnoxHistoricalChip {
	const id = stringAttr(attrs.id) ?? stringAttr(attrs.label) ?? '';
	return {
		kind: 'slash',
		label: knoxSlashChipLabel({ id, label: stringAttr(attrs.label) }),
		id,
		itemType: 'slashCommand',
	};
}

function mentionFromHistorical(chip: IKnoxHistoricalChip): IKnoxMentionChip {
	return {
		id: chip.id,
		label: chip.label.replace(/^@/, ''),
		itemType: chip.itemType ?? 'file',
		query: chip.query,
		description: chip.description,
		renderInlineAs: chip.renderInlineAs,
		icon: chip.icon,
	};
}

function stringAttr(value: unknown): string | undefined {
	return typeof value === 'string' && value.length ? value : undefined;
}

function mergeAdjacentText(segments: KnoxHistoricalSegment[]): KnoxHistoricalSegment[] {
	const merged: KnoxHistoricalSegment[] = [];
	for (const segment of segments) {
		const last = merged[merged.length - 1];
		if (segment.kind === 'text' && last?.kind === 'text') {
			last.text += segment.text;
		} else {
			merged.push(segment.kind === 'text' ? { kind: 'text', text: segment.text } : segment);
		}
	}
	return merged.filter(segment => segment.kind === 'chip' || segment.text.length > 0);
}

/** Historical chips are static spans: never a live mention/slash suggestion popup. */
export function knoxHistoricalChipsEnableSuggestion(_isMainInput: boolean): boolean {
	return false;
}
