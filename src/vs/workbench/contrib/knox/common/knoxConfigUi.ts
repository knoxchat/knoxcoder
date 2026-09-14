/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IKnoxConfigError {
	message: string;
	fatal?: boolean;
}

export function knoxParseConfigErrors(value: unknown): IKnoxConfigError[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
		.map(item => ({
			message: typeof item.message === 'string' ? item.message : String(item.message ?? ''),
			fatal: item.fatal === true,
		}))
		.filter(item => item.message.length > 0);
}

export function knoxSortConfigErrors(errors: readonly IKnoxConfigError[]): IKnoxConfigError[] {
	return [...errors].sort((a, b) => Number(b.fatal === true) - Number(a.fatal === true));
}

export function knoxHasFatalConfigError(errors: readonly IKnoxConfigError[] | undefined): boolean {
	return (errors ?? []).some(error => error.fatal === true);
}

export function knoxConfigErrorsFromProfileInfo(content: unknown): IKnoxConfigError[] {
	if (!content || typeof content !== 'object') {
		return [];
	}
	const payload = content as { result?: { errors?: unknown }; errors?: unknown };
	return knoxParseConfigErrors(payload.result?.errors ?? payload.errors);
}
