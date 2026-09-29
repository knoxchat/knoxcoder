/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Public Knox API (Git analog: `extensions/git/src/api/git.d.ts`).
 *
 * Copy this file into a consuming extension, include it in compilation, then:
 *
 * ```ts
 * const knoxExtension = vscode.extensions.getExtension<KnoxExtension>('vscode.knox');
 * const knox = knoxExtension?.exports.getAPI(1);
 * await knox?.openChat({ prompt: 'explain the selection' });
 * ```
 *
 * Add `"extensionDependencies": ["vscode.knox"]` so Knox activates first.
 * Without that dependency, call `await knoxExtension?.activate()` before `getAPI(1)`.
 */

import { Event } from 'vscode';

export interface OpenChatOptions {
	readonly prompt?: string;
}

export interface ToolCall {
	readonly id?: string;
	readonly type?: string;
	readonly function: {
		readonly name: string;
		readonly arguments: string;
	};
}

export interface ContextItem {
	readonly name: string;
	readonly description: string;
	readonly content: string;
	readonly uri?: { readonly type: string; readonly value: string };
}

export interface CustomContextProvider {
	readonly description: { readonly title: string; readonly displayTitle?: string };
	getContextItems(query: string, extras: unknown): Thenable<ContextItem[]>;
	loadSubmenuItems?(args: unknown): Thenable<unknown[]>;
}

export interface KnoxGuiMessage {
	readonly messageType: string;
	readonly messageId: string;
	readonly data: unknown;
}

/**
 * Versioned Knox API (Git analog: `API` in git.d.ts).
 */
export interface API {
	isAgentModeActive(): Thenable<boolean>;
	toggleAgentMode(): Thenable<void>;
	executeToolCall(toolCall: ToolCall, selectedModelTitle: string): Thenable<ContextItem[]>;
	registerCustomContextProvider(provider: CustomContextProvider): void;
	openChat(options?: OpenChatOptions): Thenable<void>;
	newSession(): Thenable<void>;
	handleGuiMessage(message: KnoxGuiMessage): Thenable<void>;
	readonly onDidChangeAgentMode: Event<boolean>;
	readonly onDidReceiveGuiMessage: Event<KnoxGuiMessage>;
}

/** Alias used in docs and `getAPI(1)` examples. */
export type KnoxAPI = API;

/**
 * Builtin extension exports. Other extensions:
 *
 * ```ts
 * const knox = vscode.extensions.getExtension<KnoxExtension>('vscode.knox');
 * const api = knox?.exports.getAPI(1);
 * ```
 */
export interface KnoxExtension {
	readonly enabled: boolean;
	readonly onDidChangeEnablement: Event<boolean>;

	/**
	 * Returns a specific API version.
	 *
	 * Throws if `version` is not `1`.
	 */
	getAPI(version: 1): API;
}
