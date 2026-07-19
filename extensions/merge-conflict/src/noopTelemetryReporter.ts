/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class NoopTelemetryReporter {
	sendTelemetryEvent(_eventName?: string, _properties?: { [key: string]: string }, _measurements?: { [key: string]: number }): void { }
	sendTelemetryErrorEvent(_eventName?: string, _properties?: { [key: string]: string }, _measurements?: { [key: string]: number }): void { }
	dispose(): void { }
}

export type TelemetryReporter = NoopTelemetryReporter;
