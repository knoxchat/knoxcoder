/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IExperimentationFilterProvider } from 'tas-client';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IExtensionService } from '../../extensions/common/extensions.js';

export enum ExtensionsFilter {
}

export class AssistAssignmentFilterProvider extends Disposable implements IExperimentationFilterProvider {
	private readonly _onDidChangeFilters = this._register(new Emitter<void>());
	readonly onDidChangeFilters = this._onDidChangeFilters.event;

	constructor(
		@IExtensionService _extensionService: IExtensionService,
		@ILogService _logService: ILogService,
		@IStorageService _storageService: IStorageService,
	) {
		super();
	}

	getFilterValue(_filter: string): string | null {
		return null;
	}

	getFilters(): Map<string, string | null> {
		return new Map();
	}
}
