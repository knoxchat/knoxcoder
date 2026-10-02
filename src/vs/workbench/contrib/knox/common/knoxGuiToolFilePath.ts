/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Normalize file paths models put in tool arguments / transcript chips.
 * Keep in sync with `extensions/knox/src/core/util/toolFilePath.ts`.
 */

export interface IKnoxGuiParsedToolFilePath {
	filepath: string;
	startLine?: number;
	endLine?: number;
}

const KEY_PREFIX_RE =
	/^(?:filepath|file_path|target_file|filename|relative_?filepath|directory_path)\s*[=:]\s*/i;

const WRAPPERS: ReadonlyArray<readonly [string, string]> = [
	['"', '"'],
	["'", "'"],
	['`', '`'],
	['\u201c', '\u201d'],
	['\u2018', '\u2019'],
];

function isUri(value: string): boolean {
	return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value);
}

function looksLikePathInner(value: string): boolean {
	const v = value.trim();
	if (!v || v.length > 512) {
		return false;
	}
	if (/[=<>]/.test(v)) {
		return false;
	}
	if (/\s/.test(v) && !/^[A-Za-z]:[\\/]/.test(v)) {
		return false;
	}
	return /[\\/]/.test(v) || /\.[A-Za-z0-9]{1,8}$/.test(v);
}

function unwrapOnce(s: string): string {
	if (s.length < 2) {
		return s;
	}
	for (const [open, close] of WRAPPERS) {
		if (s.startsWith(open) && s.endsWith(close) && s.length > open.length + close.length) {
			return s.slice(open.length, -close.length).trim();
		}
	}
	const md = s.match(/^\[([^\]]*)\]\(([^)]+)\)$/);
	if (md) {
		if (looksLikePathInner(md[2])) {
			return md[2];
		}
		if (looksLikePathInner(md[1])) {
			return md[1];
		}
	}
	const img = s.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
	if (img && looksLikePathInner(img[2])) {
		return img[2];
	}
	const angle = s.match(/^<([^<>]+)>$/);
	if (angle && looksLikePathInner(angle[1])) {
		return angle[1];
	}
	const bold = s.match(/^\*{1,2}([^*]+)\*{1,2}$/);
	if (bold && looksLikePathInner(bold[1])) {
		return bold[1];
	}
	const under = s.match(/^_{1,2}([^_]+)_{1,2}$/);
	if (under && looksLikePathInner(under[1])) {
		return under[1];
	}
	if (s.startsWith('|') && s.endsWith('|') && s.length > 2) {
		return s.slice(1, -1).trim();
	}
	return s;
}

function stripLeadingJunk(s: string): string {
	let out = s.replace(/^(?:&gt;)+/i, '').replace(/^(?:&lt;)+/i, '');
	out = out.replace(/^[>|]+/, '');
	if (/^#+/.test(out) && !/^#+L?\d+/i.test(out)) {
		out = out.replace(/^#+/, '');
	}
	if (out.startsWith('@')) {
		const rest = out.slice(1);
		if (rest.startsWith('/') || rest.startsWith('.') || /^\.?[\w.-]+\.[A-Za-z0-9]{1,8}$/.test(rest)) {
			out = rest;
		}
	}
	return out.trim();
}

function stripLocation(s: string): IKnoxGuiParsedToolFilePath {
	if (isUri(s) && !/^file:/i.test(s)) {
		return { filepath: s };
	}
	if (/[*?[\]]/.test(s)) {
		return { filepath: s };
	}
	const win = /^[A-Za-z]:[\\/]/.test(s);
	const prefix = win ? s.slice(0, 2) : '';
	const body = win ? s.slice(2) : s;
	const attach = (path: string) => prefix + path;

	let m = body.match(/^(.*\.[A-Za-z0-9]{1,8}):(\d+)-(\d+)$/);
	if (m) {
		return { filepath: attach(m[1]), startLine: Number(m[2]), endLine: Number(m[3]) };
	}
	m = body.match(/^(.*\.[A-Za-z0-9]{1,8}):(\d+)(?::\d+)?$/);
	if (m) {
		return { filepath: attach(m[1]), startLine: Number(m[2]) };
	}
	m = body.match(/^(.*\.[A-Za-z0-9]{1,8})#L?(\d+)(?:-L?(\d+))?$/i);
	if (m) {
		return {
			filepath: attach(m[1]),
			startLine: Number(m[2]),
			...(m[3] ? { endLine: Number(m[3]) } : {}),
		};
	}
	m = body.match(/^(.*\.[A-Za-z0-9]{1,8})\s*\((?:lines?\s*)?(\d+)(?:\s*[-–]\s*(\d+))?\)$/i);
	if (m) {
		return {
			filepath: attach(m[1]),
			startLine: Number(m[2]),
			...(m[3] ? { endLine: Number(m[3]) } : {}),
		};
	}
	return { filepath: s };
}

export function knoxGuiParseToolFilePath(raw: string): IKnoxGuiParsedToolFilePath {
	if (!raw) {
		return { filepath: '' };
	}
	let s = raw
		.replace(/^\uFEFF/, '')
		.replace(/[\u200B-\u200D\uFEFF]/g, '')
		.replace(/\u00A0/g, ' ');
	s = (s.split(/\r?\n/, 1)[0] ?? '').trim();
	if (!s) {
		return { filepath: '' };
	}

	for (let i = 0; i < 8; i++) {
		const prev = s;
		s = unwrapOnce(s);
		if (!isUri(s)) {
			const keyed = s.match(KEY_PREFIX_RE);
			if (keyed) {
				s = s.slice(keyed[0].length).trim();
			}
		}
		s = stripLeadingJunk(s);
		if (!isUri(s)) {
			s = s.replace(/\\/g, '/');
		}
		s = s.replace(/^\.\//, '').trim();
		if (s === prev) {
			break;
		}
	}

	if (!isUri(s) && !/^\.{1,2}$/.test(s)) {
		const stripped = s.replace(/[.,;]+$/g, '');
		if (stripped) {
			s = stripped;
		}
	}

	const loc = stripLocation(s);
	return {
		filepath: loc.filepath.replace(/^\.\//, '').trim(),
		...(loc.startLine !== undefined ? { startLine: loc.startLine } : {}),
		...(loc.endLine !== undefined ? { endLine: loc.endLine } : {}),
	};
}

export function knoxGuiSanitizeToolFilePath(raw: string): string {
	return knoxGuiParseToolFilePath(raw).filepath;
}
