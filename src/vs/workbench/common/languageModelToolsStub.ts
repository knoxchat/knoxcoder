/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Minimal type stubs for deleted language-model tools service. */
export type ToolConfirmationAction = string;

export const ToolDataSource = { Internal: 'internal' } as const;

export type CountTokensCallback = (...args: any[]) => any;
export type ToolProgress = any;
export type IPreparedToolInvocation = any;
export type IToolData = any;
export type IToolImpl = any;
export type IToolInvocation = any;
export type IToolInvocationPreparationContext = any;
export type IToolResult = any;
export type ToolSet = any;
export type ILanguageModelToolsService = any;
