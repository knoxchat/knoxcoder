/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Shared host-payload readers used by restore, details, dashboard, and analysis parsers. */

export function rec(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

export function arr(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}
