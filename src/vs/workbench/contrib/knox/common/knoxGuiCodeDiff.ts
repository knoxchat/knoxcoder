/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Chat file-edit cards show +N/-N from Knox CheckPoint diffs
 * (`countLineDelta` / `computeLineDiff` / `groupDiffHunks` on old vs new
 * snapshots). This is not git diff: no `diff --git` parsing, no shortstat.
 */

import { incrementalParseJson } from './knoxGuiChat.js';
import { computeLineDiff, countLineDelta, groupDiffHunks } from './knoxGuiCheckpoints.js';
import { knoxGuiSanitizeToolFilePath } from './knoxGuiToolFilePath.js';

export interface IKnoxGuiFenceDiffStats {
	additions: number;
	deletions: number;
}

export interface IKnoxGuiCodeDiffFile {
	filepath: string;
	code: string;
	language: string;
	additions: number;
	deletions: number;
	range?: string;
}

const APPLY_FILE_HEADER = /^\*\*\* (Add|Update|Delete) File:\s*(.+?)\s*$/;
const MOVE_HEADER = /^\*\*\* Move to:\s*(.+?)\s*$/;
const OLD_KEYS = ['old_string', 'oldText', 'old_str', 'old_text'] as const;
const NEW_KEYS = ['new_string', 'newText', 'new_str', 'new_text'] as const;

export function checkpointLineDelta(oldText: string, newText: string): IKnoxGuiFenceDiffStats {
	const delta = countLineDelta(oldText, newText);
	return { additions: delta.additions, deletions: delta.deletions };
}

export function looksLikeCheckpointPatch(code: string): boolean {
	return /^\*\*\* (?:Begin Patch|Add File:|Update File:|Delete File:)/m.test(code);
}

export function fenceDiffStats(
	fence: { language?: string; code: string },
	explicit?: Partial<IKnoxGuiFenceDiffStats>,
): IKnoxGuiFenceDiffStats | undefined {
	const additions = explicit?.additions;
	const deletions = explicit?.deletions;
	if (additions != null || deletions != null) {
		const stats = { additions: additions ?? 0, deletions: deletions ?? 0 };
		return stats.additions > 0 || stats.deletions > 0 ? stats : undefined;
	}
	if (!looksLikeCheckpointPatch(fence.code)) {
		return undefined;
	}
	const files = splitStreamingPatchFiles(fence.code);
	const stats = files.reduce(
		(sum, file) => ({ additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions }),
		{ additions: 0, deletions: 0 },
	);
	return stats.additions > 0 || stats.deletions > 0 ? stats : undefined;
}

export function splitStreamingPatchFiles(code: string): IKnoxGuiCodeDiffFile[] {
	const lines = code.replace(/\r\n/g, '\n').split('\n');
	const starts: Array<{ kind: 'Add' | 'Update' | 'Delete'; filepath: string; index: number }> = [];
	for (let i = 0; i < lines.length; i++) {
		const header = APPLY_FILE_HEADER.exec(lines[i]);
		if (header) {
			starts.push({
				kind: header[1] as 'Add' | 'Update' | 'Delete',
				filepath: knoxGuiSanitizeToolFilePath(header[2]),
				index: i,
			});
		}
	}
	if (starts.length === 0) {
		return [];
	}
	return starts.map((start, i) => {
		const end = i + 1 < starts.length ? starts[i + 1].index : lines.length;
		const body = lines.slice(start.index + 1, end);
		const move = body.map(line => MOVE_HEADER.exec(line)?.[1]).find(Boolean);
		const filepath = knoxGuiSanitizeToolFilePath(move ?? start.filepath);
		const { oldText, newText } = reconstructCheckpointSides(start.kind, body);
		return checkpointPreviewFromContents(filepath, oldText, newText);
	}).filter(file => file.filepath.length > 0);
}

export function codeDiffPreviewsForTool(options: {
	toolName?: string;
	filepath?: string;
	contentKey?: string;
	code: string;
	parsedArgs?: unknown;
	rawArguments?: unknown;
}): IKnoxGuiCodeDiffFile[] {
	const name = (options.toolName ?? '').replace(/^builtin_/, '').toLowerCase().replace(/-/g, '_');
	const args = mergeToolArgs(options.parsedArgs, options.rawArguments);
	const filepath = knoxGuiSanitizeToolFilePath(options.filepath || stringField(args, ['filepath', 'file_path', 'target_file', 'path', 'file', 'filename']) || '');

	if (name === 'create_new_file' || name === 'createnewfile') {
		const contents = typeof args.contents === 'string' ? args.contents
			: typeof args.content === 'string' ? args.content
				: options.code;
		if (!filepath && !contents) {
			return [];
		}
		const delta = checkpointLineDelta('', contents);
		return [{
			filepath: filepath || 'untitled',
			code: contents,
			language: '',
			additions: delta.additions,
			deletions: delta.deletions,
		}];
	}

	if (name === 'edit_file' || name === 'editfile') {
		const pairs = collectEditPairs(args);
		if (pairs.length && filepath) {
			return [previewFromEditPairs(filepath, pairs)];
		}
	}

	if (name === 'write_file' || name === 'writefile') {
		return [];
	}

	const patchSource = options.contentKey === 'patch' || name === 'apply_patch' || name === 'applypatch'
		? (options.code || stringField(args, ['patch']) || '')
		: looksLikeCheckpointPatch(options.code) ? options.code : '';
	if (patchSource) {
		const files = splitStreamingPatchFiles(patchSource);
		if (files.length) {
			return files;
		}
	}

	return [];
}

