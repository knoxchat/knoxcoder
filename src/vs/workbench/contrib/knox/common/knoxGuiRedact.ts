/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Secret redaction for text the GUI writes outside the app (exported Markdown sessions).
 * Subset of `extensions/knox/src/core/util/redactSecrets.ts`; keep the two in sync
 * (the extension copy is the reference and has the format corpus tests).
 */

export const KNOX_GUI_REDACTED = '[REDACTED]';

const SENSITIVE_KEY = '(?:[A-Za-z0-9_.-]{0,48}(?:api[_-]?key|apikey|secret|token|passwd|password|pwd|private[_-]?key|access[_-]?key|auth|credential)s?[A-Za-z0-9_.-]{0,48})';

const RULES: Array<{ re: RegExp; replace: string | ((...m: string[]) => string) }> = [
	{ re: /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g, replace: '[REDACTED PRIVATE KEY]' },
	{ re: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:/@]*):([^\s@/]+)@/gi, replace: (_m, scheme, user) => `${scheme}${user}:${KNOX_GUI_REDACTED}@` },
	{ re: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/g, replace: (_m, kind) => `${kind} ${KNOX_GUI_REDACTED}` },
	{ re: /(\bauthorization["']?\s*[:=]\s*["']?)(?:(Bearer|Basic|Token|Digest|Negotiate|ApiKey)\s+)?(?!\[REDACTED\])[^\s"',;]{12,}/gi, replace: (_m, lead, scheme) => `${lead}${scheme ? scheme + ' ' : ''}${KNOX_GUI_REDACTED}` },
	{ re: /\b((?:x-[a-z-]*(?:key|token|secret|auth)[a-z-]*|api-key)\s*:\s*)(?!\[REDACTED\])[^\s"',;]{12,}/gi, replace: (_m, lead) => `${lead}${KNOX_GUI_REDACTED}` },
	{ re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g, replace: KNOX_GUI_REDACTED },
	{ re: /\bwhsec_[A-Za-z0-9]{16,}/g, replace: KNOX_GUI_REDACTED },
	{ re: /\bya29\.[A-Za-z0-9_-]{20,}/g, replace: KNOX_GUI_REDACTED },
	{ re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g, replace: KNOX_GUI_REDACTED },
	{ re: /\bsk-or-[A-Za-z0-9_-]{16,}/g, replace: KNOX_GUI_REDACTED },
	{ re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, replace: KNOX_GUI_REDACTED },
	{ re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g, replace: KNOX_GUI_REDACTED },
	{ re: /\bgithub_pat_[A-Za-z0-9_]{30,}/g, replace: KNOX_GUI_REDACTED },
	{ re: /\bglpat-[A-Za-z0-9_-]{20,}/g, replace: KNOX_GUI_REDACTED },
	{ re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, replace: KNOX_GUI_REDACTED },
	{ re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, replace: KNOX_GUI_REDACTED },
	{ re: /\bAIza[0-9A-Za-z_-]{35}\b/g, replace: KNOX_GUI_REDACTED },
	{ re: /\bnpm_[A-Za-z0-9]{30,}/g, replace: KNOX_GUI_REDACTED },
	{ re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replace: KNOX_GUI_REDACTED },
	{ re: new RegExp(`((?<![A-Za-z0-9_.-])["']?${SENSITIVE_KEY}["']?\\s*[=:]\\s*)(["'])([^"'\\n]{6,})\\2`, 'gi'), replace: (_m, lead, q) => `${lead}${q}${KNOX_GUI_REDACTED}${q}` },
	{ re: new RegExp(`((?:^|\\n|\\bexport\\s+|\\s)${SENSITIVE_KEY}=)([^\\s"'\`;&|()<>]{8,})`, 'gi'), replace: (_m, lead) => `${lead}${KNOX_GUI_REDACTED}` },
];

export function knoxGuiRedactSecrets(text: string): string {
	if (!text) {
		return text;
	}
	let out = text;
	for (const { re, replace } of RULES) {
		re.lastIndex = 0;
		out = out.replace(re, replace as never);
	}
	return out;
}
