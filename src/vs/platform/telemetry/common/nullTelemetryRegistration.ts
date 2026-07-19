/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { ICustomEndpointTelemetryService, ITelemetryService } from './telemetry.js';
import { NullEndpointTelemetryService, NullTelemetryServiceShape } from './telemetryUtils.js';

registerSingleton(ITelemetryService, NullTelemetryServiceShape, InstantiationType.Eager);
registerSingleton(ICustomEndpointTelemetryService, NullEndpointTelemetryService, InstantiationType.Eager);
