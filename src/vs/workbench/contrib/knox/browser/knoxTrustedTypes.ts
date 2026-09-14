/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTrustedTypesPolicy } from '../../../../base/browser/trustedTypes.js';

/**
 * Workbench CSP allowlist name in `workbench.html` / `workbench-dev.html`.
 * One policy for all Knox monaco-tokenized `innerHTML` (markdown code + ExactSearch).
 * Do not reuse `tokenizeToString`: Trusted Types allows creating a given name only once.
 */
export const knoxTokenizerPolicy = createTrustedTypesPolicy('knoxTokenizer', {
	createHTML(html: string) {
		return html;
	},
});

export function knoxSetTokenizedHtml(host: HTMLElement, html: string): void {
	const content = knoxTokenizerPolicy ? knoxTokenizerPolicy.createHTML(html) ?? html : html;
	host.innerHTML = content as string;
}
