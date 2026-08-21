/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExperimentationTelemetryReporter } from './experimentTelemetryReporter';

interface ExperimentTypes {
	suggestNativePreview: boolean;
}

export class ExperimentationService {
	constructor(_telemetryReporter: IExperimentationTelemetryReporter, _id: string, _version: string, _globalState: unknown) { }

	public async getTreatmentVariable<K extends keyof ExperimentTypes>(_name: K, defaultValue: ExperimentTypes[K]): Promise<ExperimentTypes[K]> {
		return defaultValue;
	}
}
