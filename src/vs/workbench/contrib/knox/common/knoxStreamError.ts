/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { knoxNls } from './knoxI18n.js';
import { IKnoxModelDescription } from './knoxChatTypes.js';

export type KnoxStreamErrorKind = 'rateLimit' | 'notFound' | 'unauthorized' | 'overloaded' | 'generic';

export interface IKnoxStreamErrorInfo {
	kind: KnoxStreamErrorKind;
	statusCode: number | undefined;
	message: string | undefined;
	title: string;
	detail: string;
}

export function knoxErrorMessage(error: unknown): string | undefined {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
		return (error as { message: string }).message;
	}
	if (typeof error === 'string' && error.trim()) {
		return error;
	}
	return undefined;
}

export function knoxStatusCodeFromMessage(message: string | undefined): number | undefined {
	if (!message) {
		return undefined;
	}
	const parts = message.split(' ');
	if (parts.length > 1) {
		const status = parts[0] === 'HTTP' ? parts[1] : parts[0];
		const code = Number(status);
		if (!Number.isNaN(code)) {
			return code;
		}
	}
	return undefined;
}

export function knoxStreamErrorKind(
	statusCode: number | undefined,
	message: string | undefined,
): KnoxStreamErrorKind {
	if (statusCode === 429) {
		return 'rateLimit';
	}
	if (statusCode === 404) {
		return 'notFound';
	}
	if (statusCode === 401) {
		return 'unauthorized';
	}
	const lower = message?.toLowerCase() ?? '';
	if (lower.includes('overloaded') || lower.includes('malformed')) {
		return 'overloaded';
	}
	return 'generic';
}

export function describeKnoxStreamError(
	error: unknown,
	model?: IKnoxModelDescription,
): IKnoxStreamErrorInfo {
	const message = knoxErrorMessage(error);
	const statusCode = knoxStatusCodeFromMessage(message);
	const kind = knoxStreamErrorKind(statusCode, message);
	const modelTitle = model?.title || knoxNls('chatModel');
	const providerName = model?.provider || knoxNls('theModelProvider');
	const title = `${statusCode ? `${statusCode} ` : ''}${knoxNls('error')}`;

	const lines: string[] = [];
	if (kind === 'rateLimit') {
		lines.push(knoxNls('rateLimited', { model: modelTitle, provider: providerName }));
	} else if (kind === 'notFound') {
		lines.push(knoxNls('likelyCauses'));
		const apiBase = model?.apiBase;
		lines.push(`${knoxNls('invalidApiBase')} apiBase${apiBase ? `: ${apiBase}` : ''}`);
		lines.push(`${knoxNls('modelNotFound')}${model?.model ? ` for: ${model.model}` : ''}`);
	} else if (kind === 'unauthorized') {
		lines.push(knoxNls('invalidApiKey'));
	} else if (kind === 'overloaded') {
		lines.push(knoxNls('serverOverloaded'));
		if (model?.provider) {
			lines.push(`${knoxNls('provider')}: ${model.provider}`);
		}
	}

	const detailParts = [message, ...lines].filter((part): part is string => !!part && part.trim().length > 0);
	return {
		kind,
		statusCode,
		message,
		title,
		detail: detailParts.join('\n\n'),
	};
}
