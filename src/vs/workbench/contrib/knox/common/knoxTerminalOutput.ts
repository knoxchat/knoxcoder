/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function knoxExtractTerminalOutput(
	items:
		| readonly { name?: string; description?: string; content?: string }[]
		| undefined,
): string {
	if (!items?.length) {
		return '';
	}
	const match = items.find(
		item =>
			item.name === 'Terminal' ||
			item.name === 'Build' ||
			item.name === 'Terminal command output' ||
			item.description === 'Terminal command output' ||
			item.description?.startsWith('Terminal command') ||
			item.description?.startsWith('Background shell') ||
			item.description?.startsWith('Shell job') ||
			item.description === 'Unknown shell job' ||
			item.description?.includes('shell job'),
	);
	return match?.content || items[0]?.content || '';
}
