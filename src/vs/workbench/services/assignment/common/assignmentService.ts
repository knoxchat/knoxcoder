/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IAssignmentService } from '../../../../platform/assignment/common/assignment.js';

export interface IAssignmentFilter {
	/**
	 * Stable identifier for this filter. Used to persist and reconcile the set of
	 * assignment-context ids this filter has excluded, independently of other filters.
	 */
	readonly id: string;
	exclude(assignment: string): boolean;
	onDidChange: Event<void>;
}

export const IWorkbenchAssignmentService = createDecorator<IWorkbenchAssignmentService>('assignmentService');

/**
 * Scope prefix that the new TAS assignments endpoint (`/api/v1/assignments`) prepends to the
 * feature variable keys it returns (e.g. `/vscode/config.chat...`). The legacy endpoint and
 * VS Code both query treatments by the bare name, so this prefix must be accounted for when a
 * bare lookup misses. This is an interim workaround until tas-client strips the scope itself.
 */
const ASSIGNMENTS_SCOPE_PREFIX = '/vscode/';

/**
 * Resolves a treatment value preferring the `/vscode/`-scoped key emitted by the new TAS
 * assignments endpoint over the bare key used by the legacy endpoint, so the new endpoint wins
 * when both assign a treatment (matching the behavior once tas-client strips the scope itself).
 * Falls back to the bare key for treatments served only by the legacy endpoint.
 *
 * Exported for testing.
 */
export function resolveScopedTreatment<T extends string | number | boolean>(read: (name: string) => T | undefined, name: string): T | undefined {
	const scoped = read(`${ASSIGNMENTS_SCOPE_PREFIX}${name}`);
	return scoped !== undefined ? scoped : read(name);
}

export interface IWorkbenchAssignmentService extends IAssignmentService {
	getCurrentExperiments(): Promise<string[] | undefined>;
	addTelemetryAssignmentFilter(filter: IAssignmentFilter): void;
}
