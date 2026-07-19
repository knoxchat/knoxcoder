/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IAssignmentFilter, IWorkbenchAssignmentService } from './assignmentService.js';

class NullWorkbenchAssignmentService implements IWorkbenchAssignmentService {
	_serviceBrand: undefined;

	readonly onDidRefetchAssignments = Event.None;

	async getCurrentExperiments(): Promise<string[] | undefined> {
		return [];
	}

	async getTreatment<T extends string | number | boolean>(_name: string): Promise<T | undefined> {
		return undefined;
	}

	addTelemetryAssignmentFilter(_filter: IAssignmentFilter): void { }
}

registerSingleton(IWorkbenchAssignmentService, NullWorkbenchAssignmentService, InstantiationType.Delayed);
