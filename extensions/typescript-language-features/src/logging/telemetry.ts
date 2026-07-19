/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface TelemetryProperties {
	readonly [prop: string]: string | number | boolean | undefined;
}

export interface TelemetryReporter {
	logTelemetry(eventName: string, properties?: TelemetryProperties): void;
	logTraceEvent(tracePoint: string, correlationId: string, command?: string): void;
}

export class VSCodeTelemetryReporter implements TelemetryReporter {
	constructor(
		_reporter: unknown,
		_clientVersionDelegate: () => string
	) { }

	public logTelemetry(_eventName: string, _properties: { [prop: string]: string } = {}): void { }

	public logTraceEvent(_point: string, _traceId: string, _data?: string): void { }
}
