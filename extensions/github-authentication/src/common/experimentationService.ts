/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { NoopTelemetryReporter } from './noopTelemetryReporter';

export class ExperimentationTelemetry {
	private sharedProperties: Record<string, string> = {};

	constructor(_context: vscode.ExtensionContext, private baseReporter: NoopTelemetryReporter) { }

	async sendTelemetryEvent(eventName: string, properties?: Record<string, string>, measurements?: Record<string, number>) {
		this.baseReporter.sendTelemetryEvent(
			eventName,
			{
				...this.sharedProperties,
				...properties,
			},
			measurements,
		);
	}

	async sendTelemetryErrorEvent(
		eventName: string,
		properties?: Record<string, string>,
		_measurements?: Record<string, number>
	) {
		this.baseReporter.sendTelemetryErrorEvent(eventName, {
			...this.sharedProperties,
			...properties,
		});
	}

	setSharedProperty(name: string, value: string): void {
		this.sharedProperties[name] = value;
	}

	postEvent(eventName: string, props: Map<string, string>): void {
		const event: Record<string, string> = {};
		for (const [key, value] of props) {
			event[key] = value;
		}
		this.sendTelemetryEvent(eventName, event);
	}

	async dispose(): Promise<void> {
		await this.baseReporter.dispose();
	}
}
