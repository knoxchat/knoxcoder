/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { refineServiceDecorator } from '../../instantiation/common/instantiation.js';
import { ITelemetryService, TelemetryLevel } from './telemetry.js';
import { NullTelemetryServiceShape } from './telemetryUtils.js';

export interface IServerTelemetryService extends ITelemetryService {
	updateInjectedTelemetryLevel(telemetryLevel: TelemetryLevel): Promise<void>;
}

export const ServerNullTelemetryService = new class extends NullTelemetryServiceShape implements IServerTelemetryService {
	async updateInjectedTelemetryLevel(): Promise<void> { return; }
};

export const IServerTelemetryService = refineServiceDecorator<ITelemetryService, IServerTelemetryService>(ITelemetryService);