export function firstPatchFilePath(code: string): string | undefined {
	return splitStreamingPatchFiles(code)[0]?.filepath;
}

export function checkpointPreviewFromContents(filepath: string, oldText: string, newText: string): IKnoxGuiCodeDiffFile {
	const delta = checkpointLineDelta(oldText, newText);
	const hunks = groupDiffHunks(computeLineDiff(oldText, newText), 3);
	const body: string[] = [];
	let range: string | undefined;
	for (const hunk of hunks) {
		if (range == null) {
			range = String(hunk.newStart);
		}
		for (const line of hunk.lines) {
			const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
			body.push(prefix + line.content);
		}
	}
	return {
		filepath,
		code: body.join('\n'),
		language: 'diff',
		additions: delta.additions,
		deletions: delta.deletions,
		range,
	};
}

function reconstructCheckpointSides(kind: 'Add' | 'Update' | 'Delete', body: string[]): { oldText: string; newText: string } {
	const oldLines: string[] = [];
	const newLines: string[] = [];
	for (const raw of body) {
		if (!raw || raw === '*** End Patch' || raw.startsWith('*** ') || raw.startsWith('@@')) {
			continue;
		}
		if (kind === 'Add') {
			newLines.push(stripPatchMarker(raw, '+'));
			continue;
		}
		if (kind === 'Delete') {
			oldLines.push(stripPatchMarker(raw, '-'));
			continue;
		}
		if (raw.startsWith('+')) {
			newLines.push(raw.slice(1));
		} else if (raw.startsWith('-')) {
			oldLines.push(raw.slice(1));
		} else {
			const text = raw.startsWith(' ') ? raw.slice(1) : raw;
			oldLines.push(text);
			newLines.push(text);
		}
	}
	return { oldText: oldLines.join('\n'), newText: newLines.join('\n') };
}

function stripPatchMarker(line: string, marker: '+' | '-'): string {
	return line.startsWith(marker) || line.startsWith(' ') ? line.slice(1) : line;
}

function mergeToolArgs(parsedArgs: unknown, rawArguments: unknown): Record<string, unknown> {
	const raw = typeof rawArguments === 'string' ? rawArguments : '';
	const fromRaw = raw ? asRecord(incrementalParseJson(raw)[1]) ?? {} : {};
	return { ...fromRaw, ...asRecord(parsedArgs) };
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringField(args: Record<string, unknown>, keys: readonly string[]): string | undefined {
	for (const key of keys) {
		const value = args[key];
		if (typeof value === 'string') {
			return value;
		}
	}
	return undefined;
}

function collectEditPairs(args: Record<string, unknown>): Array<{ oldText: string; newText: string }> {
	const edits = args.edits;
	if (Array.isArray(edits) && edits.length) {
		return edits.flatMap(item => {
			const rec = asRecord(item);
			const oldText = stringField(rec, OLD_KEYS);
			const newText = stringField(rec, NEW_KEYS);
			if (oldText == null && newText == null) {
				return [];
			}
			return [{ oldText: oldText ?? '', newText: newText ?? '' }];
		});
	}
	const oldText = stringField(args, OLD_KEYS);
	const newText = stringField(args, NEW_KEYS);
	if (oldText == null && newText == null) {
		return [];
	}
	return [{ oldText: oldText ?? '', newText: newText ?? '' }];
}

function previewFromEditPairs(filepath: string, pairs: Array<{ oldText: string; newText: string }>): IKnoxGuiCodeDiffFile {
	if (pairs.length === 1) {
		return checkpointPreviewFromContents(filepath, pairs[0].oldText, pairs[0].newText);
	}
	let additions = 0;
	let deletions = 0;
	const hunkBodies: string[] = [];
	let range: string | undefined;
	for (const pair of pairs) {
		const preview = checkpointPreviewFromContents(filepath, pair.oldText, pair.newText);
		additions += preview.additions;
		deletions += preview.deletions;
		if (range == null) {
			range = preview.range;
		}
		if (preview.code) {
			hunkBodies.push(preview.code);
		}
	}
	return {
		filepath,
		code: hunkBodies.join('\n'),
		language: 'diff',
		additions,
		deletions,
		range,
	};
}
