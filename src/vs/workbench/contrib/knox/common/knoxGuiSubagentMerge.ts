/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * K-025: a `task` call with isolated writing children ends each child with one
 * `Merge: ...` line (see `formatMergeResult` in core). This turns those lines
 * into badges so a conflict is visible without reading the whole output.
 */

export type KnoxGuiMergeStatus = 'applied' | 'conflict' | 'no-changes' | 'skipped' | 'error';

export interface IKnoxGuiSubagentMerge {
	readonly status: KnoxGuiMergeStatus;
	/** "Child 2" when the output has per-child headings. */
	readonly label: string;
	readonly files: readonly string[];
	/** Where a conflicting patch was kept. */
	readonly patchPath?: string;
}

export function knoxGuiParseSubagentMerges(output: string | undefined): IKnoxGuiSubagentMerge[] {
	if (!output) {
		return [];
	}
	const out: IKnoxGuiSubagentMerge[] = [];
	let label = '';
	for (const line of output.split('\n')) {
		const heading = /^### (.+)$/.exec(line);
		if (heading) {
			label = heading[1].trim();
			continue;
		}
		const m = /^Merge: (.*)$/.exec(line);
		if (!m) {
			continue;
		}
		const body = m[1];
		const files = (/\(([^()]*)\)/.exec(body)?.[1] ?? '')
			.split(',')
			.map(f => f.trim())
			.filter(f => f && f !== '(none)' && f !== 'none');
		let status: KnoxGuiMergeStatus;
		if (body.startsWith('applied')) {
			status = 'applied';
		} else if (body.startsWith('CONFLICT')) {
			status = 'conflict';
		} else if (body.startsWith('child made no')) {
			status = 'no-changes';
		} else if (body.startsWith('skipped')) {
			status = 'skipped';
		} else {
			status = 'error';
		}
		const patchPath = /Patch kept at (\S+?)\.(?:\s|$)/.exec(body)?.[1];
		out.push({ status, label, files, patchPath: patchPath ? `${patchPath}` : undefined });
		label = '';
	}
	return out;
}
