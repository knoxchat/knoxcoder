/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class NoopTelemetryReporter {
	sendTelemetryEvent(_eventName?: string, _properties?: Record<string, string>, _measurements?: Record<string, number>): void { }
	sendTelemetryErrorEvent(_eventName?: string, _properties?: Record<string, string>, _measurements?: Record<string, number>): void { }
	dispose(): void | Promise<void> { }
}
