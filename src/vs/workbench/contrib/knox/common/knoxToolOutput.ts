/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKnoxContextItem } from './knoxChatTypes.js';
import { knoxIsVisibleTaskPlanPeekItem } from './knoxTaskPlan.js';

export function knoxVisibleToolOutputItems(
	items: readonly IKnoxContextItem[] | undefined,
): IKnoxContextItem[] {
	return (items ?? []).filter(item => !item.hidden && knoxIsVisibleTaskPlanPeekItem(item));
}

export function knoxContextItemRange(name: string): { startLine: number; endLine: number } | undefined {
	if (!name.includes(' (') || !name.endsWith(')')) {
		return undefined;
	}
	const match = name.match(/\((\d+)(?:-(\d+))?\)$/);
	if (!match) {
		return undefined;
	}
	const startLine = Number(match[1]);
	const endLine = match[2] ? Number(match[2]) : startLine;
	if (!Number.isFinite(startLine) || startLine <= 0) {
		return undefined;
	}
	return {
		startLine,
		endLine: Number.isFinite(endLine) && endLine > 0 ? endLine : startLine,
	};
}

export function knoxContextItemBasename(description: string): string {
	const token = description.split(' ')[0]?.split('#')[0] ?? description;
	const slash = Math.max(token.lastIndexOf('/'), token.lastIndexOf('\\'));
	return slash >= 0 ? token.slice(slash + 1) : token;
}
