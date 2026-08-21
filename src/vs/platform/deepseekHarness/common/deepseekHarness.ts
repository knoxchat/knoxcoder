/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const DEEPSEEK_HARNESS_CHANNEL_NAME = 'deepseekHarness';

export const DEEPSEEK_HARNESS_DEFAULT_PORT = 3080;

export const DEEPSEEK_HARNESS_SUBMODULE_PATH = 'third_party/deepseek-harness';

export type DeepSeekHarnessState = 'stopped' | 'starting' | 'running' | 'error';

export type DeepSeekHarnessColorScheme = 'light' | 'dark';

export interface IDeepSeekHarnessStatus {
	readonly state: DeepSeekHarnessState;
	readonly url?: string;
	readonly message?: string;
}

export interface IDeepSeekHarnessStartOptions {
	readonly port: number;
	readonly workspaceFolders?: readonly string[];
	readonly colorScheme?: DeepSeekHarnessColorScheme;
	readonly checkoutPath?: string;
	readonly extraArgs?: readonly string[];
}

export const IDeepSeekHarnessService = createDecorator<IDeepSeekHarnessService>('deepseekHarnessService');

export interface IDeepSeekHarnessService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeStatus: Event<IDeepSeekHarnessStatus>;

	getStatus(): Promise<IDeepSeekHarnessStatus>;
	start(options: IDeepSeekHarnessStartOptions): Promise<IDeepSeekHarnessStatus>;
	syncWorkspaces(folders: readonly string[]): Promise<void>;
	syncTheme(colorScheme: DeepSeekHarnessColorScheme): Promise<void>;
	stop(): Promise<void>;
}
